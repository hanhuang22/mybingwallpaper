use std::{ffi::c_void, os::windows::ffi::OsStrExt, path::Path};
use windows::Win32::{
    Foundation::HWND,
    Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR},
};
use windows::{core::HSTRING, Storage::StorageFile, System::UserProfile::LockScreen};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    SystemParametersInfoW, SPIF_SENDCHANGE, SPIF_UPDATEINIFILE, SPI_SETDESKWALLPAPER,
};

pub fn set_desktop_wallpaper(path: &Path) -> Result<(), String> {
    let mut wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe {
        SystemParametersInfoW(
            SPI_SETDESKWALLPAPER,
            0,
            wide.as_mut_ptr().cast::<c_void>(),
            SPIF_UPDATEINIFILE | SPIF_SENDCHANGE,
        )
    };
    if result == 0 {
        Err(format!(
            "Windows 设置壁纸失败：{}",
            std::io::Error::last_os_error()
        ))
    } else {
        Ok(())
    }
}

pub fn set_lock_screen_wallpaper(path: &Path) -> Result<(), String> {
    let path = HSTRING::from_wide(&path.as_os_str().encode_wide().collect::<Vec<_>>());
    let file = StorageFile::GetFileFromPathAsync(&path)
        .and_then(|operation| operation.get())
        .map_err(|error| format!("无法读取锁屏壁纸图片：{error}"))?;
    LockScreen::SetImageFileAsync(&file)
        .and_then(|operation| operation.get())
        .map_err(|error| format!("Windows 设置锁屏壁纸失败：{error}"))?;
    Ok(())
}

// DWM caption colors require Windows 11. On Windows 10, the native theme set by
// Tauri still applies, and these unsupported attributes can safely be ignored.
pub fn set_window_caption_colors(hwnd: HWND, dark: bool) {
    let colorref = |red: u8, green: u8, blue: u8| {
        u32::from(red) | (u32::from(green) << 8) | (u32::from(blue) << 16)
    };
    let (background, foreground) = if dark {
        (colorref(0x11, 0x18, 0x27), colorref(0xf8, 0xfa, 0xfc))
    } else {
        (colorref(0xee, 0xf2, 0xf8), colorref(0x17, 0x20, 0x33))
    };
    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_CAPTION_COLOR,
            (&background as *const u32).cast(),
            std::mem::size_of::<u32>() as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_TEXT_COLOR,
            (&foreground as *const u32).cast(),
            std::mem::size_of::<u32>() as u32,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "changes the current user's Windows lock screen; set LOCK_SCREEN_TEST_IMAGE to an existing image"]
    fn sets_current_users_lock_screen() {
        let path = std::env::var_os("LOCK_SCREEN_TEST_IMAGE")
            .expect("LOCK_SCREEN_TEST_IMAGE must point to an existing image");
        set_lock_screen_wallpaper(Path::new(&path)).unwrap();
        let original = LockScreen::OriginalImageFile().unwrap();
        println!(
            "Windows lock screen image: {}",
            original.ToString().unwrap()
        );
    }
}
