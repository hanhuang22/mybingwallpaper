import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  ExternalLink,
  FolderOpen,
  Globe2,
  ImageIcon,
  Info,
  LoaderCircle,
  Moon,
  MonitorDown,
  PackageOpen,
  RefreshCw,
  Settings as SettingsIcon,
  Shuffle,
  Sun,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { DatePicker } from "./components/DatePicker";
import {
  addDays,
  defaultSettings,
  fetchWallpaperInBrowser,
  formatDateKey,
  parseTitle,
  randomDate,
  syncDateNavigation,
  type Settings,
  type Wallpaper,
} from "./lib/wallpaper";

type Action = "loading" | "applying" | "saving" | null;
type UpdateFeedback = { kind: "success" | "error" | "info"; text: string };

interface UpdateCheck {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  readyToRestart: boolean;
}

const OFFICIAL_SITE = "https://hanhuang22.github.io/mybingwallpaper/";
const GITEE_RELEASES = "https://gitee.com/Hyman25/mybingwallpaper/releases";

const isTauri = () => Boolean(window.__TAURI_INTERNALS__);

function friendlyDate(date: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date(`${date}T12:00:00`));
}

async function getWallpaper(date: string): Promise<Wallpaper> {
  if (isTauri()) {
    return invoke<Wallpaper>("get_wallpaper", { date });
  }
  return fetchWallpaperInBrowser(date);
}

