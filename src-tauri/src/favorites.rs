use chrono::{Local, TimeZone};
use image::{imageops::FilterType, DynamicImage, ImageDecoder, ImageFormat, ImageReader};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WallpaperMode {
    #[default]
    Off,
    Daily,
    FavoritesSequential,
    FavoritesRandom,
}

impl WallpaperMode {
    pub fn is_favorites(self) -> bool {
        matches!(self, Self::FavoritesSequential | Self::FavoritesRandom)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FavoriteSource {
    Bing,
    Local,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredFavorite {
    id: String,
    extension: String,
    source: FavoriteSource,
    date: Option<String>,
    title: String,
    description: String,
    source_url: Option<String>,
    added_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Favorite {
    pub id: String,
    pub source: FavoriteSource,
    pub date: Option<String>,
    pub title: String,
    pub description: String,
    pub source_url: Option<String>,
    pub image_path: PathBuf,
    pub thumbnail_path: PathBuf,
    pub added_at: i64,
}

#[derive(Clone)]
pub struct FavoriteStore {
    directory: PathBuf,
}

pub struct FavoriteDetails {
    pub source: FavoriteSource,
    pub date: Option<String>,
    pub title: String,
    pub description: String,
    pub source_url: Option<String>,
}

pub fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let bytes =
        serde_json::to_vec_pretty(value).map_err(|error| format!("数据序列化失败：{error}"))?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, bytes).map_err(|error| format!("数据写入失败：{error}"))?;
    fs::rename(&temporary, path).map_err(|error| format!("数据保存失败：{error}"))
}

fn decode_image(bytes: &[u8], format: ImageFormat) -> Result<DynamicImage, String> {
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(256 * 1024 * 1024);
    reader.limits(limits);
    let mut decoder = reader
        .into_decoder()
        .map_err(|error| format!("图片无法解码：{error}"))?;
    let orientation = decoder
        .orientation()
        .unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut image =
        DynamicImage::from_decoder(decoder).map_err(|error| format!("图片无法解码：{error}"))?;
    image.apply_orientation(orientation);
    Ok(image)
}

pub fn desktop_copy(favorite: &Favorite, cache: &Path) -> Result<PathBuf, String> {
    let destination = cache.join(format!("favorite-{}.jpg", favorite.id));
    if fs::metadata(&destination).is_ok_and(|metadata| metadata.is_file() && metadata.len() > 0) {
        return Ok(destination);
    }
    let bytes =
        fs::read(&favorite.image_path).map_err(|error| format!("无法读取收藏图片：{error}"))?;
    let format = image::guess_format(&bytes).map_err(|_| "无法识别收藏图片格式")?;
    let temporary = destination.with_extension("tmp.jpg");
    if format == ImageFormat::Jpeg {
        fs::write(&temporary, bytes).map_err(|error| format!("无法复制壁纸：{error}"))?;
    } else {
        let image = decode_image(&bytes, format)?.to_rgb8();
        let file =
            fs::File::create(&temporary).map_err(|error| format!("无法保存桌面图片：{error}"))?;
        image::codecs::jpeg::JpegEncoder::new_with_quality(file, 95)
            .encode_image(&image)
            .map_err(|error| format!("无法转换桌面图片：{error}"))?;
    }
    fs::rename(temporary, &destination).map_err(|error| format!("无法保存桌面图片：{error}"))?;
    Ok(destination)
}

impl FavoriteStore {
    pub fn new(directory: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(directory.join("images"))
            .map_err(|error| format!("无法创建收藏目录：{error}"))?;
        fs::create_dir_all(directory.join("thumbnails"))
            .map_err(|error| format!("无法创建缩略图目录：{error}"))?;
        Ok(Self { directory })
    }

    fn records(&self) -> Result<Vec<StoredFavorite>, String> {
        let path = self.directory.join("favorites.json");
        let bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
            Err(error) => return Err(format!("无法读取收藏：{error}")),
        };
        let records: Vec<StoredFavorite> = serde_json::from_slice(&bytes)
            .map_err(|error| format!("收藏数据无法读取，请保留收藏目录后重试：{error}"))?;
        if records.iter().any(|record| {
            record.id.len() != 64
                || !record.id.bytes().all(|byte| byte.is_ascii_hexdigit())
                || !matches!(record.extension.as_str(), "jpg" | "png" | "webp" | "bmp")
        }) {
            return Err("收藏记录中的图片路径无效".to_string());
        }
        Ok(records)
    }

    fn favorite(&self, record: &StoredFavorite) -> Favorite {
        Favorite {
            id: record.id.clone(),
            source: record.source,
            date: record.date.clone(),
            title: record.title.clone(),
            description: record.description.clone(),
            source_url: record.source_url.clone(),
            added_at: record.added_at,
            image_path: self
                .directory
                .join("images")
                .join(format!("{}.{}", record.id, record.extension)),
            thumbnail_path: self
                .directory
                .join("thumbnails")
                .join(format!("{}.jpg", record.id)),
        }
    }

    pub fn list(&self) -> Result<Vec<Favorite>, String> {
        self.records()
            .map(|records| records.iter().map(|record| self.favorite(record)).collect())
    }

    pub fn add(&self, bytes: &[u8], details: FavoriteDetails) -> Result<(Favorite, bool), String> {
        if bytes.is_empty() || bytes.len() > 50 * 1024 * 1024 {
            return Err("图片为空或超过 50 MB".to_string());
        }
        let mut records = self.records()?;
        let id = format!("{:x}", Sha256::digest(bytes));
        if let Some(index) = records.iter().position(|record| record.id == id) {
            let existing = &records[index];
            let favorite = self.favorite(existing);
            if favorite.image_path.is_file() && favorite.thumbnail_path.is_file() {
                if existing.source_url.is_none() && details.source_url.is_some() {
                    records[index].source_url = details.source_url;
                    write_json(&self.directory.join("favorites.json"), &records)?;
                }
                return Ok((self.favorite(&records[index]), false));
            }
        }
        let format = image::guess_format(bytes).map_err(|_| "无法识别图片格式".to_string())?;
        let extension = match format {
            ImageFormat::Jpeg => "jpg",
            ImageFormat::Png => "png",
            ImageFormat::WebP => "webp",
            ImageFormat::Bmp => "bmp",
            _ => return Err("支持 JPG、PNG、WebP 和 BMP 图片".to_string()),
        };
        let image = decode_image(bytes, format)?;
        let record = StoredFavorite {
            id,
            extension: extension.to_string(),
            source: details.source,
            date: details.date,
            title: details.title,
            description: details.description,
            source_url: details.source_url,
            added_at: Local::now().timestamp_millis(),
        };
        let favorite = self.favorite(&record);
        fs::write(&favorite.image_path, bytes)
            .map_err(|error| format!("无法保存收藏图片：{error}"))?;
        image
            .resize_to_fill(400, 225, FilterType::Lanczos3)
            .to_rgb8()
            .save_with_format(&favorite.thumbnail_path, ImageFormat::Jpeg)
            .map_err(|error| format!("无法生成收藏缩略图：{error}"))?;
        let added = !records.iter().any(|existing| existing.id == record.id);
        records.retain(|existing| existing.id != record.id);
        records.push(record);
        write_json(&self.directory.join("favorites.json"), &records)?;
        Ok((favorite, added))
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let mut records = self.records()?;
        let Some(index) = records.iter().position(|record| record.id == id) else {
            return Ok(());
        };
        let removed = self.favorite(&records.remove(index));
        write_json(&self.directory.join("favorites.json"), &records)?;
        // Only managed copies are removed. The original import and applied wallpaper are separate.
        let _ = fs::remove_file(removed.image_path);
        let _ = fs::remove_file(removed.thumbnail_path);
        Ok(())
    }
}

pub fn supported_import(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "jpg" | "jpeg" | "png" | "webp" | "bmp"
            )
        })
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RotationState {
    pub mode: WallpaperMode,
    pub last_id: Option<String>,
    pub last_applied_at: i64,
    pub active_path: Option<PathBuf>,
}

