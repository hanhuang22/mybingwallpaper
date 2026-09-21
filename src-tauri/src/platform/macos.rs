use std::{path::Path, process::Command};

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGGetActiveDisplayList(
        max_displays: u32,
        active_displays: *mut u32,
        display_count: *mut u32,
    ) -> i32;
}

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

pub fn connected_display_ids() -> Result<Vec<u32>, String> {
    const MAX_DISPLAYS: usize = 32;
    let mut displays = [0_u32; MAX_DISPLAYS];
    let mut count = 0_u32;
    let result =
        unsafe { CGGetActiveDisplayList(MAX_DISPLAYS as u32, displays.as_mut_ptr(), &mut count) };
    if result != 0 {
        return Err(format!(
            "无法读取 macOS 显示器配置（CoreGraphics 错误 {result}）"
        ));
    }
    let mut active = displays[..count as usize].to_vec();
    active.sort_unstable();
    Ok(active)
}

#[cfg(test)]
mod tests {
    use super::connected_display_ids;

    #[test]
    fn finds_at_least_one_active_display() {
        let displays = connected_display_ids().expect("CoreGraphics should list active displays");
        assert!(!displays.is_empty());
    }
}

pub fn set_lock_screen_wallpaper(_path: &Path) -> Result<(), String> {
    Err("macOS 没有公开的锁屏壁纸设置接口".to_string())
}
