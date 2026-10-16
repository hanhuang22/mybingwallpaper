use crate::{
    favorites::{self, Favorite, FavoriteDetails, FavoriteSource, WallpaperMode},
    *,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    favorites: Vec<Favorite>,
    added_count: usize,
    duplicate_count: usize,
    errors: Vec<String>,
}

#[tauri::command]
pub async fn get_favorites(state: State<'_, AppState>) -> Result<Vec<Favorite>, String> {
    let _guard = state.favorites_lock.lock().await;
    state.favorites.list()
}

#[tauri::command]
pub fn open_favorites_directory<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Only expose the original images, not the collection index or thumbnails.
    let directory = state.favorites.images_directory();
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建收藏文件夹：{error}"))?;
    app.opener()
        .open_path(directory.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|error| format!("无法打开收藏文件夹：{error}"))
}

#[tauri::command]
pub async fn add_favorite(
    record: Wallpaper,
    state: State<'_, AppState>,
) -> Result<Vec<Favorite>, String> {
    let date = validate_date(&record.date)?;
    let path = wallpaper_cache_path(&state.wallpaper_cache, &date, &record.image_url);
    // Download before taking the collection lock so the collection stays responsive.
    if !cached_wallpaper_image_is_usable(&path) {
        download_image(&state.client, &record.image_url, &path).await?;
    }
    let guard = state.favorites_lock.clone().lock_owned().await;
    let store = state.favorites.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let bytes = fs::read(path).map_err(|error| format!("无法读取收藏图片：{error}"))?;
        store.add(
            &bytes,
            FavoriteDetails {
                source: FavoriteSource::Bing,
                date: Some(date),
                title: record.title,
                description: record.description,
                source_url: Some(record.image_url),
            },
        )?;
        store.list()
    })
    .await
    .map_err(|error| format!("收藏任务失败：{error}"))?
}

#[tauri::command]
pub async fn remove_favorite<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    state: State<'_, AppState>,
) -> Result<Vec<Favorite>, String> {
    let _update_guard = state.auto_update_lock.lock().await;
    let _guard = state.favorites_lock.lock().await;
    state.favorites.remove(&id)?;
    let favorites = state.favorites.list()?;
    let mut settings = read_settings(&state.config_path);
    if favorites.is_empty() && settings.mode().is_favorites() {
        settings.wallpaper_mode = Some(WallpaperMode::Off);
        settings.normalize();
        write_settings(&state.config_path, &settings)?;
        let _ = app.emit("wallpaper-settings-changed", &settings);
    }
    Ok(favorites)
}