pub fn rotation_due(state: &RotationState, mode: WallpaperMode, minutes: u64, now: i64) -> bool {
    if state.mode != mode || state.last_applied_at == 0 {
        return true;
    }
    if minutes == 1440 {
        let previous = Local
            .timestamp_opt(state.last_applied_at, 0)
            .single()
            .map(|time| time.date_naive());
        let current = Local
            .timestamp_opt(now, 0)
            .single()
            .map(|time| time.date_naive());
        return previous != current;
    }
    now.saturating_sub(state.last_applied_at) >= (minutes * 60) as i64
}

pub fn next_favorite_index(
    ids: &[String],
    last_id: Option<&str>,
    random: bool,
    entropy: u64,
) -> Option<usize> {
    if ids.is_empty() {
        return None;
    }
    let previous = last_id.and_then(|id| ids.iter().position(|candidate| candidate == id));
    if !random {
        return Some(previous.map_or(0, |index| (index + 1) % ids.len()));
    }
    if ids.len() == 1 {
        return Some(0);
    }
    let candidates: Vec<_> = (0..ids.len())
        .filter(|index| Some(*index) != previous)
        .collect();
    Some(candidates[entropy as usize % candidates.len()])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotation_wraps_skips_immediate_random_repeats_and_handles_removal() {
        let ids = vec!["a".into(), "b".into(), "c".into()];
        assert_eq!(next_favorite_index(&ids, Some("c"), false, 0), Some(0));
        assert_eq!(
            next_favorite_index(&ids, Some("removed"), false, 0),
            Some(0)
        );
        assert_eq!(next_favorite_index(&[], None, true, 0), None);
        for entropy in 0..20 {
            assert_ne!(next_favorite_index(&ids, Some("b"), true, entropy), Some(1));
        }
    }

    #[test]
    fn rotation_waits_after_manual_apply_and_is_due_when_mode_changes() {
        let state = RotationState {
            mode: WallpaperMode::FavoritesSequential,
            last_applied_at: 100,
            ..Default::default()
        };
        assert!(!rotation_due(&state, state.mode, 60, 3699));
        assert!(rotation_due(&state, state.mode, 60, 3700));
        assert!(rotation_due(
            &state,
            WallpaperMode::FavoritesRandom,
            60,
            101
        ));
    }

    #[test]
    fn daily_favorites_wait_until_local_date_changes_after_restart() {
        let yesterday = Local
            .with_ymd_and_hms(2026, 10, 11, 23, 58, 0)
            .single()
            .unwrap();
        let state = RotationState {
            mode: WallpaperMode::FavoritesRandom,
            last_id: Some("a".into()),
            last_applied_at: yesterday.timestamp(),
            active_path: None,
        };
        let restored: RotationState =
            serde_json::from_slice(&serde_json::to_vec(&state).unwrap()).unwrap();
        assert!(!rotation_due(
            &restored,
            state.mode,
            1440,
            yesterday.timestamp() + 60
        ));
        assert!(rotation_due(
            &restored,
            state.mode,
            1440,
            yesterday.timestamp() + 180
        ));
        assert_eq!(restored.last_id.as_deref(), Some("a"));
    }

    #[test]
    fn imports_are_copied_deduplicated_and_survive_source_removal() {
        let directory = std::env::temp_dir().join(format!(
            "mybingwallpaper-favorites-{}-{}",
            std::process::id(),
            rand::random::<u64>()
        ));
        let store = FavoriteStore::new(directory.clone()).unwrap();
        let source = directory.join("original.png");
        image::RgbImage::from_pixel(20, 10, image::Rgb([255, 120, 20]))
            .save(&source)
            .unwrap();
        let bytes = fs::read(&source).unwrap();
        let details = || FavoriteDetails {
            source: FavoriteSource::Local,
            date: None,
            title: "test".into(),
            description: String::new(),
            source_url: None,
        };
        let (favorite, added) = store.add(&bytes, details()).unwrap();
        assert!(added);
        assert!(!store.add(&bytes, details()).unwrap().1);
        fs::remove_file(source).unwrap();
        assert_eq!(fs::read(&favorite.image_path).unwrap(), bytes);
        assert_eq!(
            image::image_dimensions(&favorite.thumbnail_path).unwrap(),
            (400, 225)
        );
        assert_eq!(store.list().unwrap().len(), 1);
        let applied = desktop_copy(&favorite, &directory).unwrap();
        assert_eq!(
            image::guess_format(&fs::read(&applied).unwrap()).unwrap(),
            ImageFormat::Jpeg
        );
        assert_eq!(image::image_dimensions(&applied).unwrap(), (20, 10));
        store.remove(&favorite.id).unwrap();
        assert!(store.list().unwrap().is_empty());
        assert!(!favorite.image_path.exists());
        assert!(applied.exists());
        fs::remove_dir_all(directory).unwrap();
    }
}
