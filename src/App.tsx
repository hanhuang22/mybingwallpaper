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
  MonitorDown,
  PackageOpen,
  RefreshCw,
  Settings as SettingsIcon,
  Shuffle,
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

interface UpdateCheck {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  source: string;
  releaseUrl: string;
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
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [platform, setPlatform] = useState<"windows" | "macos" | "browser">("browser");
  const [appVersion, setAppVersion] = useState("0.3.6");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheck | null>(null);
  const wallpaperRequest = useRef(0);

  const setSelectedDate = useCallback((date: string) => {
    setDateNavigation((current) => ({ ...current, selectedDate: date }));
  }, []);

  const syncToday = useCallback((date = formatDateKey(new Date())) => {
    setDateNavigation((current) => syncDateNavigation(current, date));
  }, []);

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
  }, [setSelectedDate, syncToday]);

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
    setCheckingUpdate(true);
    setUpdateInfo(null);
    setError("");
    try {
      const result = await invoke<UpdateCheck>("check_for_updates");
      setUpdateInfo(result);
      setMessage(
        result.updateAvailable
          ? `发现新版本 v${result.latestVersion}`
          : `当前已是最新版本 v${result.currentVersion}`,
      );
      window.setTimeout(() => setMessage(""), 3200);
    } catch (reason) {
      setError(`检查更新失败：${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const title = parseTitle(wallpaper?.title ?? "必应每日壁纸");

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
        <div className={`image-copy${detailsExpanded ? " expanded" : ""}`}>
          <div className="image-copy-heading">
            <div>
              <p className="eyebrow"><CalendarDays size={14} /> {friendlyDate(selectedDate)}</p>
              <h1>{title.headline}</h1>
            </div>
            {(title.attribution || wallpaper?.description) && (
              <button
                className="image-info-toggle"
                type="button"
                aria-label={detailsExpanded ? "收起壁纸说明" : "展开壁纸说明"}
                aria-expanded={detailsExpanded}
                onClick={() => setDetailsExpanded((expanded) => !expanded)}
              >
                <Info size={16} />
                <span>{detailsExpanded ? "收起" : "详情"}</span>
                {detailsExpanded ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
              </button>
            )}
          </div>
          {detailsExpanded && (
            <div className="image-copy-details">
              {title.attribution && <p className="attribution">{title.attribution}</p>}
              {wallpaper?.description && <p className="description">{wallpaper.description}</p>}
            </div>
          )}
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
        <div className="settings-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <aside className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="settings-heading">
              <div>
                <p className="eyebrow">偏好设置</p>
                <h2 id="settings-title">让壁纸自动焕新</h2>
              </div>
              <button className="icon-button" type="button" aria-label="关闭设置" onClick={() => setSettingsOpen(false)}><X size={20} /></button>
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
                    {updateInfo && ` · ${updateInfo.source} 最新 v${updateInfo.latestVersion}`}
                  </small>
                </span>
                {updateInfo?.updateAvailable ? (
                  <button className="settings-action accent" type="button" onClick={() => void openExternal(updateInfo.releaseUrl)}>
                    <PackageOpen size={16} />前往下载
                  </button>
                ) : (
                  <button className="settings-action" type="button" disabled={checkingUpdate} onClick={() => void checkForUpdates()}>
                    {checkingUpdate ? <LoaderCircle className="spin" size={16} /> : updateInfo ? <CheckCircle2 size={16} /> : <RefreshCw size={16} />}
                    {checkingUpdate ? "检查中" : updateInfo ? "已是最新" : "检查更新"}
                  </button>
                )}
              </div>
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
