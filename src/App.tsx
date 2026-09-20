import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  ImageIcon,
  LoaderCircle,
  MonitorDown,
  RefreshCw,
  Settings as SettingsIcon,
  Shuffle,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDays,
  defaultSettings,
  fetchWallpaperInBrowser,
  formatDateKey,
  parseTitle,
  randomDate,
  type Settings,
  type Wallpaper,
} from "./lib/wallpaper";

type Action = "loading" | "applying" | "saving" | null;

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
  const today = useMemo(() => formatDateKey(new Date()), []);
  const [selectedDate, setSelectedDate] = useState(today);
  const [wallpaper, setWallpaper] = useState<Wallpaper | null>(null);
  const [action, setAction] = useState<Action>("loading");
  const [message, setMessage] = useState("正在载入今日壁纸…");
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [platform, setPlatform] = useState<"windows" | "macos" | "browser">("browser");

  const loadWallpaper = useCallback(async (date: string) => {
    setAction("loading");
    setError("");
    setMessage("正在载入壁纸…");
    try {
      const next = await getWallpaper(date);
      setWallpaper(next);
      setMessage("");
      return next;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return null;
    } finally {
      setAction(null);
    }
  }, []);

  useEffect(() => {
    void loadWallpaper(selectedDate);
  }, [loadWallpaper, selectedDate]);

  useEffect(() => {
    if (!isTauri()) return;

    void Promise.all([
      invoke<Settings>("load_settings"),
      invoke<"windows" | "macos">("get_platform"),
    ]).then(([saved, currentPlatform]) => {
      setSettings(saved);
      setPlatform(currentPlatform);
    });

    let stopListening: (() => void) | undefined;
    void listen("tray-apply-today", () => {
      setSelectedDate(today);
      void getWallpaper(today).then((record) => {
        setWallpaper(record);
        return invoke("apply_wallpaper", {
          imageUrl: record.imageUrl,
          date: today,
          setLockScreen: false,
        });
      });
    }).then((unlisten) => {
      stopListening = unlisten;
    });

    return () => stopListening?.();
  }, [today]);

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

  const title = parseTitle(wallpaper?.title ?? "必应每日壁纸");

  return (
    <main className="app-shell">
      <div className="ambient" aria-hidden="true" />
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark"><Sparkles size={18} /></span>
          <span>必应壁纸</span>
        </div>
        <div className="header-actions">
          <span className="platform-label">
            {platform === "macos" ? "macOS" : platform === "windows" ? "Windows" : "预览模式"}
          </span>
          <button className="icon-button" type="button" aria-label="打开设置" onClick={() => setSettingsOpen(true)}>
            <SettingsIcon size={19} />
          </button>
        </div>
      </header>

      <section className="wallpaper-stage" aria-busy={action === "loading"}>
        {wallpaper ? (
          <img className="wallpaper-image" src={wallpaper.imageUrl} alt={title.headline} />
        ) : (
          <div className="image-placeholder"><ImageIcon size={44} /></div>
        )}
        <div className="image-shade" aria-hidden="true" />
        <div className="image-copy">
          <p className="eyebrow"><CalendarDays size={14} /> {friendlyDate(selectedDate)}</p>
          <h1>{title.headline}</h1>
          {title.attribution && <p className="attribution">{title.attribution}</p>}
          {wallpaper?.description && <p className="description">{wallpaper.description}</p>}
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
          <label className="date-field">
            <span className="sr-only">选择日期</span>
            <input
              type="date"
              min="2010-01-01"
              max={today}
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
            />
          </label>
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
              <label className={`setting-row ${platform !== "windows" ? "disabled" : ""}`}>
                <span><strong>同时更新锁屏</strong><small>{platform === "windows" ? "Windows 实验功能，可能需要额外系统权限" : "macOS 没有公开的锁屏壁纸接口"}</small></span>
                <input type="checkbox" role="switch" checked={settings.lockScreen} disabled={platform !== "windows"} onChange={(event) => void updateSettings({ lockScreen: event.target.checked })} />
              </label>
            </div>
            <p className="settings-note">关闭主窗口后应用仍会驻留托盘。请通过托盘菜单完全退出。</p>
          </aside>
        </div>
      )}
    </main>
  );
}

export default App;
