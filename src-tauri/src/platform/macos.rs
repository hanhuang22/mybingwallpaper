use std::{cell::RefCell, path::Path, process::Command, ptr::NonNull, sync::Arc, time::Duration};

use block2::RcBlock;
use objc2::{rc::Retained, runtime::ProtocolObject};
use objc2_app_kit::{NSWorkspace, NSWorkspaceActiveSpaceDidChangeNotification};
use objc2_foundation::{NSNotification, NSNotificationCenter, NSObjectProtocol};
use tokio::sync::Notify;

const SPACE_CHANGE_SETTLE_TIME: Duration = Duration::from_millis(350);

// NSNotificationCenter's observer token stays on the registration (main) thread.
// The callback only signals the async worker; it never runs osascript on the UI thread.
thread_local! {
    static SPACE_OBSERVER: RefCell<Option<SpaceChangeObserver>> = const { RefCell::new(None) };
}

struct SpaceChangeObserver {
    center: Retained<NSNotificationCenter>,
    token: Retained<ProtocolObject<dyn NSObjectProtocol>>,
}

impl SpaceChangeObserver {
    fn new(center: Retained<NSNotificationCenter>, changed: Arc<Notify>) -> Self {
        let callback = RcBlock::new(move |_: NonNull<NSNotification>| changed.notify_one());
        // SAFETY: the name is an AppKit notification constant, no object filter or
        // operation queue is used, and the block captures only a Send + Sync Notify.
        // The notification center copies the block and retains its observer token.
        let token = unsafe {
            center.addObserverForName_object_queue_usingBlock(
                Some(NSWorkspaceActiveSpaceDidChangeNotification),
                None,
                None,
                &callback,
            )
        };
        Self { center, token }
    }
}

impl Drop for SpaceChangeObserver {
    fn drop(&mut self) {
        // SAFETY: this is the exact observer token returned by this center.
        unsafe { self.center.removeObserver((*self.token).as_ref()) };
    }
}

pub fn observe_space_changes() -> Arc<Notify> {
    let changed = Arc::new(Notify::new());
    // Space notifications are delivered by NSWorkspace's center, NOT the default center.
    let center = NSWorkspace::sharedWorkspace().notificationCenter();
    let observer = SpaceChangeObserver::new(center, changed.clone());
    SPACE_OBSERVER.with(|slot| *slot.borrow_mut() = Some(observer));
    changed
}

pub async fn wait_for_settled_space_change(changed: &Notify) {
    changed.notified().await;
    loop {
        // A burst of gestures should sync only the last visible space. Notify also
        // retains one pending change if the user switches while a sync is running.
        tokio::select! {
            _ = changed.notified() => {},
            _ = tokio::time::sleep(SPACE_CHANGE_SETTLE_TIME) => return,
        }
    }
}

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
const skipUnchanged = $.NSProcessInfo.processInfo.environment.objectForKey('MY_BING_WALLPAPER_SKIP_UNCHANGED').js === '1';
const workspace = $.NSWorkspace.sharedWorkspace;
const screens = $.NSScreen.screens;
for (let index = 0; index < screens.count; index += 1) {
  const screen = screens.objectAtIndex(index);
  if (skipUnchanged) {
    const currentUrl = workspace.desktopImageURLForScreen(screen);
    if (currentUrl && !currentUrl.isNil() && currentUrl.standardizedURL.isEqual(imageUrl.standardizedURL)) continue;
  }
  const success = workspace.setDesktopImageURLForScreenOptionsError(imageUrl, screen, {}, null);
  if (!success) throw new Error('AppKit rejected the desktop image');
}
"#;

pub fn set_desktop_wallpaper(path: &Path) -> Result<(), String> {
    set_desktop_wallpaper_inner(path, false)
}

pub fn sync_desktop_wallpaper(path: &Path) -> Result<(), String> {
    set_desktop_wallpaper_inner(path, true)
}

