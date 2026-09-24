mod platform;

use chrono::{Local, NaiveDate};
use reqwest::Client;
use semver::Version;
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
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::{Update, UpdaterExt};
use url::Url;

const ARCHIVE_BASE: &str = "https://my-bing-wallpaper.oss-cn-beijing.aliyuncs.com/month";
const GITEE_LATEST_RELEASE: &str =
    "https://gitee.com/api/v5/repos/Hyman25/mybingwallpaper/releases/latest";
const GITHUB_LATEST_RELEASE: &str =
    "https://api.github.com/repos/hanhuang22/mybingwallpaper/releases/latest";
struct AppState {
    client: Client,
    config_path: PathBuf,
    wallpaper_cache: PathBuf,
    active_wallpaper: Arc<Mutex<Option<PathBuf>>>,
    last_auto_update: Arc<Mutex<Option<String>>>,
    auto_update_lock: Arc<tokio::sync::Mutex<()>>,
    software_update_lock: Arc<tokio::sync::Mutex<()>>,
    pending_software_update: Arc<tokio::sync::Mutex<Option<PendingSoftwareUpdate>>>,
    quitting: Arc<std::sync::atomic::AtomicBool>,
}

struct PendingSoftwareUpdate {
    update: Update,
    bytes: Vec<u8>,
    version: String,
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

#[derive(Debug, Deserialize)]
struct RemoteRelease {
    tag_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SoftwareUpdateStatus {
    current_version: String,
    latest_version: String,
    update_available: bool,
    ready_to_restart: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SoftwareUpdateProgress {
    downloaded: u64,
    total: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Settings {
    auto_update: bool,
    auto_start: bool,
    lock_screen: bool,
    auto_download_updates: bool,
    theme: String,
    #[serde(default = "default_true")]
    save_without_prompt: bool,
    save_directory: Option<PathBuf>,
}

fn default_true() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            auto_update: false,
            auto_start: false,
            lock_screen: false,
            auto_download_updates: true,
            theme: "system".to_string(),
            save_without_prompt: true,
            save_directory: None,
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

fn parse_version(value: &str) -> Result<Version, String> {
    Version::parse(value.trim().trim_start_matches(['v', 'V']))
        .map_err(|_| format!("无法识别版本号：{value}"))
}

async fn fallback_release_status(
    client: &Client,
    current_version: &str,
    updater_error: impl std::fmt::Display,
) -> Result<SoftwareUpdateStatus, String> {
    let current = parse_version(current_version)?;
    let sources = [
        ("Gitee", GITEE_LATEST_RELEASE),
        ("GitHub", GITHUB_LATEST_RELEASE),
    ];
    let mut failures = Vec::new();
    let mut latest_release: Option<Version> = None;

    for (source, endpoint) in sources {
        let response = match client.get(endpoint).send().await {
            Ok(response) => response,
            Err(error) => {
                failures.push(format!("{source}: {error}"));
                continue;
            }
        };
        let response = match response.error_for_status() {
            Ok(response) => response,
            Err(error) => {
                failures.push(format!("{source}: {error}"));
                continue;
            }
        };
        let release = match response.json::<RemoteRelease>().await {
            Ok(release) => release,
            Err(error) => {
                failures.push(format!("{source}: {error}"));
                continue;
            }
        };
        let version = match parse_version(&release.tag_name) {
            Ok(version) => version,
            Err(error) => {
                failures.push(format!("{source}: {error}"));
                continue;
            }
        };
        if latest_release
            .as_ref()
            .is_none_or(|latest| version > *latest)
        {
            latest_release = Some(version);
        }
    }

    if let Some(latest) = latest_release {
        if latest <= current {
            return Ok(SoftwareUpdateStatus {
                current_version: current.to_string(),
                latest_version: latest.to_string(),
                update_available: false,
                ready_to_restart: false,
            });
        }
        return Err(format!(
            "发现新版本 v{latest}，但签名更新清单尚未就绪，请稍后重试或使用国内下载"
        ));
    }

    Err(format!(
        "更新清单暂不可用（{updater_error}），版本服务也无法连接：{}",
        failures.join("；")
    ))
}

fn trusted_external_url(url: &str) -> Result<Url, String> {
    let parsed = Url::parse(url).map_err(|_| "链接格式无效".to_string())?;
    if parsed.scheme() != "https" {
        return Err("仅允许打开 HTTPS 链接".to_string());
    }
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    let allowed = ["github.com", "gitee.com", "hanhuang22.github.io"];
    if !allowed.iter().any(|candidate| host == *candidate) {
        return Err("该链接不在允许列表中".to_string());
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

fn effective_save_directory(settings: &Settings) -> Result<PathBuf, String> {
    if let Some(path) = &settings.save_directory {
        return Ok(path.clone());
    }
    dirs::picture_dir()
        .map(|path| path.join("MyBingWallpaper"))
        .ok_or_else(|| "无法定位系统图片目录，请先在设置中选择原图保存位置".to_string())
}

fn dialog_directory(preferred: &Path) -> Result<PathBuf, String> {
    if preferred.is_dir() {
        return Ok(preferred.to_path_buf());
    }
    if let Some(parent) = preferred.parent().filter(|parent| parent.is_dir()) {
        return Ok(parent.to_path_buf());
    }
    dirs::home_dir().ok_or_else(|| "无法定位可选的文件夹".to_string())
}

fn should_reapply_cached_wallpaper(
    last_auto_update: Option<&str>,
    today: &str,
    cached_file_exists: bool,
) -> bool {
    last_auto_update == Some(today) && cached_file_exists
}

fn latest_cached_wallpaper(cache: &Path) -> Option<PathBuf> {
    fs::read_dir(cache)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let is_jpeg = path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("jpg"));
            if !is_jpeg {
                return None;
            }
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, path))
        })
        .max_by_key(|(modified, _)| *modified)
        .map(|(_, path)| path)
}

fn remember_active_wallpaper(state: &AppState, path: &Path) -> Result<(), String> {
    *state
        .active_wallpaper
        .lock()
        .map_err(|_| "壁纸状态不可用".to_string())? = Some(path.to_path_buf());
    Ok(())
}

#[cfg(target_os = "macos")]
fn reapply_active_wallpaper<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let path = app
        .state::<AppState>()
        .active_wallpaper
        .lock()
        .map_err(|_| "壁纸状态不可用".to_string())?
        .clone();
    let Some(path) = path.filter(|path| path.is_file()) else {
        return Ok(());
    };
    platform::set_desktop_wallpaper(&path)
}

