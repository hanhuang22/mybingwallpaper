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
    time::{Duration, SystemTime},
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, Runtime, State, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::{Update, UpdaterExt};
use url::Url;

const ARCHIVE_BASE: &str = "https://my-bing-wallpaper.oss-cn-beijing.aliyuncs.com/month";
const INCOMPLETE_CURRENT_MONTH_TTL: Duration = Duration::from_secs(5 * 60);
const GITEE_LATEST_RELEASE: &str =
    "https://gitee.com/api/v5/repos/Hyman25/mybingwallpaper/releases/latest";
const GITHUB_LATEST_RELEASE: &str =
    "https://api.github.com/repos/hanhuang22/mybingwallpaper/releases/latest";
struct AppState {
    client: Client,
    config_path: PathBuf,
    daily_wallpaper_state_path: PathBuf,
    wallpaper_cache: PathBuf,
    archive_cache: Arc<MonthArchiveCache>,
    active_wallpaper: Arc<Mutex<Option<PathBuf>>>,
    last_handled_wallpaper_date: Arc<Mutex<Option<String>>>,
    auto_update_lock: Arc<tokio::sync::Mutex<()>>,
    software_update_lock: Arc<tokio::sync::Mutex<()>>,
    pending_software_update: Arc<tokio::sync::Mutex<Option<PendingSoftwareUpdate>>>,
    quitting: Arc<std::sync::atomic::AtomicBool>,
}

