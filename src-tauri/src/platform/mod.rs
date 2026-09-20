#[cfg(not(any(target_os = "windows", target_os = "macos")))]
use std::path::Path;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "macos")]
pub use macos::{set_desktop_wallpaper, set_lock_screen_wallpaper};
#[cfg(target_os = "windows")]
pub use windows::{set_desktop_wallpaper, set_lock_screen_wallpaper};

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn set_desktop_wallpaper(_path: &Path) -> Result<(), String> {
    Err("当前系统暂不支持设置壁纸".to_string())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn set_lock_screen_wallpaper(_path: &Path) -> Result<(), String> {
    Err("当前系统暂不支持设置锁屏壁纸".to_string())
}