#[cfg(target_os = "macos")]
fn watch_display_reconnections<R: Runtime>(app: tauri::AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        let mut previous = platform::connected_display_ids().unwrap_or_default();
        loop {
            tokio::time::sleep(Duration::from_secs(3)).await;
            let Ok(current) = platform::connected_display_ids() else {
                continue;
            };
            if current == previous {
                continue;
            }
            let display_connected = current
                .iter()
                .any(|display_id| !previous.contains(display_id));
            previous = current;
            if !display_connected {
                continue;
            }

            // Give macOS time to finish creating the desktop space for a newly
            // connected display before applying the current wallpaper to it.
            tokio::time::sleep(Duration::from_secs(2)).await;
            if let Err(error) = reapply_active_wallpaper(&app) {
                let _ = app.emit("display-wallpaper-error", error);
            }
        }
    });
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
    remember_active_wallpaper(&state, &path)?;
    if set_lock_screen {
        platform::set_lock_screen_wallpaper(&path)?;
    }
    Ok(())
}

#[tauri::command]
async fn save_wallpaper<R: Runtime>(
    app: tauri::AppHandle<R>,
    image_url: String,
    date: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let date = validate_date(&date)?;
    let settings = read_settings(&state.config_path);
    let save_directory = effective_save_directory(&settings)?;
    if settings.save_without_prompt {
        if settings.save_directory.is_some() && !save_directory.is_dir() {
            return Err("所选保存目录已不可用，请在设置中重新选择".to_string());
        }
        let destination = save_directory.join(format!("{date}.jpg"));
        download_image(&state.client, &image_url, &destination).await?;
        return Ok(Some(destination.to_string_lossy().into_owned()));
    }
    let suggested_folder = dialog_directory(&save_directory)?;
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "无法找到应用窗口".to_string())?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_parent(&window)
        .set_title("保存原图")
        .set_directory(suggested_folder)
        .set_file_name(format!("{date}.jpg"))
        .add_filter("JPEG 图片", &["jpg", "jpeg"])
        .save_file(move |selection| {
            let _ = sender.send(selection);
        });
    let Some(destination) = receiver
        .await
        .map_err(|_| "无法获取所选保存位置".to_string())?
    else {
        return Ok(None);
    };
    let destination = destination
        .into_path()
        .map_err(|error| format!("无法读取保存位置：{error}"))?;
    download_image(&state.client, &image_url, &destination).await?;
    Ok(Some(destination.to_string_lossy().into_owned()))
}

