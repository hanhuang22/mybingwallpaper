use std::{ffi::c_void, os::windows::ffi::OsStrExt, path::Path};
use windows::Win32::{
    Foundation::HWND,
    Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
    },
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

// Windows 11 can retain native rounded corners and shadow without drawing the
// bright one-pixel border around a frameless window. Windows 10 ignores these.
pub fn style_borderless_window(hwnd: HWND) {
    let no_border = 0xffff_fffe_u32;
    let rounded = DWMWCP_ROUND;
    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            (&no_border as *const u32).cast(),
            std::mem::size_of_val(&no_border) as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            (&rounded as *const _).cast(),
            std::mem::size_of_val(&rounded) as u32,
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
