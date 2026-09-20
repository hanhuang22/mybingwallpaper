use std::{path::Path, process::Command};

const SET_WALLPAPER_SCRIPT: &str = r#"
ObjC.import('AppKit');
const path = $.NSProcessInfo.processInfo.environment.objectForKey('MY_BING_WALLPAPER_PATH').js;
const imageUrl = $.NSURL.fileURLWithPath(path);
const workspace = $.NSWorkspace.sharedWorkspace;
const screens = $.NSScreen.screens;
for (let index = 0; index < screens.count; index += 1) {
  const screen = screens.objectAtIndex(index);
  const success = workspace.setDesktopImageURLForScreenOptionsError(imageUrl, screen, {}, null);
  if (!success) throw new Error('AppKit rejected the desktop image');
}
"#;

pub fn set_desktop_wallpaper(path: &Path) -> Result<(), String> {
    let output = Command::new("/usr/bin/osascript")
        .args(["-l", "JavaScript", "-e", SET_WALLPAPER_SCRIPT])
        .env("MY_BING_WALLPAPER_PATH", path)
        .output()
        .map_err(|error| format!("无法调用 macOS 壁纸服务：{error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "macOS 设置壁纸失败：{}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

pub fn set_lock_screen_wallpaper(_path: &Path) -> Result<(), String> {
    Err("macOS 没有公开的锁屏壁纸设置接口".to_string())
}
