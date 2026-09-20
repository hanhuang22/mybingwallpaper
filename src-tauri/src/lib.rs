mod platform;

use chrono::{Local, NaiveDate};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, Runtime, State, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use url::Url;

const ARCHIVE_BASE: &str = "https://my-bing-wallpaper.oss-cn-beijing.aliyuncs.com/month";

struct AppState {
    client: Client,
    config_path: PathBuf,
    wallpaper_cache: PathBuf,
    last_auto_update: Arc<Mutex<Option<String>>>,
    quitting: Arc<std::sync::atomic::AtomicBool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Wallpaper {
    date: String,
    title: String,
    description: String,
    image_url: String,
}

#[derive(Debug, Deserialize)]
struct RemoteWallpaper {
    date: Option<String>,
    imgtitle: String,
    #[serde(default)]
    imgdesc: String,
    imgurl: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Settings {
    auto_update: bool,
    auto_start: bool,
    lock_screen: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            auto_update: false,
            auto_start: false,
            lock_screen: false,
        }
    }
}

fn validate_date(date: &str) -> Result<String, String> {
    NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map(|parsed| parsed.format("%Y-%m-%d").to_string())
        .map_err(|_| "日期格式无效".to_string())
}

fn image_url(url: &str) -> Result<Url, String> {
    let parsed = Url::parse(url).map_err(|_| "壁纸地址无效".to_string())?;
    if parsed.scheme() != "https" {
        return Err("仅允许通过 HTTPS 下载壁纸".to_string());
    }
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    let allowed = ["bing.com", "bing.net", "ee123.net"];
    if !allowed
        .iter()
        .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
    {
        return Err("壁纸来源不在允许列表中".to_string());
    }
    Ok(parsed)
}

async fn fetch_wallpaper(client: &Client, date: &str) -> Result<Wallpaper, String> {
    let date = validate_date(date)?;
    let key = date.replace('-', "");
    let month = &key[..6];
    let response = client
        .get(format!("{ARCHIVE_BASE}/{month}.json"))
        .send()
        .await
        .map_err(|error| format!("获取壁纸信息失败：{error}"))?
        .error_for_status()
        .map_err(|error| format!("壁纸数据服务异常：{error}"))?;
    let records = response
        .json::<HashMap<String, RemoteWallpaper>>()
        .await
        .map_err(|error| format!("壁纸数据解析失败：{error}"))?;
    let record = records
        .get(&key)
        .ok_or_else(|| "没有找到这一天的壁纸".to_string())?;
    image_url(&record.imgurl)?;
    Ok(Wallpaper {
        date: record.date.clone().unwrap_or(date),
        title: record.imgtitle.clone(),
        description: record.imgdesc.clone(),
        image_url: record.imgurl.clone(),
    })
}

async fn download_image(client: &Client, image: &str, destination: &Path) -> Result<(), String> {
    let url = image_url(image)?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("下载壁纸失败：{error}"))?
        .error_for_status()
        .map_err(|error| format!("壁纸服务器异常：{error}"))?;

    if let Some(size) = response.content_length() {
        if size > 50 * 1024 * 1024 {
            return Err("壁纸文件超过 50 MB 限制".to_string());
        }
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("读取壁纸失败：{error}"))?;
    if bytes.len() < 1024 || bytes.len() > 50 * 1024 * 1024 {
        return Err("壁纸文件大小异常".to_string());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建壁纸目录：{error}"))?;
    }
    fs::write(destination, bytes).map_err(|error| format!("无法写入壁纸文件：{error}"))
}

fn read_settings(path: &Path) -> Settings {
    fs::read(path)
        .ok()
        .and_then(|contents| serde_json::from_slice(&contents).ok())
        .unwrap_or_default()
}

fn write_settings(path: &Path, settings: &Settings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建配置目录：{error}"))?;
    }
    let contents =
        serde_json::to_vec_pretty(settings).map_err(|error| format!("配置序列化失败：{error}"))?;
    fs::write(path, contents).map_err(|error| format!("配置保存失败：{error}"))
}

#[tauri::command]
async fn get_wallpaper(date: String, state: State<'_, AppState>) -> Result<Wallpaper, String> {
    fetch_wallpaper(&state.client, &date).await
}

#[tauri::command]
async fn apply_wallpaper(
    image_url: String,
    date: String,
    set_lock_screen: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let date = validate_date(&date)?;
    let path = state.wallpaper_cache.join(format!("{date}.jpg"));
    download_image(&state.client, &image_url, &path).await?;
    platform::set_desktop_wallpaper(&path)?;
    if set_lock_screen {
        platform::set_lock_screen_wallpaper(&path)?;
    }
    Ok(())
}