fn set_desktop_wallpaper_inner(path: &Path, skip_unchanged: bool) -> Result<(), String> {
    let output = Command::new("/usr/bin/osascript")
        .args(["-l", "JavaScript", "-e", SET_WALLPAPER_SCRIPT])
        .env("MY_BING_WALLPAPER_PATH", path)
        .env(
            "MY_BING_WALLPAPER_SKIP_UNCHANGED",
            if skip_unchanged { "1" } else { "0" },
        )
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
    use super::*;
    use objc2_foundation::NSString;
    use tokio::time::{advance, timeout};

    #[tokio::test(flavor = "current_thread")]
    async fn observer_receives_only_space_changes_and_unregisters_on_drop() {
        // Use a private center: these notifications must not reach the OS or other apps.
        let center = NSNotificationCenter::new();
        let changed = Arc::new(Notify::new());
        let observer = SpaceChangeObserver::new(center.clone(), changed.clone());
        unsafe {
            center.postNotificationName_object(&NSString::from_str("UnrelatedNotification"), None);
        }
        assert!(timeout(Duration::from_millis(10), changed.notified())
            .await
            .is_err());
        unsafe {
            center.postNotificationName_object(NSWorkspaceActiveSpaceDidChangeNotification, None);
        }
        timeout(Duration::from_millis(50), changed.notified())
            .await
            .unwrap();
        drop(observer);
        unsafe {
            center.postNotificationName_object(NSWorkspaceActiveSpaceDidChangeNotification, None);
        }
        assert!(timeout(Duration::from_millis(10), changed.notified())
            .await
            .is_err());
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn no_space_change_does_not_schedule_wallpaper_sync() {
        let changed = Arc::new(Notify::new());
        let pending = changed.clone();
        let task = tokio::spawn(async move { wait_for_settled_space_change(&pending).await });
        tokio::task::yield_now().await;
        advance(Duration::from_secs(60)).await;
        assert!(!task.is_finished());
        task.abort();
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn rapid_space_changes_wait_until_the_last_change_settles() {
        let changed = Arc::new(Notify::new());
        let pending = changed.clone();
        let task = tokio::spawn(async move { wait_for_settled_space_change(&pending).await });
        changed.notify_one();
        tokio::task::yield_now().await;
        for _ in 0..3 {
            advance(Duration::from_millis(200)).await;
            changed.notify_one();
            tokio::task::yield_now().await;
            assert!(!task.is_finished());
        }
        advance(SPACE_CHANGE_SETTLE_TIME - Duration::from_millis(1)).await;
        tokio::task::yield_now().await;
        assert!(!task.is_finished());
        advance(Duration::from_millis(1)).await;
        task.await.unwrap();
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn a_change_during_sync_is_kept_for_the_next_pass() {
        let changed = Arc::new(Notify::new());
        changed.notify_one();
        wait_for_settled_space_change(&changed).await;

        // While the worker is applying, several more changes coalesce into one permit.
        changed.notify_one();
        changed.notify_one();
        wait_for_settled_space_change(&changed).await;

        let pending = changed.clone();
        let task = tokio::spawn(async move { wait_for_settled_space_change(&pending).await });
        tokio::task::yield_now().await;
        advance(Duration::from_secs(1)).await;
        assert!(
            !task.is_finished(),
            "pending changes should be fully consumed"
        );
        task.abort();
    }

    fn run_wallpaper_script_with_fake_screens(
        skip_unchanged: bool,
        reject: bool,
    ) -> std::process::Output {
        // Execute the production JXA script against a fake AppKit workspace. No
        // real desktop-image setter is called, even when this test runs on a Mac.
        let script = format!(
            r#"
const calls = [];
function fileUrl(path) {{
  return {{ isNil: () => false, standardizedURL: {{ path, isEqual: other => path === other.path }} }};
}}
const values = {{ MY_BING_WALLPAPER_PATH: '/new image.jpg', MY_BING_WALLPAPER_SKIP_UNCHANGED: '{}' }};
const fake = {{
  NSProcessInfo: {{ processInfo: {{ environment: {{ objectForKey: key => ({{ js: values[key] }}) }} }} }},
  NSURL: {{ fileURLWithPath: fileUrl }},
  NSScreen: {{ screens: {{ count: 3, objectAtIndex: index => index }} }},
  NSWorkspace: {{ sharedWorkspace: {{
    desktopImageURLForScreen: index => [fileUrl('/new image.jpg'), fileUrl('/old.jpg'), null][index],
    setDesktopImageURLForScreenOptionsError: (url, screen) => {{ calls.push(screen); return {}; }}
  }} }}
}};
(function($, ObjC) {{ {} }})(fake, {{ import: () => {{}} }});
JSON.stringify(calls);
"#,
            if skip_unchanged { "1" } else { "0" },
            !reject,
            SET_WALLPAPER_SCRIPT
        );
        Command::new("/usr/bin/osascript")
            .args(["-l", "JavaScript", "-e", &script])
            .output()
            .expect("JXA should be available on macOS")
    }

    #[test]
    fn space_sync_skips_matching_screens_but_updates_old_or_unset_ones() {
        let output = run_wallpaper_script_with_fake_screens(true, false);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "[1,2]");
    }

    #[test]
    fn explicit_wallpaper_setting_still_applies_to_every_screen() {
        let output = run_wallpaper_script_with_fake_screens(false, false);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "[0,1,2]");
    }

    #[test]
    fn workspace_rejection_is_reported_instead_of_silently_succeeding() {
        let output = run_wallpaper_script_with_fake_screens(true, true);
        assert!(!output.status.success());
        assert!(
            String::from_utf8_lossy(&output.stderr).contains("AppKit rejected the desktop image")
        );
    }

    #[test]
    fn finds_at_least_one_active_display() {
        let displays = connected_display_ids().expect("CoreGraphics should list active displays");
        assert!(!displays.is_empty());
    }
}

pub fn set_lock_screen_wallpaper(_path: &Path) -> Result<(), String> {
    Err("macOS 没有公开的锁屏壁纸设置接口".to_string())
}