#[tauri::command]
pub async fn import_favorites<R: Runtime>(
    app: tauri::AppHandle<R>,
    folder: bool,
    state: State<'_, AppState>,
) -> Result<Option<ImportResult>, String> {
    let window = app.get_webview_window("main").ok_or("无法找到应用窗口")?;
    let paths = if folder {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        app.dialog()
            .file()
            .set_parent(&window)
            .set_title("导入文件夹中的图片（不含子文件夹）")
            .pick_folder(move |selection| {
                let _ = sender.send(selection);
            });
        let Some(selection) = receiver.await.map_err(|_| "无法获取所选文件夹")? else {
            return Ok(None);
        };
        let directory = selection.into_path().map_err(|error| error.to_string())?;
        let mut paths: Vec<_> = fs::read_dir(directory)
            .map_err(|error| format!("无法读取文件夹：{error}"))?
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
            .map(|entry| entry.path())
            .filter(|path| favorites::supported_import(path))
            .collect();
        paths.sort();
        paths
    } else {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        app.dialog()
            .file()
            .set_parent(&window)
            .set_title("导入图片到收藏")
            .add_filter("图片", &["jpg", "jpeg", "png", "webp", "bmp"])
            .pick_files(move |selection| {
                let _ = sender.send(selection);
            });
        let Some(selection) = receiver.await.map_err(|_| "无法获取所选图片")? else {
            return Ok(None);
        };
        selection
            .into_iter()
            .map(|path| path.into_path().map_err(|error| error.to_string()))
            .collect::<Result<Vec<_>, _>>()?
    };
    if paths.is_empty() {
        return Err("文件夹里没有 JPG、PNG、WebP 或 BMP 图片".into());
    }
    let guard = state.favorites_lock.clone().lock_owned().await;
    let store = state.favorites.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let mut result = ImportResult {
            favorites: vec![],
            added_count: 0,
            duplicate_count: 0,
            errors: vec![],
        };
        for path in paths {
            let imported = (|| {
                let size = fs::metadata(&path)
                    .map_err(|error| error.to_string())?
                    .len();
                if size > 50 * 1024 * 1024 {
                    return Err("超过 50 MB".to_string());
                }
                let bytes = fs::read(&path).map_err(|error| error.to_string())?;
                store
                    .add(
                        &bytes,
                        FavoriteDetails {
                            source: FavoriteSource::Local,
                            date: None,
                            title: path
                                .file_stem()
                                .unwrap_or_default()
                                .to_string_lossy()
                                .into_owned(),
                            description: String::new(),
                            source_url: None,
                        },
                    )
                    .map(|(_, added)| added)
            })();
            match imported {
                Ok(true) => result.added_count += 1,
                Ok(false) => result.duplicate_count += 1,
                Err(error) => result.errors.push(format!(
                    "{}：{error}",
                    path.file_name().unwrap_or_default().to_string_lossy()
                )),
            }
        }
        result.favorites = store.list()?;
        Ok(Some(result))
    })
    .await
    .map_err(|error| format!("导入任务失败：{error}"))?
}

fn favorite_by_id(state: &AppState, id: &str) -> Result<Favorite, String> {
    state
        .favorites
        .list()?
        .into_iter()
        .find(|favorite| favorite.id == id)
        .ok_or("这张图片已经不在收藏中".into())
}

async fn apply_favorite_inner<R: Runtime>(
    app: &tauri::AppHandle<R>,
    favorite: &Favorite,
    settings: &Settings,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let cache = state.wallpaper_cache.clone();
    let original = favorite.clone();
    let path =
        tauri::async_runtime::spawn_blocking(move || favorites::desktop_copy(&original, &cache))
            .await
            .map_err(|error| format!("图片准备失败：{error}"))??;
    platform::set_desktop_wallpaper(&path)?;
    remember_active_wallpaper(&state, &path)?;
    remember_daily_wallpaper(
        &state,
        &Local::now().format("%Y-%m-%d").to_string(),
        favorite.source_url.as_deref().unwrap_or(&favorite.id),
    )?;
    postpone_favorite_rotation(&state, Some(&favorite.id))?;
    if cfg!(target_os = "windows") && settings.lock_screen {
        if let Err(warning) = platform::set_lock_screen_wallpaper(&path) {
            let _ = app.emit("auto-update-warning", warning);
        }
    }
    let _ = app.emit("favorite-wallpaper-applied", favorite);
    Ok(())
}

#[tauri::command]
pub async fn apply_favorite<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let _guard = state.auto_update_lock.lock().await;
    let _favorites_guard = state.favorites_lock.lock().await;
    apply_favorite_inner(
        &app,
        &favorite_by_id(&state, &id)?,
        &read_settings(&state.config_path),
    )
    .await
}

pub async fn rotate_favorites<R: Runtime>(
    app: &tauri::AppHandle<R>,
    settings: &Settings,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let _guard = state.favorites_lock.lock().await;
    let rotation = read_rotation_state(&state.rotation_state_path);
    if !favorites::rotation_due(
        &rotation,
        settings.mode(),
        settings.favorites_interval_minutes,
        Local::now().timestamp(),
    ) {
        return Ok(());
    }
    choose_and_apply(app, settings, rotation.last_id.as_deref()).await
}