#[tauri::command]
async fn save_wallpaper(
    image_url: String,
    date: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let date = validate_date(&date)?;
    let pictures = dirs::picture_dir().ok_or_else(|| "无法定位系统图片目录".to_string())?;
    let destination = pictures.join("MyBingWallpaper").join(format!("{date}.jpg"));
    download_image(&state.client, &image_url, &destination).await?;
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
fn load_settings<R: Runtime>(app: tauri::AppHandle<R>, state: State<'_, AppState>) -> Settings {
    let mut settings = read_settings(&state.config_path);
    settings.auto_start = app.autolaunch().is_enabled().unwrap_or(settings.auto_start);
    settings
}

#[tauri::command]
fn save_settings<R: Runtime>(
    app: tauri::AppHandle<R>,
    settings: Settings,
    state: State<'_, AppState>,
) -> Result<(), String> {
    write_settings(&state.config_path, &settings)?;
    let autostart = app.autolaunch();
    if settings.auto_start {
        autostart
            .enable()
            .map_err(|error| format!("无法启用开机启动：{error}"))?;
    } else {
        autostart
            .disable()
            .map_err(|error| format!("无法关闭开机启动：{error}"))?;
    }
    if settings.auto_update {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = run_auto_update_once(handle).await;
        });
    }
    Ok(())
}

#[tauri::command]
fn get_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else {
        "macos"
    }
}

async fn run_auto_update_once<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let (client, cache, config, guard) = {
        let state = app.state::<AppState>();
        (
            state.client.clone(),
            state.wallpaper_cache.clone(),
            state.config_path.clone(),
            state.last_auto_update.clone(),
        )
    };
    if !read_settings(&config).auto_update {
        return Ok(());
    }
    let today = Local::now().format("%Y-%m-%d").to_string();
    if guard
        .lock()
        .map_err(|_| "更新状态不可用".to_string())?
        .as_deref()
        == Some(&today)
    {
        return Ok(());
    }
    let wallpaper = fetch_wallpaper(&client, &today).await?;
    let path = cache.join(format!("{today}.jpg"));
    download_image(&client, &wallpaper.image_url, &path).await?;
    platform::set_desktop_wallpaper(&path)?;
    *guard.lock().map_err(|_| "更新状态不可用".to_string())? = Some(today.clone());
    let _ = app.emit("auto-update-complete", &today);
    Ok(())
}

fn build_tray<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let today = MenuItem::with_id(app, "today", "应用今日壁纸", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &today, &separator, &quit])?;
    let mut builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .show_menu_on_left_click(true);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "today" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                let _ = app.emit("tray-apply-today", ());
            }
            "quit" => {
                app.state::<AppState>()
                    .quitting
                    .store(true, std::sync::atomic::Ordering::SeqCst);
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--background"]),
        ))
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let cache_dir = app.path().app_cache_dir()?.join("wallpapers");
            fs::create_dir_all(&config_dir)?;
            fs::create_dir_all(&cache_dir)?;
            let client = Client::builder()
                .timeout(Duration::from_secs(15))
                .user_agent("MyBingWallpaper/0.3")
                .build()
                .map_err(|error| Box::<dyn std::error::Error>::from(error))?;
            app.manage(AppState {
                client,
                config_path: config_dir.join("settings.json"),
                wallpaper_cache: cache_dir,
                last_auto_update: Arc::new(Mutex::new(None)),
                quitting: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            });
            build_tray(app)?;

            let launched_in_background =
                std::env::args().any(|argument| argument == "--background");
            if !launched_in_background {
                if let Some(window) = app.get_webview_window("main") {
                    window.show()?;
                    window.set_focus()?;
                }
            }

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(15)).await;
                    if let Err(error) = run_auto_update_once(handle.clone()).await {
                        let _ = handle.emit("auto-update-error", error);
                    }
                    tokio::time::sleep(Duration::from_secs(15 * 60)).await;
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let quitting = window
                    .app_handle()
                    .state::<AppState>()
                    .quitting
                    .load(std::sync::atomic::Ordering::SeqCst);
                if !quitting {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_wallpaper,
            apply_wallpaper,
            save_wallpaper,
            load_settings,
            save_settings,
            get_platform
        ])
        .run(tauri::generate_context!())
        .expect("error while running My Bing Wallpaper");
}