#[tauri::command]
fn get_app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

async fn prepare_software_update_inner<R: Runtime>(
    app: tauri::AppHandle<R>,
    download: bool,
) -> Result<SoftwareUpdateStatus, String> {
    let (client, update_lock, pending_update) = {
        let state = app.state::<AppState>();
        (
            state.client.clone(),
            state.software_update_lock.clone(),
            state.pending_software_update.clone(),
        )
    };
    let _guard = update_lock.lock().await;
    let current_version = app.package_info().version.to_string();

    if let Some(pending) = pending_update.lock().await.as_ref() {
        return Ok(SoftwareUpdateStatus {
            current_version,
            latest_version: pending.version.clone(),
            update_available: true,
            ready_to_restart: true,
        });
    }

    let updater = app
        .updater_builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("无法初始化更新服务：{error}"))?;
    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => {
            return Ok(SoftwareUpdateStatus {
                current_version: current_version.clone(),
                latest_version: current_version,
                update_available: false,
                ready_to_restart: false,
            });
        }
        Err(error) => {
            return fallback_release_status(&client, &current_version, error).await;
        }
    };

    let latest_version = update.version.clone();
    if !download {
        return Ok(SoftwareUpdateStatus {
            current_version,
            latest_version,
            update_available: true,
            ready_to_restart: false,
        });
    }

    let progress_app = app.clone();
    let mut downloaded = 0_u64;
    let bytes = update
        .download(
            move |chunk, total| {
                downloaded = downloaded.saturating_add(chunk as u64);
                let _ = progress_app.emit(
                    "software-update-progress",
                    SoftwareUpdateProgress { downloaded, total },
                );
            },
            || {},
        )
        .await
        .map_err(|error| format!("更新下载或签名校验失败：{error}"))?;

    *pending_update.lock().await = Some(PendingSoftwareUpdate {
        update,
        bytes,
        version: latest_version.clone(),
    });
    let _ = app.emit("software-update-ready", &latest_version);
    Ok(SoftwareUpdateStatus {
        current_version,
        latest_version,
        update_available: true,
        ready_to_restart: true,
    })
}

#[tauri::command]
async fn prepare_software_update<R: Runtime>(
    app: tauri::AppHandle<R>,
    download: bool,
) -> Result<SoftwareUpdateStatus, String> {
    prepare_software_update_inner(app, download).await
}

#[tauri::command]
async fn install_software_update<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let pending_update = app.state::<AppState>().pending_software_update.clone();
    let Some(pending) = pending_update.lock().await.take() else {
        return Err("更新尚未下载完成".to_string());
    };
    pending
        .update
        .install(&pending.bytes)
        .map_err(|error| format!("安装更新失败：{error}"))?;

    #[cfg(target_os = "macos")]
    app.restart();

    #[allow(unreachable_code)]
    Ok(())
}

#[tauri::command]
fn open_external<R: Runtime>(app: tauri::AppHandle<R>, url: String) -> Result<(), String> {
    let url = trusted_external_url(&url)?;
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|error| format!("无法打开链接：{error}"))
}

#[tauri::command]
fn open_lock_screen_settings<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        app.opener()
            .open_url("ms-settings:lockscreen", None::<&str>)
            .map_err(|error| format!("无法打开 Windows 锁屏设置：{error}"))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("此功能仅适用于 Windows".to_string())
    }
}