function App() {
  const [{ today, selectedDate }, setDateNavigation] = useState(() => {
    const currentDate = formatDateKey(new Date());
    return { today: currentDate, selectedDate: currentDate };
  });
  const [wallpaper, setWallpaper] = useState<Wallpaper | null>(null);
  const [action, setAction] = useState<Action>("loading");
  const [message, setMessage] = useState("正在载入今日壁纸…");
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [detailsHovered, setDetailsHovered] = useState(false);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [platform, setPlatform] = useState<"windows" | "macos" | "browser">("browser");
  const [appVersion, setAppVersion] = useState("0.3.6");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheck | null>(null);
  const [updateFeedback, setUpdateFeedback] = useState<UpdateFeedback | null>(null);
  const wallpaperRequest = useRef(0);
  const settingsOpenRef = useRef(settingsOpen);
  const updateStatusResetTimer = useRef<number | null>(null);

  useEffect(() => {
    settingsOpenRef.current = settingsOpen;
  }, [settingsOpen]);

  const setSelectedDate = useCallback((date: string) => {
    setDateNavigation((current) => ({ ...current, selectedDate: date }));
  }, []);

  const syncToday = useCallback((date = formatDateKey(new Date())) => {
    setDateNavigation((current) => syncDateNavigation(current, date));
  }, []);

  const cancelUpdateStatusReset = useCallback(() => {
    if (updateStatusResetTimer.current !== null) {
      window.clearTimeout(updateStatusResetTimer.current);
      updateStatusResetTimer.current = null;
    }
  }, []);

  const clearUpdateStatus = useCallback(() => {
    cancelUpdateStatusReset();
    setUpdateInfo(null);
    setUpdateFeedback(null);
  }, [cancelUpdateStatusReset]);

  const scheduleUpdateStatusReset = useCallback(() => {
    cancelUpdateStatusReset();
    updateStatusResetTimer.current = window.setTimeout(() => {
      updateStatusResetTimer.current = null;
      setUpdateInfo(null);
      setUpdateFeedback(null);
    }, 3_000);
  }, [cancelUpdateStatusReset]);

  const closeSettings = useCallback(() => {
    settingsOpenRef.current = false;
    setSettingsOpen(false);
    if (!updateInfo?.updateAvailable && !downloadingUpdate) clearUpdateStatus();
  }, [clearUpdateStatus, downloadingUpdate, updateInfo?.updateAvailable]);

  useEffect(() => () => cancelUpdateStatusReset(), [cancelUpdateStatusReset]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolved = settings.theme === "system"
        ? (media.matches ? "dark" : "light")
        : settings.theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    };
    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [settings.theme]);

  const loadWallpaper = useCallback(async (date: string) => {
    const request = wallpaperRequest.current + 1;
    wallpaperRequest.current = request;
    setAction("loading");
    setError("");
    setMessage("正在载入壁纸…");
    try {
      const next = await getWallpaper(date);
      if (request === wallpaperRequest.current) {
        setWallpaper(next);
        setMessage("");
      }
      return next;
    } catch (reason) {
      if (request === wallpaperRequest.current) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
      return null;
    } finally {
      if (request === wallpaperRequest.current) setAction(null);
    }
  }, []);

  useEffect(() => {
    setDetailsExpanded(false);
    setDetailsHovered(false);
    void loadWallpaper(selectedDate);
  }, [loadWallpaper, selectedDate]);

  useEffect(() => {
    let midnightTimer = 0;

    const refreshWallpaper = () => {
      if (!isTauri()) return;
      void invoke("run_auto_update").catch((reason) => {
        setError(`自动更新失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
    };

    const refreshDateAndWallpaper = () => {
      syncToday();
      refreshWallpaper();
    };

    const scheduleMidnightRefresh = () => {
      const now = new Date();
      refreshDateAndWallpaper();
      const nextMidnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0,
        0,
        1,
      );
      midnightTimer = window.setTimeout(
        scheduleMidnightRefresh,
        Math.max(1_000, nextMidnight.getTime() - now.getTime()),
      );
    };

    const refreshAfterResume = () => refreshDateAndWallpaper();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshDateAndWallpaper();
    };

    scheduleMidnightRefresh();
    window.addEventListener("focus", refreshAfterResume);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearTimeout(midnightTimer);
      window.removeEventListener("focus", refreshAfterResume);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [syncToday]);

  useEffect(() => {
    if (!isTauri()) return;

    void Promise.all([
      invoke<Settings>("load_settings"),
      invoke<"windows" | "macos">("get_platform"),
      invoke<string>("get_app_version"),
    ]).then(([saved, currentPlatform, currentVersion]) => {
      setSettings(saved);
      setPlatform(currentPlatform);
      setAppVersion(currentVersion);
    });

    let disposed = false;
    const stopListening: Array<() => void> = [];
    void Promise.all([
      listen("tray-apply-today", () => {
        const currentDate = formatDateKey(new Date());
        syncToday(currentDate);
        setSelectedDate(currentDate);
        void getWallpaper(currentDate).then((record) => {
          setWallpaper(record);
          return invoke("apply_wallpaper", {
            imageUrl: record.imageUrl,
            date: currentDate,
            setLockScreen: false,
          });
        });
      }),
      listen<string>("auto-update-complete", (event) => {
        syncToday(event.payload);
      }),
      listen<string>("auto-update-error", (event) => {
        setError(`自动更新失败：${event.payload}`);
      }),
      listen<string>("display-wallpaper-error", (event) => {
        setError(`外接显示器壁纸同步失败：${event.payload}`);
      }),
      listen<{ downloaded: number; total?: number }>("software-update-progress", (event) => {
        if (event.payload.total) {
          setUpdateProgress(Math.min(100, Math.round((event.payload.downloaded / event.payload.total) * 100)));
        }
      }),
      listen<string>("software-update-ready", (event) => {
        cancelUpdateStatusReset();
        setDownloadingUpdate(false);
        setUpdateProgress(100);
        setUpdateInfo({
          currentVersion: appVersion,
          latestVersion: event.payload,
          updateAvailable: true,
          readyToRestart: true,
        });
        setUpdateFeedback({
          kind: "success",
          text: `v${event.payload} 已下载完成，重启应用即可安装`,
        });
        if (!settingsOpenRef.current) {
          setMessage(`v${event.payload} 已准备好，重启即可完成更新`);
          window.setTimeout(() => setMessage(""), 4500);
        }
      }),
    ]).then((unlisteners) => {
      if (disposed) {
        unlisteners.forEach((unlisten) => unlisten());
      } else {
        stopListening.push(...unlisteners);
      }
    });

    return () => {
      disposed = true;
      stopListening.forEach((unlisten) => unlisten());
    };
  }, [appVersion, cancelUpdateStatusReset, setSelectedDate, syncToday]);

  const updateSettings = async (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    setError("");
    try {
      if (isTauri()) await invoke("save_settings", { settings: next });
    } catch (reason) {
      setSettings(settings);
      setError(`设置保存失败：${reason instanceof Error ? reason.message : String(reason)}`);
    }
  };

  const applyWallpaper = async () => {
    if (!wallpaper || !isTauri()) {
      if (!isTauri()) setError("请在 Tauri 桌面应用中使用“设为壁纸”功能");
      return;
    }
    setAction("applying");
    setError("");
    setMessage("正在下载并设置壁纸…");
    try {
      await invoke("apply_wallpaper", {
        imageUrl: wallpaper.imageUrl,
        date: selectedDate,
        setLockScreen: platform === "windows" && settings.lockScreen,
      });
      setMessage("壁纸已更新");
      window.setTimeout(() => setMessage(""), 2400);
    } catch (reason) {
      setError(`设置失败：${reason instanceof Error ? reason.message : String(reason)}`);
      setMessage("");
    } finally {
      setAction(null);
    }
  };

  const saveWallpaper = async () => {
    if (!wallpaper || !isTauri()) {
      if (wallpaper) window.open(wallpaper.imageUrl, "_blank", "noopener,noreferrer");
      return;
    }
    setAction("saving");
    setError("");
    setMessage("正在保存原图…");
    try {
      const path = await invoke<string>("save_wallpaper", {
        imageUrl: wallpaper.imageUrl,
        date: selectedDate,
      });
      setMessage(`已保存到 ${path}`);
      window.setTimeout(() => setMessage(""), 4500);
    } catch (reason) {
      setError(`保存失败：${reason instanceof Error ? reason.message : String(reason)}`);
      setMessage("");
    } finally {
      setAction(null);
    }
  };

  const openExternal = async (url: string) => {
    try {
      if (isTauri()) {
        await invoke("open_external", { url });
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch (reason) {
      setError(`打开链接失败：${reason instanceof Error ? reason.message : String(reason)}`);
    }
  };

  const openWallpaperFolder = async () => {
    if (!isTauri()) {
      setError("请在桌面应用中打开本地壁纸目录");
      return;
    }
    try {
      await invoke("open_wallpaper_folder");
    } catch (reason) {
      setError(`打开目录失败：${reason instanceof Error ? reason.message : String(reason)}`);
    }
  };

  const checkForUpdates = async () => {
    if (!isTauri()) {
      await openExternal(GITEE_RELEASES);
      return;
    }
    cancelUpdateStatusReset();
    setCheckingUpdate(true);
    setUpdateInfo(null);
    setUpdateFeedback({ kind: "info", text: "正在连接更新服务…" });
    try {
      const result = await invoke<UpdateCheck>("prepare_software_update", { download: false });
      setUpdateInfo(result);
      setUpdateFeedback({
        kind: "success",
        text: result.updateAvailable
          ? `发现新版本 v${result.latestVersion}`
          : `当前已是最新版本 v${result.currentVersion}`,
      });
      if (!result.updateAvailable) {
        if (settingsOpenRef.current) scheduleUpdateStatusReset();
        else clearUpdateStatus();
      }
    } catch (reason) {
      if (settingsOpenRef.current) {
        setUpdateFeedback({
          kind: "error",
          text: `检查更新失败：${reason instanceof Error ? reason.message : String(reason)}`,
        });
      }
    } finally {
      setCheckingUpdate(false);
    }
  };

  const downloadSoftwareUpdate = async () => {
    cancelUpdateStatusReset();
    setDownloadingUpdate(true);
    setUpdateProgress(null);
    setUpdateFeedback({ kind: "info", text: "正在下载并校验更新包…" });
    try {
      const result = await invoke<UpdateCheck>("prepare_software_update", { download: true });
      setUpdateInfo(result);
      if (result.readyToRestart) {
        setUpdateFeedback({
          kind: "success",
          text: `v${result.latestVersion} 已下载完成，重启应用即可安装`,
        });
      }
    } catch (reason) {
      setUpdateFeedback({
        kind: "error",
        text: `下载更新失败：${reason instanceof Error ? reason.message : String(reason)}`,
      });
    } finally {
      setDownloadingUpdate(false);
    }
  };

  const installSoftwareUpdate = async () => {
    setUpdateFeedback({ kind: "info", text: "正在安装更新并重新启动…" });
    try {
      await invoke("install_software_update");
    } catch (reason) {
      setUpdateFeedback({
        kind: "error",
        text: `安装更新失败：${reason instanceof Error ? reason.message : String(reason)}`,
      });
    }
  };

  const title = parseTitle(wallpaper?.title ?? "必应每日壁纸");
  const showDetails = detailsExpanded || detailsHovered;

  return (
    <main className="app-shell">
      <div className="ambient" aria-hidden="true" />
      <section className="wallpaper-stage" aria-busy={action === "loading"}>
        {wallpaper ? (
          <img className="wallpaper-image" src={wallpaper.imageUrl} alt={title.headline} />
        ) : (
          <div className="image-placeholder"><ImageIcon size={44} /></div>
        )}
        <div className="image-shade" aria-hidden="true" />
        <div
          className={`image-copy${showDetails ? " expanded" : ""}${detailsExpanded ? " pinned" : ""}`}
          onMouseEnter={() => setDetailsHovered(true)}
          onMouseLeave={() => setDetailsHovered(false)}
        >
          {showDetails && (
            <div className="image-copy-details">
              {title.attribution && <p className="attribution">{title.attribution}</p>}
              {wallpaper?.description && <p className="description">{wallpaper.description}</p>}
            </div>
          )}
          <div className="image-copy-heading">
            <div>
              <p className="eyebrow"><CalendarDays size={14} /> {friendlyDate(selectedDate)}</p>
              <h1 className={title.headline.length > 18 ? "long-title" : undefined}>
                {title.headline}
              </h1>
            </div>
            {(title.attribution || wallpaper?.description) && (
              <button
                className="image-info-toggle"
                type="button"
                aria-label={detailsExpanded ? "取消固定壁纸说明" : "固定展开壁纸说明"}
                aria-expanded={detailsExpanded}
                title={detailsExpanded ? "取消固定说明" : "固定展开说明"}
                onFocus={() => setDetailsHovered(true)}
                onBlur={() => setDetailsHovered(false)}
                onClick={() => setDetailsExpanded((expanded) => !expanded)}
              >
                <Info size={16} />
                {detailsExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </button>
            )}
          </div>
        </div>
        {(action === "loading" || action === "applying" || action === "saving") && (
          <div className="loading-indicator" role="status">
            <LoaderCircle className="spin" size={18} /> {message}
          </div>
        )}
      </section>

      <section className="control-dock" aria-label="壁纸操作">
        <div className="date-navigation">
          <button className="icon-button" type="button" aria-label="前一天" onClick={() => setSelectedDate(addDays(selectedDate, -1))}>
            <ChevronLeft size={20} />
          </button>
          <DatePicker
            value={selectedDate}
            minimum="2010-01-01"
            maximum={today}
            onChange={setSelectedDate}
          />
          <button className="icon-button" type="button" aria-label="后一天" disabled={selectedDate >= today} onClick={() => setSelectedDate(addDays(selectedDate, 1))}>
            <ChevronRight size={20} />
          </button>
          <button className="text-button" type="button" onClick={() => setSelectedDate(today)}>今天</button>
        </div>
        <div className="primary-actions">
          <button className="button secondary" type="button" disabled={!wallpaper || Boolean(action)} onClick={() => setSelectedDate(randomDate())}>
            <Shuffle size={17} /> 随机一张
          </button>
          <button className="button secondary" type="button" disabled={!wallpaper || Boolean(action)} onClick={saveWallpaper}>
            <Download size={17} /> 保存原图
          </button>
          <button className="button primary" type="button" disabled={!wallpaper || Boolean(action)} onClick={applyWallpaper}>
            <MonitorDown size={18} /> 设为壁纸
          </button>
          <button className="icon-button dock-settings" type="button" aria-label="打开设置" title="设置" onClick={() => setSettingsOpen(true)}>
            <SettingsIcon size={19} />
          </button>
        </div>
      </section>

      {(error || (message && !action)) && (
        <div className={error ? "toast error" : "toast"} role={error ? "alert" : "status"}>
          {error || message}
          {error && <button type="button" onClick={() => void loadWallpaper(selectedDate)}><RefreshCw size={15} />重试</button>}
        </div>
      )}

      {settingsOpen && (
        <div className="settings-backdrop" role="presentation" onMouseDown={closeSettings}>
          <aside className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="settings-heading">
              <div>
                <p className="eyebrow">偏好设置</p>
                <h2 id="settings-title">让壁纸自动焕新</h2>
              </div>
              <button className="icon-button" type="button" aria-label="关闭设置" onClick={closeSettings}><X size={20} /></button>
            </div>
            <div className="setting-list">
              <label className="setting-row">
                <span><strong>每日自动更新</strong><small>应用在后台运行时检查并应用今日壁纸</small></span>
                <input type="checkbox" role="switch" checked={settings.autoUpdate} onChange={(event) => void updateSettings({ autoUpdate: event.target.checked })} />
              </label>
              <label className="setting-row">
                <span><strong>登录后自动启动</strong><small>静默启动并驻留系统托盘</small></span>
                <input type="checkbox" role="switch" checked={settings.autoStart} disabled={!isTauri()} onChange={(event) => void updateSettings({ autoStart: event.target.checked })} />
              </label>
              {platform === "windows" && (
                <label className="setting-row">
                  <span><strong>同时更新锁屏</strong><small>Windows 实验功能，可能需要额外系统权限</small></span>
                  <input type="checkbox" role="switch" checked={settings.lockScreen} onChange={(event) => void updateSettings({ lockScreen: event.target.checked })} />
                </label>
              )}
              <div className="setting-row theme-setting-row">
                <span><strong>外观</strong><small>默认跟随系统的浅色或深色模式</small></span>
                <div className="theme-options" role="group" aria-label="外观主题">
                  <button className={settings.theme === "system" ? "selected" : ""} type="button" title="跟随系统" onClick={() => void updateSettings({ theme: "system" })}>
                    <MonitorDown size={15} /><span>系统</span>
                  </button>
                  <button className={settings.theme === "light" ? "selected" : ""} type="button" title="浅色" onClick={() => void updateSettings({ theme: "light" })}>
                    <Sun size={15} /><span>浅色</span>
                  </button>
                  <button className={settings.theme === "dark" ? "selected" : ""} type="button" title="深色" onClick={() => void updateSettings({ theme: "dark" })}>
                    <Moon size={15} /><span>深色</span>
                  </button>
                </div>
              </div>
              <div className="setting-row setting-action-row">
                <span><strong>本地壁纸</strong><small>查看自动下载和已经应用过的壁纸</small></span>
                <button className="settings-action" type="button" onClick={openWallpaperFolder}>
                  <FolderOpen size={16} />打开目录
                </button>
              </div>
              <div className="setting-row setting-action-row">
                <span>
                  <strong>软件更新</strong>
                  <small>
                    当前版本 v{appVersion}
                    {updateInfo?.updateAvailable && ` · 最新 v${updateInfo.latestVersion}`}
                    {downloadingUpdate && ` · 下载中${updateProgress === null ? "…" : ` ${updateProgress}%`}`}
                  </small>
                  {updateFeedback && (
                    <em className={`update-inline-feedback ${updateFeedback.kind}`} role={updateFeedback.kind === "error" ? "alert" : "status"}>
                      {updateFeedback.kind === "success" ? <CheckCircle2 size={14} /> : updateFeedback.kind === "error" ? <Info size={14} /> : <LoaderCircle className={checkingUpdate || downloadingUpdate ? "spin" : undefined} size={14} />}
                      {updateFeedback.text}
                    </em>
                  )}
                </span>
                {updateInfo?.readyToRestart ? (
                  <button className="settings-action accent" type="button" onClick={() => void installSoftwareUpdate()}>
                    <RefreshCw size={16} />重启并更新
                  </button>
                ) : updateInfo?.updateAvailable ? (
                  <button className="settings-action accent" type="button" disabled={downloadingUpdate} onClick={() => void downloadSoftwareUpdate()}>
                    {downloadingUpdate ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
                    {downloadingUpdate ? "下载中" : "下载更新"}
                  </button>
                ) : (
                  <button className="settings-action" type="button" disabled={checkingUpdate || Boolean(updateInfo)} onClick={() => void checkForUpdates()}>
                    {checkingUpdate ? <LoaderCircle className="spin" size={16} /> : updateInfo ? <CheckCircle2 size={16} /> : <RefreshCw size={16} />}
                    {checkingUpdate ? "检查中" : updateInfo ? "已是最新" : "检查更新"}
                  </button>
                )}
              </div>
              <label className="setting-row">
                <span><strong>自动下载软件更新</strong><small>发现新版本后在后台下载，安装前仍会询问</small></span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={settings.autoDownloadUpdates}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    void updateSettings({ autoDownloadUpdates: enabled });
                    if (enabled) void downloadSoftwareUpdate();
                  }}
                />
              </label>
            </div>
            <div className="settings-links" aria-label="项目链接">
              <button type="button" onClick={() => void openExternal(OFFICIAL_SITE)}><Globe2 size={15} />官方网站<ExternalLink size={13} /></button>
              <button type="button" onClick={() => void openExternal(GITEE_RELEASES)}><PackageOpen size={15} />国内下载<ExternalLink size={13} /></button>
            </div>
            <p className="settings-note">关闭主窗口后应用仍会驻留托盘。请通过托盘菜单完全退出。</p>
          </aside>
        </div>
      )}
    </main>
  );
}

export default App;