struct MonthArchiveCache {
    directory: PathBuf,
    locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
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

#[derive(Debug, Clone, Deserialize)]
struct RemoteWallpaper {
    date: Option<String>,
    imgtitle: String,
    #[serde(default)]
    imgdesc: String,
    imgurl: String,
}

#[derive(Debug, Deserialize)]
struct BingModel {
    #[serde(rename = "MediaContents")]
    media_contents: Vec<BingMedia>,
}

#[derive(Debug, Deserialize)]
struct BingMedia {
    #[serde(rename = "Ssd")]
    ssd: String,
    #[serde(rename = "ImageContent")]
    image_content: BingImageContent,
}

#[derive(Debug, Deserialize)]
struct BingImageContent {
    #[serde(rename = "Description", default)]
    description: String,
    #[serde(rename = "Image")]
    image: BingImage,
}

#[derive(Debug, Deserialize)]
struct BingImage {
    #[serde(rename = "Url")]
    url: String,
}

#[derive(Debug, Deserialize)]
struct BingArchive {
    images: Vec<BingArchiveImage>,
}

#[derive(Debug, Deserialize)]
struct BingArchiveImage {
    enddate: String,
    urlbase: String,
    #[serde(default)]
    title: String,
    copyright: String,
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

fn validate_month(month: &str) -> Result<String, String> {
    if month.len() != 6 || !month.bytes().all(|digit| digit.is_ascii_digit()) {
        return Err("月份格式无效".to_string());
    }
    NaiveDate::parse_from_str(&format!("{month}01"), "%Y%m%d")
        .map(|_| month.to_string())
        .map_err(|_| "月份格式无效".to_string())
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

fn current_month_cache_is_fresh(
    month: &str,
    records: &HashMap<String, RemoteWallpaper>,
    modified: SystemTime,
    now: SystemTime,
    today: NaiveDate,
) -> bool {
    let current_month = today.format("%Y%m").to_string();
    if month < current_month.as_str() {
        return true;
    }
    if month > current_month.as_str() {
        return false;
    }
    let today_key = today.format("%Y%m%d").to_string();
    if records.get(&today_key).is_some_and(|record| {
        !record.imgtitle.trim().is_empty()
            && !record.imgdesc.trim().is_empty()
            && image_url(&record.imgurl).is_ok()
    }) {
        return true;
    }
    now.duration_since(modified)
        .is_ok_and(|age| age < INCOMPLETE_CURRENT_MONTH_TTL)
}

impl MonthArchiveCache {
    fn new(directory: PathBuf) -> Self {
        Self {
            directory,
            locks: Mutex::new(HashMap::new()),
        }
    }

    fn path(&self, month: &str) -> PathBuf {
        self.directory.join(format!("{month}.json"))
    }

    fn read(&self, month: &str) -> Option<(HashMap<String, RemoteWallpaper>, SystemTime)> {
        let path = self.path(month);
        let bytes = fs::read(&path).ok()?;
        let records = serde_json::from_slice(&bytes).ok()?;
        let modified = fs::metadata(path).ok()?.modified().ok()?;
        Some((records, modified))
    }

    async fn get(
        &self,
        client: &Client,
        month: &str,
        force_refresh: bool,
    ) -> Result<HashMap<String, RemoteWallpaper>, String> {
        let month = validate_month(month)?;
        let month_lock = {
            let mut locks = self
                .locks
                .lock()
                .map_err(|_| "壁纸缓存状态不可用".to_string())?;
            locks
                .entry(month.clone())
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
                .clone()
        };
        let _guard = month_lock.lock().await;
        let cached = self.read(&month);
        if let Some((records, modified)) = &cached {
            if !force_refresh
                && current_month_cache_is_fresh(
                    &month,
                    records,
                    *modified,
                    SystemTime::now(),
                    Local::now().date_naive(),
                )
            {
                return Ok(records.clone());
            }
        }

        match fetch_month_archive(client, &month).await {
            Ok((records, bytes)) => {
                if let Err(error) = fs::write(self.path(&month), bytes) {
                    eprintln!("无法写入月度壁纸缓存：{error}");
                }
                Ok(records)
            }
            Err(error) => cached.map(|(records, _)| records).ok_or(error),
        }
    }
}

async fn fetch_month_archive(
    client: &Client,
    month: &str,
) -> Result<(HashMap<String, RemoteWallpaper>, Vec<u8>), String> {
    let response = client
        .get(format!("{ARCHIVE_BASE}/{month}.json"))
        .send()
        .await
        .map_err(|error| format!("获取壁纸信息失败：{error}"))?
        .error_for_status()
        .map_err(|error| format!("壁纸数据服务异常：{error}"))?;
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("读取壁纸数据失败：{error}"))?;
    let records = serde_json::from_slice::<HashMap<String, RemoteWallpaper>>(&bytes)
        .map_err(|error| format!("壁纸数据解析失败：{error}"))?;
    Ok((records, bytes.to_vec()))
}

fn wallpaper_from_live_bing(
    date: &str,
    model: Option<&BingModel>,
    archive: &BingArchive,
) -> Result<Wallpaper, String> {
    let key = date.replace('-', "");
    let archive_image = archive
        .images
        .iter()
        .find(|image| image.enddate == key)
        .ok_or_else(|| "Bing 尚未发布今日壁纸".to_string())?;
    if !archive_image.urlbase.starts_with("/th?id=OHR.") {
        return Err("Bing 图片地址格式无效".to_string());
    }
    let archive_image_id = bing_image_id(&archive_image.urlbase);
    let description = model
        .and_then(|model| {
            model.media_contents.iter().find(|media| {
                media.ssd.starts_with(&key)
                    && archive_image_id.as_deref().is_some_and(|archive_id| {
                        bing_image_id(&media.image_content.image.url)
                            .as_deref()
                            .and_then(|model_id| model_id.strip_prefix(archive_id))
                            .is_some_and(|suffix| suffix.starts_with('_'))
                    })
            })
        })
        .map(|media| media.image_content.description.clone())
        .unwrap_or_default();
    let url = format!("https://cn.bing.com{}_UHD.jpg", archive_image.urlbase);
    image_url(&url)?;
    Ok(Wallpaper {
        date: date.to_string(),
        title: format!(
            "{}  |  {}  -  {}",
            if archive_image.title.trim().is_empty() {
                "必应每日壁纸"
            } else {
                archive_image.title.trim()
            },
            archive_image.copyright.trim(),
            date.replace('-', "/")
        ),
        description,
        image_url: url,
    })
}

fn bing_image_id(raw: &str) -> Option<String> {
    let url = Url::parse(raw)
        .or_else(|_| Url::parse("https://www.bing.com")?.join(raw))
        .ok()?;
    let host = url.host_str()?.to_ascii_lowercase();
    if url.scheme() != "https"
        || !(host == "bing.com"
            || host.ends_with(".bing.com")
            || host == "bing.net"
            || host.ends_with(".bing.net"))
        || url.path() != "/th"
    {
        return None;
    }
    url.query_pairs()
        .find(|(name, _)| name == "id")
        .map(|(_, id)| id.into_owned())
        .filter(|id| id.starts_with("OHR."))
}

async fn fetch_bing_model(client: &Client, endpoint: &str) -> Result<BingModel, reqwest::Error> {
    client
        .get(endpoint)
        .timeout(Duration::from_secs(8))
        .send()
        .await?
        .error_for_status()?
        .json::<BingModel>()
        .await
}

async fn fetch_live_today_wallpaper(client: &Client, date: &str) -> Result<Wallpaper, String> {
    let archive = client
        .get("https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=zh-CN")
        .send()
        .await
        .map_err(|error| format!("获取 Bing 日期信息失败：{error}"))?
        .error_for_status()
        .map_err(|error| format!("Bing 日期服务异常：{error}"))?
        .json::<BingArchive>()
        .await
        .map_err(|error| format!("Bing 日期信息解析失败：{error}"))?;
    let mut wallpaper = wallpaper_from_live_bing(date, None, &archive)?;
    let (cn_model, www_model) = tokio::join!(
        fetch_bing_model(client, "https://cn.bing.com/hp/api/model?mkt=zh-CN"),
        fetch_bing_model(client, "https://www.bing.com/hp/api/model?mkt=zh-CN"),
    );
    for model in [cn_model.ok(), www_model.ok()].into_iter().flatten() {
        let candidate = wallpaper_from_live_bing(date, Some(&model), &archive)?;
        if !candidate.description.trim().is_empty() {
            wallpaper.description = candidate.description;
            break;
        }
    }
    Ok(wallpaper)
}

async fn fetch_wallpaper(
    client: &Client,
    archive_cache: &MonthArchiveCache,
    date: &str,
    force_refresh: bool,
) -> Result<Wallpaper, String> {
    let date = validate_date(date)?;
    let key = date.replace('-', "");
    let is_today = date == Local::now().format("%Y-%m-%d").to_string();
    let records = match archive_cache.get(client, &key[..6], force_refresh).await {
        Ok(records) => records,
        Err(error) if is_today => {
            return fetch_live_today_wallpaper(client, &date)
                .await
                .map_err(|live_error| format!("{error}；{live_error}"));
        }
        Err(error) => return Err(error),
    };
    if let Some(record) = records.get(&key) {
        image_url(&record.imgurl)?;
        return Ok(Wallpaper {
            date: record.date.clone().unwrap_or(date),
            title: record.imgtitle.clone(),
            description: record.imgdesc.clone(),
            image_url: record.imgurl.clone(),
        });
    }
    if is_today {
        return fetch_live_today_wallpaper(client, &date).await;
    }
    Err("没有找到这一天的壁纸".to_string())
}

async fn fetch_month_wallpapers(
    client: &Client,
    archive_cache: &MonthArchiveCache,
    month: &str,
    force_refresh: bool,
) -> Result<Vec<Wallpaper>, String> {
    let month = validate_month(month)?;
    let records = archive_cache.get(client, &month, force_refresh).await?;
    let mut wallpapers = Vec::with_capacity(records.len());
    for (key, record) in records {
        if !key.starts_with(&month) || key.len() != 8 || image_url(&record.imgurl).is_err() {
            continue;
        }
        let Ok(date) = NaiveDate::parse_from_str(&key, "%Y%m%d") else {
            continue;
        };
        wallpapers.push(Wallpaper {
            date: date.format("%Y-%m-%d").to_string(),
            title: record.imgtitle,
            description: record.imgdesc,
            image_url: record.imgurl,
        });
    }
    wallpapers.sort_by(|left, right| left.date.cmp(&right.date));
    Ok(wallpapers)
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

fn should_skip_auto_update(last_handled_date: Option<&str>, today: &str) -> bool {
    last_handled_date == Some(today)
}

#[derive(Serialize, Deserialize)]
struct DailyWallpaperState {
    date: String,
    image_url: String,
}

fn read_daily_wallpaper_state(path: &Path) -> Option<String> {
    let saved: DailyWallpaperState = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    validate_date(&saved.date).ok()
}

fn write_daily_wallpaper_state(path: &Path, date: &str, image_url: &str) -> Result<(), String> {
    let contents = serde_json::to_vec_pretty(&DailyWallpaperState {
        date: date.to_string(),
        image_url: image_url.to_string(),
    })
    .map_err(|error| format!("无法序列化每日壁纸状态：{error}"))?;
    fs::write(path, contents).map_err(|error| format!("无法保存每日壁纸状态：{error}"))
}

fn remember_daily_wallpaper(state: &AppState, date: &str, image_url: &str) -> Result<(), String> {
    *state
        .last_handled_wallpaper_date
        .lock()
        .map_err(|_| "自动更新状态不可用".to_string())? = Some(date.to_string());
    if let Err(error) =
        write_daily_wallpaper_state(&state.daily_wallpaper_state_path, date, image_url)
    {
        // The wallpaper is already applied; do not report the whole operation as failed.
        eprintln!("无法保存每日壁纸状态，下次启动可能重复应用：{error}");
    }
    Ok(())
}

fn cached_wallpaper_image_is_usable(path: &Path) -> bool {
    fs::metadata(path).is_ok_and(|metadata| metadata.is_file() && metadata.len() >= 1024)
}

fn wallpaper_cache_path(cache: &Path, date: &str, image_url: &str) -> PathBuf {
    // A different image for the same date must have a different file URL.
    // macOS may keep displaying the previous image when a desktop image file is overwritten.
    let fingerprint = image_url
        .bytes()
        .fold(0xcbf29ce484222325_u64, |hash, byte| {
            (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
        });
    cache.join(format!("{date}-{fingerprint:016x}.jpg"))
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
async fn get_wallpaper(
    date: String,
    force_refresh: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Wallpaper, String> {
    fetch_wallpaper(
        &state.client,
        &state.archive_cache,
        &date,
        force_refresh.unwrap_or(false),
    )
    .await
}

#[tauri::command]
async fn get_month_wallpapers(
    month: String,
    force_refresh: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Vec<Wallpaper>, String> {
    fetch_month_wallpapers(
        &state.client,
        &state.archive_cache,
        &month,
        force_refresh.unwrap_or(false),
    )
    .await
}

#[tauri::command]
async fn apply_wallpaper(
    image_url: String,
    date: String,
    set_lock_screen: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let _update_guard = state.auto_update_lock.lock().await;
    let date = validate_date(&date)?;
    let path = wallpaper_cache_path(&state.wallpaper_cache, &date, &image_url);
    if !cached_wallpaper_image_is_usable(&path) {
        download_image(&state.client, &image_url, &path).await?;
    }
    platform::set_desktop_wallpaper(&path)?;
    remember_active_wallpaper(&state, &path)?;
    remember_daily_wallpaper(
        &state,
        &Local::now().format("%Y-%m-%d").to_string(),
        &image_url,
    )?;
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

#[tauri::command]
fn set_window_appearance<R: Runtime>(app: tauri::AppHandle<R>, mode: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let theme = match mode.as_str() {
            "system" => None,
            "light" => Some(tauri::Theme::Light),
            "dark" => Some(tauri::Theme::Dark),
            _ => return Err("外观模式无效".to_string()),
        };
        let window = app.get_webview_window("main").ok_or("主窗口不可用")?;
        window
            .set_theme(theme)
            .map_err(|error| format!("无法设置窗口主题：{error}"))?;
    }
    #[cfg(not(target_os = "windows"))]
    let _ = (app, mode);
    Ok(())
}

async fn run_auto_update_once<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let (client, cache, archive_cache, config, guard, update_lock) = {
        let state = app.state::<AppState>();
        (
            state.client.clone(),
            state.wallpaper_cache.clone(),
            state.archive_cache.clone(),
            state.config_path.clone(),
            state.last_handled_wallpaper_date.clone(),
            state.auto_update_lock.clone(),
        )
    };
    let _update_guard = update_lock.lock().await;
    let settings = read_settings(&config);
    if !settings.auto_update {
        return Ok(());
    }
    let today = Local::now().format("%Y-%m-%d").to_string();
    let last_handled_date = guard
        .lock()
        .map_err(|_| "更新状态不可用".to_string())?
        .clone();
    if should_skip_auto_update(last_handled_date.as_deref(), &today) {
        return Ok(());
    }
    let wallpaper = fetch_wallpaper(&client, &archive_cache, &today, false).await?;
    let path = wallpaper_cache_path(&cache, &today, &wallpaper.image_url);
    if !cached_wallpaper_image_is_usable(&path) {
        download_image(&client, &wallpaper.image_url, &path).await?;
    }
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
    {
        let state = app.state::<AppState>();
        remember_daily_wallpaper(&state, &today, &wallpaper.image_url)?;
    }
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

fn show_main_window<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("main-window-reset-view", ());
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn opens_main_window_on_tray_click(button: MouseButton, state: MouseButtonState) -> bool {
    let opening_state = if cfg!(target_os = "macos") {
        MouseButtonState::Down
    } else {
        MouseButtonState::Up
    };
    button == MouseButton::Left && state == opening_state
}

fn build_tray<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let today = MenuItem::with_id(app, "today", "应用今日壁纸", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &today, &separator, &quit])?;
    let mut builder = TrayIconBuilder::with_id("main").show_menu_on_left_click(false);
    // An attached NSStatusItem menu can consume left clicks before Tauri sees them.
    // On macOS, keep it detached and present it only for an explicit right click.
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.menu(&menu);
    }
    #[cfg(target_os = "macos")]
    let context_menu = menu.clone();

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    #[cfg(target_os = "macos")]
    {
        builder = builder.icon_as_template(true);
    }
    builder
        .on_tray_icon_event(move |tray, event| {
            if let TrayIconEvent::Click {
                button,
                button_state,
                ..
            } = event
            {
                if opens_main_window_on_tray_click(button, button_state) {
                    show_main_window(tray.app_handle());
                }
                #[cfg(target_os = "macos")]
                if button == MouseButton::Right && button_state == MouseButtonState::Down {
                    if let Some(window) = tray.app_handle().get_webview_window("main") {
                        let _ = window.popup_menu(&context_menu);
                    }
                }
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "today" => {
                show_main_window(app);
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
            let archive_cache_dir = app.path().app_cache_dir()?.join("archive-json");
            let daily_wallpaper_state_path = config_dir.join("daily-wallpaper.json");
            fs::create_dir_all(&config_dir)?;
            fs::create_dir_all(&cache_dir)?;
            fs::create_dir_all(&archive_cache_dir)?;
            let client = Client::builder()
                .timeout(Duration::from_secs(15))
                .user_agent("MyBingWallpaper/0.3")
                .build()
                .map_err(|error| Box::<dyn std::error::Error>::from(error))?;
            app.manage(AppState {
                client,
                config_path: config_dir.join("settings.json"),
                daily_wallpaper_state_path: daily_wallpaper_state_path.clone(),
                active_wallpaper: Arc::new(Mutex::new(latest_cached_wallpaper(&cache_dir))),
                wallpaper_cache: cache_dir,
                archive_cache: Arc::new(MonthArchiveCache::new(archive_cache_dir)),
                last_handled_wallpaper_date: Arc::new(Mutex::new(read_daily_wallpaper_state(
                    &daily_wallpaper_state_path,
                ))),
                auto_update_lock: Arc::new(tokio::sync::Mutex::new(())),
                software_update_lock: Arc::new(tokio::sync::Mutex::new(())),
                pending_software_update: Arc::new(tokio::sync::Mutex::new(None)),
                quitting: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            });
            build_tray(app)?;

            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                window.set_decorations(false)?;
                // Tauri's undecorated shadow reserves a native 1px strip above the webview.
                window.set_shadow(false)?;
                platform::style_borderless_window(window.hwnd()?);
            }

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
                    let _ = window.emit("main-window-reset-view", ());
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_wallpaper,
            get_month_wallpapers,
            apply_wallpaper,
            save_wallpaper,
            load_settings,
            save_settings,
            run_auto_update,
            get_platform,
            set_window_appearance,
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
        .build(tauri::generate_context!())
        .expect("error while building My Bing Wallpaper")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } = event
            {
                show_main_window(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}

#[cfg(test)]
mod tests {
    use super::{
        bing_image_id, cached_wallpaper_image_is_usable, current_month_cache_is_fresh,
        effective_save_directory, opens_main_window_on_tray_click, parse_version,
        read_daily_wallpaper_state, should_skip_auto_update, trusted_external_url, validate_month,
        wallpaper_cache_path, wallpaper_from_live_bing, write_daily_wallpaper_state, BingArchive,
        BingModel, MonthArchiveCache, RemoteWallpaper, Settings,
    };
    use chrono::NaiveDate;
    use std::{
        collections::HashMap,
        fs,
        path::Path,
        time::{Duration, SystemTime},
    };
    use tauri::tray::{MouseButton, MouseButtonState};

    #[test]
    fn accepts_only_real_archive_months() {
        assert_eq!(validate_month("202609").unwrap(), "202609");
        assert!(validate_month("202613").is_err());
        assert!(validate_month("2026-09").is_err());
        assert!(validate_month("202609/extra").is_err());
    }

    #[test]
    fn tray_opens_on_the_platforms_reliable_left_click_event() {
        let opening_state = if cfg!(target_os = "macos") {
            MouseButtonState::Down
        } else {
            MouseButtonState::Up
        };
        let other_state = if opening_state == MouseButtonState::Down {
            MouseButtonState::Up
        } else {
            MouseButtonState::Down
        };
        assert!(opens_main_window_on_tray_click(
            MouseButton::Left,
            opening_state
        ));
        assert!(!opens_main_window_on_tray_click(
            MouseButton::Left,
            other_state
        ));
        assert!(!opens_main_window_on_tray_click(
            MouseButton::Right,
            opening_state
        ));
    }

    #[test]
    fn does_not_restore_todays_auto_wallpaper_after_a_manual_choice() {
        assert!(should_skip_auto_update(Some("2026-09-22"), "2026-09-22"));
    }

    #[test]
    fn auto_updates_again_on_the_next_day() {
        assert!(!should_skip_auto_update(Some("2026-09-21"), "2026-09-22"));
        assert!(!should_skip_auto_update(None, "2026-09-22"));
    }

    #[test]
    fn historical_archive_remains_fresh_and_future_archive_does_not() {
        let today = NaiveDate::from_ymd_opt(2026, 9, 29).unwrap();
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(100_000);
        let records = HashMap::new();
        assert!(current_month_cache_is_fresh(
            "202608",
            &records,
            SystemTime::UNIX_EPOCH,
            now,
            today
        ));
        assert!(!current_month_cache_is_fresh(
            "202610", &records, now, now, today
        ));
    }

    #[test]
    fn current_archive_without_complete_today_expires_after_five_minutes() {
        let today = NaiveDate::from_ymd_opt(2026, 9, 29).unwrap();
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(100_000);
        let mut records = HashMap::new();
        assert!(current_month_cache_is_fresh(
            "202609",
            &records,
            now - Duration::from_secs(299),
            now,
            today
        ));
        assert!(!current_month_cache_is_fresh(
            "202609",
            &records,
            now - Duration::from_secs(300),
            now,
            today
        ));

        records.insert(
            "20260929".to_string(),
            RemoteWallpaper {
                date: None,
                imgtitle: "今日壁纸".to_string(),
                imgdesc: String::new(),
                imgurl: "https://cn.bing.com/th?id=OHR.Today_UHD.jpg".to_string(),
            },
        );
        assert!(!current_month_cache_is_fresh(
            "202609",
            &records,
            SystemTime::UNIX_EPOCH,
            now,
            today
        ));
        records.get_mut("20260929").unwrap().imgdesc = "完整说明".to_string();
        assert!(current_month_cache_is_fresh(
            "202609",
            &records,
            SystemTime::UNIX_EPOCH,
            now,
            today
        ));

        let tomorrow = NaiveDate::from_ymd_opt(2026, 9, 30).unwrap();
        assert!(!current_month_cache_is_fresh(
            "202609",
            &records,
            SystemTime::UNIX_EPOCH,
            now,
            tomorrow
        ));
    }

    #[test]
    fn daily_wallpaper_marker_survives_restart_and_ignores_bad_data() {
        let path = std::env::temp_dir().join(format!(
            "mybingwallpaper-daily-state-{}-{}.json",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));
        write_daily_wallpaper_state(
            &path,
            "2026-09-29",
            "https://cn.bing.com/th?id=OHR.Today_UHD.jpg",
        )
        .unwrap();
        assert_eq!(
            read_daily_wallpaper_state(&path).as_deref(),
            Some("2026-09-29")
        );
        fs::write(&path, b"invalid").unwrap();
        assert_eq!(read_daily_wallpaper_state(&path), None);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn monthly_json_has_its_own_persistent_cache_directory() {
        let directory = std::env::temp_dir().join(format!(
            "mybingwallpaper-archive-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));
        fs::create_dir_all(&directory).unwrap();
        let cache = MonthArchiveCache::new(directory.clone());
        let path = cache.path("202608");
        assert_eq!(path, directory.join("202608.json"));
        fs::write(
            &path,
            r#"{"20260831":{"imgtitle":"历史壁纸","imgdesc":"说明","imgurl":"https://cn.bing.com/th?id=OHR.Old_UHD.jpg"}}"#,
        )
        .unwrap();
        let reopened = MonthArchiveCache::new(directory.clone());
        assert_eq!(reopened.read("202608").unwrap().0.len(), 1);
        fs::remove_file(path).unwrap();
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn only_reuses_nonempty_cached_wallpaper_images() {
        let path = std::env::temp_dir().join(format!(
            "mybingwallpaper-image-test-{}-{}.jpg",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));
        assert!(!cached_wallpaper_image_is_usable(&path));
        fs::write(&path, [0_u8; 1023]).unwrap();
        assert!(!cached_wallpaper_image_is_usable(&path));
        fs::write(&path, [0_u8; 1024]).unwrap();
        assert!(cached_wallpaper_image_is_usable(&path));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn cache_path_changes_when_a_dates_image_is_corrected() {
        let cache = Path::new("wallpaper-cache");
        let old = wallpaper_cache_path(cache, "2026-09-28", "https://bing.com/DecoCrab.jpg");
        let corrected = wallpaper_cache_path(cache, "2026-09-28", "https://bing.com/AmberHall.jpg");
        assert_ne!(old, corrected);
        assert_eq!(
            corrected,
            wallpaper_cache_path(cache, "2026-09-28", "https://bing.com/AmberHall.jpg")
        );
    }

    #[test]
    fn live_today_uses_the_dated_archive_when_model_metadata_disagrees() {
        let mut model: BingModel = serde_json::from_value(serde_json::json!({
            "MediaContents": [{
                "Ssd": "20260929",
                "ImageContent": {
                    "Headline": "冰川孕育之河",
                    "Title": "阿拉斯加的一条河流",
                    "Copyright": "© Example/Getty Images",
                    "Description": "冰川融水形成的河流。",
                    "Image": {"Url": "/th?id=OHR.KasilofRiver_ZH-CN2394091052_1920x1080.webp"}
                }
            }]
        }))
        .unwrap();
        let mut archive: BingArchive = serde_json::from_value(serde_json::json!({
            "images": [{
                "enddate": "20260929",
                "urlbase": "/th?id=OHR.KasilofRiver_ZH-CN2394091052",
                "title": "冰川孕育之河",
                "copyright": "阿拉斯加的一条河流 © Example/Getty Images"
            }]
        }))
        .unwrap();
        let wallpaper = wallpaper_from_live_bing("2026-09-29", Some(&model), &archive).unwrap();
        assert_eq!(wallpaper.date, "2026-09-29");
        assert_eq!(wallpaper.description, "冰川融水形成的河流。");
        assert_eq!(
            wallpaper.image_url,
            "https://cn.bing.com/th?id=OHR.KasilofRiver_ZH-CN2394091052_UHD.jpg"
        );

        model.media_contents[0].image_content.image.url =
            "https://ts1.tc.mm.bing.net/th?id=OHR.KasilofRiver_ZH-CN2394091052_1920x1080.webp"
                .to_string();
        let absolute_url = wallpaper_from_live_bing("2026-09-29", Some(&model), &archive).unwrap();
        assert_eq!(absolute_url.description, "冰川融水形成的河流。");

        model.media_contents[0].image_content.image.url =
            "/th?id=OHR.Different_ZH-CN123_1920x1080.webp".to_string();
        let mismatched = wallpaper_from_live_bing("2026-09-29", Some(&model), &archive).unwrap();
        assert_eq!(mismatched.image_url, wallpaper.image_url);
        assert!(mismatched.description.is_empty());
        assert!(wallpaper_from_live_bing("2026-09-29", None, &archive).is_ok());

        archive.images[0].enddate = "20260928".to_string();
        assert!(wallpaper_from_live_bing("2026-09-29", None, &archive).is_err());
    }

    #[test]
    fn bing_description_image_id_requires_a_bing_image_url() {
        assert_eq!(
            bing_image_id("https://ts1.tc.mm.bing.net/th?id=OHR.Test_ZH-CN123_1920x1080.webp"),
            Some("OHR.Test_ZH-CN123_1920x1080.webp".to_string())
        );
        assert!(
            bing_image_id("https://example.com/th?id=OHR.Test_ZH-CN123_1920x1080.webp").is_none()
        );
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