#[tauri::command]
fn open_wallpaper_cache<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    fs::create_dir_all(&state.wallpaper_cache)
        .map_err(|error| format!("无法创建壁纸缓存目录：{error}"))?;
    app.opener()
        .open_path(
            state.wallpaper_cache.to_string_lossy().into_owned(),
            None::<&str>,
        )
        .map_err(|error| format!("无法打开壁纸缓存目录：{error}"))
}

#[tauri::command]
fn get_save_directory(state: State<'_, AppState>) -> Result<String, String> {
    let settings = read_settings(&state.config_path);
    effective_save_directory(&settings).map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_save_directory<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let settings = read_settings(&state.config_path);
    let directory = effective_save_directory(&settings)?;
    if settings.save_directory.is_some() && !directory.is_dir() {
        return Err("所选保存目录已不可用，请在设置中重新选择".to_string());
    }
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建原图保存目录：{error}"))?;
    app.opener()
        .open_path(directory.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|error| format!("无法打开原图保存目录：{error}"))
}

#[tauri::command]
async fn choose_save_directory<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let settings = read_settings(&state.config_path);
    let current = effective_save_directory(&settings)
        .or_else(|_| dirs::home_dir().ok_or_else(|| "无法定位可选的文件夹".to_string()))?;
    let suggested_folder = dialog_directory(&current)?;
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "无法找到应用窗口".to_string())?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_parent(&window)
        .set_title("选择原图保存位置")
        .set_directory(suggested_folder)
        .pick_folder(move |selection| {
            let _ = sender.send(selection);
        });
    let Some(folder) = receiver
        .await
        .map_err(|_| "无法获取所选文件夹".to_string())?
    else {
        return Ok(None);
    };
    let folder = folder
        .into_path()
        .map_err(|error| format!("无法读取所选文件夹：{error}"))?;
    if !folder.is_dir() {
        return Err("所选保存位置不是文件夹".to_string());
    }
    let mut settings = read_settings(&state.config_path);
    settings.save_directory = Some(folder.clone());
    write_settings(&state.config_path, &settings)?;
    Ok(Some(folder.to_string_lossy().into_owned()))
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
    mut settings: Settings,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let autostart = app.autolaunch();
    let autostart_enabled = autostart
        .is_enabled()
        .map_err(|error| format!("无法读取开机启动状态：{error}"))?;
    if settings.auto_start != autostart_enabled {
        if settings.auto_start {
            autostart
                .enable()
                .map_err(|error| format!("无法启用开机启动：{error}"))?;
        } else {
            autostart
                .disable()
                .map_err(|error| format!("无法关闭开机启动：{error}"))?;
        }
    }
    settings.save_directory = read_settings(&state.config_path).save_directory;
    write_settings(&state.config_path, &settings)?;
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
    let (client, cache, config, guard, update_lock) = {
        let state = app.state::<AppState>();
        (
            state.client.clone(),
            state.wallpaper_cache.clone(),
            state.config_path.clone(),
            state.last_auto_update.clone(),
            state.auto_update_lock.clone(),
        )
    };
    let _update_guard = update_lock.lock().await;
    let settings = read_settings(&config);
    if !settings.auto_update {
        return Ok(());
    }
    let today = Local::now().format("%Y-%m-%d").to_string();
    let path = cache.join(format!("{today}.jpg"));
    let already_updated_today = guard
        .lock()
        .map_err(|_| "更新状态不可用".to_string())?
        .as_deref()
        == Some(&today);
    if should_reapply_cached_wallpaper(
        already_updated_today.then_some(today.as_str()),
        &today,
        path.is_file(),
    ) {
        platform::set_desktop_wallpaper(&path)?;
        {
            let state = app.state::<AppState>();
            remember_active_wallpaper(&state, &path)?;
        }
        let _ = app.emit("auto-update-complete", &today);
        return Ok(());
    }
    let wallpaper = fetch_wallpaper(&client, &today).await?;
    download_image(&client, &wallpaper.image_url, &path).await?;
    platform::set_desktop_wallpaper(&path)?;
    let lock_screen_warning = if cfg!(target_os = "windows") && settings.lock_screen {
        platform::set_lock_screen_wallpaper(&path).err()
    } else {
        None
    };
    {
        let state = app.state::<AppState>();
        remember_active_wallpaper(&state, &path)?;
    }
    *guard.lock().map_err(|_| "更新状态不可用".to_string())? = Some(today.clone());
    let _ = app.emit("auto-update-complete", &today);
    if let Some(warning) = lock_screen_warning {
        let _ = app.emit("auto-update-warning", warning);
    }
    Ok(())
}

