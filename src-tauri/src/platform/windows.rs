use std::{ffi::c_void, os::windows::ffi::OsStrExt, path::Path, process::Command};
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
    let key = r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\PersonalizationCSP";
    let path = path.to_string_lossy().into_owned();
    for (name, value, kind) in [
        ("LockScreenImagePath", path.as_str(), "REG_SZ"),
        ("LockScreenImageUrl", path.as_str(), "REG_SZ"),
        ("LockScreenImageStatus", "1", "REG_DWORD"),
    ] {
        let status = Command::new("reg")
            .args(["add", key, "/v", name, "/t", kind, "/d", value, "/f"])
            .status()
            .map_err(|error| format!("无法调用 Windows 注册表工具：{error}"))?;
        if !status.success() {
            return Err(
                "桌面壁纸已更新，但锁屏壁纸需要管理员权限或受当前 Windows 版本限制".to_string(),
            );
        }
    }
    Ok(())
}