async fn choose_and_apply<R: Runtime>(
    app: &tauri::AppHandle<R>,
    settings: &Settings,
    last_id: Option<&str>,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let records: Vec<_> = state
        .favorites
        .list()?
        .into_iter()
        .filter(|favorite| favorite.image_path.is_file())
        .collect();
    let ids: Vec<_> = records.iter().map(|favorite| favorite.id.clone()).collect();
    let index = favorites::next_favorite_index(
        &ids,
        last_id,
        settings.mode() == WallpaperMode::FavoritesRandom,
        rand::random::<u64>(),
    )
    .ok_or("收藏中没有可用的图片，请重新导入或关闭收藏播放")?;
    apply_favorite_inner(app, &records[index], settings).await
}

#[tauri::command]
pub async fn advance_favorite<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let _guard = state.auto_update_lock.lock().await;
    let _favorites_guard = state.favorites_lock.lock().await;
    let settings = read_settings(&state.config_path);
    if !settings.mode().is_favorites() {
        return Err("请先选择收藏顺序或收藏随机模式".into());
    }
    let rotation = read_rotation_state(&state.rotation_state_path);
    choose_and_apply(&app, &settings, rotation.last_id.as_deref()).await
}

fn export_favorite_image(favorite: &Favorite, settings: &Settings) -> Result<PathBuf, String> {
    let directory = prepare_save_directory(settings)?;
    let extension = favorite
        .image_path
        .extension()
        .unwrap_or_default()
        .to_string_lossy();
    let safe_title: String = favorite
        .title
        .chars()
        .filter(|character| !character.is_control() && !"<>:\"/\\|?*".contains(*character))
        .take(50)
        .collect();
    let file_name = format!(
        "{}-{}.{}",
        safe_title.trim_matches([' ', '.']),
        &favorite.id[..8],
        extension
    );
    let destination = directory.join(file_name);
    if destination != favorite.image_path {
        fs::copy(&favorite.image_path, &destination)
            .map_err(|error| format!("保存图片失败：{error}"))?;
    }
    Ok(destination)
}

#[tauri::command]
pub async fn save_favorite(id: String, state: State<'_, AppState>) -> Result<String, String> {
    let _guard = state.favorites_lock.lock().await;
    let favorite = favorite_by_id(&state, &id)?;
    let settings = read_settings(&state.config_path);
    export_favorite_image(&favorite, &settings).map(|path| path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn favorite_exports_use_save_location_and_leave_collection_copies_intact() {
        let root = std::env::temp_dir().join(format!(
            "mybingwallpaper-favorite-export-{}-{}",
            std::process::id(),
            rand::random::<u64>()
        ));
        let store = FavoriteStore::new(root.join("favorites")).unwrap();
        let directory = root.join("exports");
        fs::create_dir_all(&directory).unwrap();
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            20,
            10,
            image::Rgb([12, 90, 160]),
        ))
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
        let (favorite, _) = store
            .add(
                bytes.get_ref(),
                FavoriteDetails {
                    source: FavoriteSource::Local,
                    date: None,
                    title: "海/边".into(),
                    description: String::new(),
                    source_url: None,
                },
            )
            .unwrap();
        let settings: Settings = serde_json::from_value(serde_json::json!({
            "saveDirectory": directory,
            "saveWithoutPrompt": false,
        }))
        .unwrap();
        let destination = export_favorite_image(&favorite, &settings).unwrap();
        assert_eq!(destination.parent(), Some(directory.as_path()));
        assert_eq!(
            destination.file_name().unwrap(),
            format!("海边-{}.png", &favorite.id[..8]).as_str()
        );
        assert_eq!(fs::read(&destination).unwrap(), *bytes.get_ref());
        assert_eq!(fs::read(&favorite.image_path).unwrap(), *bytes.get_ref());
        assert!(favorite.thumbnail_path.is_file());
        assert_eq!(store.list().unwrap().len(), 1);
        assert_eq!(store.images_directory(), root.join("favorites/images"));
        fs::remove_dir_all(root).unwrap();
    }
}