#[tauri::command]
async fn run_auto_update<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    run_auto_update_once(app).await
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
    #[cfg(target_os = "macos")]
    {
        builder = builder.icon_as_template(true);
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
                active_wallpaper: Arc::new(Mutex::new(latest_cached_wallpaper(&cache_dir))),
                wallpaper_cache: cache_dir,
                last_auto_update: Arc::new(Mutex::new(None)),
                auto_update_lock: Arc::new(tokio::sync::Mutex::new(())),
                software_update_lock: Arc::new(tokio::sync::Mutex::new(())),
                pending_software_update: Arc::new(tokio::sync::Mutex::new(None)),
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
            #[cfg(target_os = "macos")]
            watch_display_reconnections(handle.clone());
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(15)).await;
                    if let Err(error) = run_auto_update_once(handle.clone()).await {
                        let _ = handle.emit("auto-update-error", error);
                    }
                    tokio::time::sleep(Duration::from_secs(15 * 60)).await;
                }
            });
            let update_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(8)).await;
                loop {
                    let auto_download = {
                        let state = update_handle.state::<AppState>();
                        read_settings(&state.config_path).auto_download_updates
                    };
                    if auto_download {
                        let _ = prepare_software_update_inner(update_handle.clone(), true).await;
                    }
                    tokio::time::sleep(Duration::from_secs(24 * 60 * 60)).await;
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
            run_auto_update,
            get_platform,
            get_app_version,
            prepare_software_update,
            install_software_update,
            open_external,
            open_lock_screen_settings,
            open_wallpaper_cache,
            get_save_directory,
            open_save_directory,
            choose_save_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running My Bing Wallpaper");
}

#[cfg(test)]
mod tests {
    use super::{
        effective_save_directory, parse_version, should_reapply_cached_wallpaper,
        trusted_external_url, Settings,
    };

    #[test]
    fn reuses_todays_cached_wallpaper_for_a_refresh() {
        assert!(should_reapply_cached_wallpaper(
            Some("2026-09-22"),
            "2026-09-22",
            true,
        ));
    }

    #[test]
    fn downloads_when_the_date_changed_or_the_cache_is_missing() {
        assert!(!should_reapply_cached_wallpaper(
            Some("2026-09-21"),
            "2026-09-22",
            true,
        ));
        assert!(!should_reapply_cached_wallpaper(
            Some("2026-09-22"),
            "2026-09-22",
            false,
        ));
    }

    #[test]
    fn only_opens_known_https_sites() {
        assert!(trusted_external_url("https://gitee.com/Hyman25/mybingwallpaper").is_ok());
        assert!(trusted_external_url("https://hanhuang22.github.io/mybingwallpaper/").is_ok());
        assert!(trusted_external_url("http://github.com/hanhuang22/mybingwallpaper").is_err());
        assert!(trusted_external_url("https://example.com/").is_err());
    }

    #[test]
    fn accepts_prefixed_release_versions() {
        assert_eq!(parse_version("v0.3.6").unwrap().to_string(), "0.3.6");
        assert!(parse_version("not-a-version").is_err());
    }

    #[test]
    fn migrates_existing_settings_with_safe_defaults() {
        let settings: Settings =
            serde_json::from_str(r#"{"autoUpdate":true,"autoStart":false,"lockScreen":false}"#)
                .unwrap();
        assert!(settings.auto_download_updates);
        assert_eq!(settings.theme, "system");
        assert!(settings.save_without_prompt);
        assert!(settings.save_directory.is_none());
    }

    #[test]
    fn keeps_the_selected_save_directory() {
        let directory = std::env::temp_dir().join("wallpaper-saves");
        let settings: Settings = serde_json::from_value(serde_json::json!({
            "saveWithoutPrompt": false,
            "saveDirectory": directory,
        }))
        .unwrap();
        assert!(!settings.save_without_prompt);
        assert_eq!(effective_save_directory(&settings).unwrap(), directory);
    }
}
