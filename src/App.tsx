import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  CalendarDays,
  CalendarCheck2,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  ExternalLink,
  Folder,
  FolderOpen,
  Globe2,
  ImageIcon,
  Info,
  LayoutGrid,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DatePicker } from "./components/DatePicker";
import { MonthGallery } from "./components/MonthGallery";
import { WindowsTitleBar } from "./components/WindowsTitleBar";
import { preloadWallpaperImage } from "./lib/image";
import {
  addDays,
  addMonths,
  defaultSettings,
  fetchMonthWallpapersInBrowser,
  fetchWallpaperInBrowser,
  formatDateKey,
  parseTitle,
  randomDate,
  resolveMonthWallpapers,
  syncDateNavigation,
  withTodayFallback,
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

interface GalleryZoom {
  imageUrl: string;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  expanded: boolean;
}

const OFFICIAL_SITE = "https://hanhuang22.github.io/mybingwallpaper/";
const GITEE_RELEASES = "https://gitee.com/Hyman25/mybingwallpaper/releases";

const isTauri = () => Boolean(window.__TAURI_INTERNALS__);
const isUnpublishedToday = (detail: string) =>
  detail.includes("没有找到这一天的壁纸") || detail.includes("Bing 尚未发布今日壁纸");

function friendlyDate(date: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date(`${date}T12:00:00`));
}

function compactDirectory(path: string) {
  if (path.length <= 32) return path;
  const separator = path.includes("\\") ? "\\" : "/";
  const segments = path.split(separator).filter(Boolean);
  return segments.length > 2 ? `…${separator}${segments.slice(-2).join(separator)}` : path;
}

async function getWallpaper(date: string, forceRefresh = false): Promise<Wallpaper> {
  if (isTauri()) {
    return invoke<Wallpaper>("get_wallpaper", { date, forceRefresh });
  }
  return fetchWallpaperInBrowser(date, forceRefresh);
}

async function getMonthWallpapers(month: string, forceRefresh = false): Promise<Wallpaper[]> {
  if (isTauri()) {
    return invoke<Wallpaper[]>("get_month_wallpapers", { month: month.replace("-", ""), forceRefresh });
  }
  return fetchMonthWallpapersInBrowser(month, forceRefresh);
}

function App() {
  const [{ today, selectedDate }, setDateNavigation] = useState(() => {
    const currentDate = formatDateKey(new Date());
    return { today: currentDate, selectedDate: currentDate };
  });
  const [wallpaper, setWallpaper] = useState<Wallpaper | null>(null);
  const [outgoingWallpaper, setOutgoingWallpaper] = useState<Wallpaper | null>(null);
  const [retryTodayWallpaper, setRetryTodayWallpaper] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryMonth, setGalleryMonth] = useState(() => formatDateKey(new Date()).slice(0, 7));
  const [galleryRecords, setGalleryRecords] = useState<Wallpaper[]>([]);
  const galleryDisplayRecords = useMemo(
    () => galleryMonth === today.slice(0, 7)
      ? withTodayFallback(galleryRecords, today, wallpaper)
      : galleryRecords,
    [galleryMonth, galleryRecords, today, wallpaper],
  );
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryError, setGalleryError] = useState("");
  const [gallerySelectionError, setGallerySelectionError] = useState("");
  const [galleryReloadId, setGalleryReloadId] = useState(0);
  const [galleryPendingDate, setGalleryPendingDate] = useState<string | null>(null);
  const [galleryZoom, setGalleryZoom] = useState<GalleryZoom | null>(null);
  const [action, setAction] = useState<Action>("loading");
  const [message, setMessage] = useState("正在载入今日壁纸…");
  const [error, setError] = useState("");
  const [dismissedToast, setDismissedToast] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [titleCollapsed, setTitleCollapsed] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [detailsHovered, setDetailsHovered] = useState(false);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [saveDirectory, setSaveDirectory] = useState("");
  const [saveDirectoryError, setSaveDirectoryError] = useState("");
  const [choosingSaveDirectory, setChoosingSaveDirectory] = useState(false);
  const [platform, setPlatform] = useState<"windows" | "macos" | "browser">(
    () => {
      if (!isTauri()) return "browser";
      if (navigator.userAgent.includes("Macintosh")) return "macos";
      if (navigator.userAgent.includes("Windows")) return "windows";
      return "browser";
    },
  );
  const [appVersion, setAppVersion] = useState("1.1.2");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheck | null>(null);
  const [updateFeedback, setUpdateFeedback] = useState<UpdateFeedback | null>(null);
  const wallpaperRequest = useRef(0);
  const lastAutomaticRefreshDate = useRef<string | null>(null);
  const wallpaperRef = useRef<Wallpaper | null>(null);
  const selectedDateRef = useRef(selectedDate);
  const galleryStageRef = useRef<HTMLElement>(null);
  const galleryCache = useRef(new Map<string, { records: Wallpaper[]; loadedAt: number }>());
  const galleryForceRefresh = useRef<string | null>(null);
  const gallerySelectionId = useRef(0);
  const gallerySkipDate = useRef<string | null>(null);
  const galleryZoomTimer = useRef<number | null>(null);
  const settingsOpenRef = useRef(settingsOpen);
  const updateStatusResetTimer = useRef<number | null>(null);

  selectedDateRef.current = selectedDate;

  useEffect(() => {
    settingsOpenRef.current = settingsOpen;
  }, [settingsOpen]);

  useEffect(() => {
    if (!outgoingWallpaper) return;
    const timer = window.setTimeout(() => setOutgoingWallpaper(null), 650);
    return () => window.clearTimeout(timer);
  }, [outgoingWallpaper]);

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

  const closeGallery = useCallback(() => {
    gallerySelectionId.current += 1;
    if (galleryZoomTimer.current !== null) {
      window.clearTimeout(galleryZoomTimer.current);
      galleryZoomTimer.current = null;
    }
    setGalleryZoom(null);
    setGalleryPendingDate(null);
    setGallerySelectionError("");
    setGalleryOpen(false);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const listener = listen("main-window-reset-view", () => {
      closeSettings();
      closeGallery();
    });
    return () => { void listener.then((unlisten) => unlisten()); };
  }, [closeGallery, closeSettings]);

  useEffect(() => () => cancelUpdateStatusReset(), [cancelUpdateStatusReset]);
  useEffect(() => () => {
    if (galleryZoomTimer.current !== null) window.clearTimeout(galleryZoomTimer.current);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolved = settings.theme === "system"
        ? (media.matches ? "dark" : "light")
        : settings.theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
      if (platform === "windows" && isTauri()) {
        void invoke("set_window_appearance", { mode: settings.theme })
          .catch((reason) => console.warn("无法同步 Windows 窗口外观", reason));
      }
    };
    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [platform, settings.theme]);

  const showWallpaper = useCallback((next: Wallpaper) => {
    const previous = wallpaperRef.current;
    setOutgoingWallpaper(previous?.imageUrl !== next.imageUrl ? previous : null);
    wallpaperRef.current = next;
    setWallpaper(next);
  }, []);

  const loadWallpaper = useCallback(async (date: string, knownRecord?: Wallpaper, forceRefresh = false) => {
    const request = wallpaperRequest.current + 1;
    wallpaperRequest.current = request;
    setAction("loading");
    setError("");
    setMessage("正在载入壁纸…");
    try {
      const next = knownRecord ?? await getWallpaper(date, forceRefresh);
      if (request !== wallpaperRequest.current) return null;
      setMessage("正在加载壁纸图片…");
      await preloadWallpaperImage(next.imageUrl);
      if (request !== wallpaperRequest.current) return null;
      showWallpaper(next);
      setRetryTodayWallpaper(false);
      setDismissedToast(null);
      setMessage("");
      return next;
    } catch (reason) {
      if (request === wallpaperRequest.current) {
        const detail = reason instanceof Error ? reason.message : String(reason);
        const isToday = date === formatDateKey(new Date());
        setRetryTodayWallpaper(isToday);
        if (isToday && isUnpublishedToday(detail)) {
          setError("");
          setMessage("今日壁纸尚未同步，稍后自动重试");
        } else {
          setError(`${friendlyDate(date)} 的壁纸加载失败：${detail}${wallpaperRef.current ? "；已保留上一张壁纸" : ""}`);
          setMessage("");
        }
      }
      return null;
    } finally {
      if (request === wallpaperRequest.current) setAction(null);
    }
  }, [showWallpaper]);

  useEffect(() => {
    if (!galleryOpen) return;
    const forceRefresh = galleryForceRefresh.current === galleryMonth;
    galleryForceRefresh.current = null;
    const cached = galleryCache.current.get(galleryMonth);
    if (!forceRefresh && cached && (galleryMonth < today.slice(0, 7) || Date.now() - cached.loadedAt < 5 * 60_000)) {
      setGalleryRecords(cached.records);
      setGalleryLoading(false);
      setGalleryError("");
      return;
    }

    let active = true;
    setGalleryLoading(true);
    setGalleryRecords([]);
    setGalleryError("");
    void getMonthWallpapers(galleryMonth, forceRefresh)
      .then(async (records) => {
        if (!active) return;
        const visibleRecords = await resolveMonthWallpapers(
          galleryMonth, today, records, wallpaperRef.current, () => getWallpaper(today),
        );
        if (!active) return;
        if (visibleRecords.length === 0) throw new Error("这个月暂时没有壁纸");
        galleryCache.current.delete(galleryMonth);
        galleryCache.current.set(galleryMonth, { records: visibleRecords, loadedAt: Date.now() });
        if (galleryCache.current.size > 3) {
          const oldest = galleryCache.current.keys().next().value;
          if (oldest) galleryCache.current.delete(oldest);
        }
        setGalleryRecords(visibleRecords);
      })
      .catch((reason) => {
        if (active) setGalleryError(`月览加载失败：${reason instanceof Error ? reason.message : String(reason)}`);
      })
      .finally(() => { if (active) setGalleryLoading(false); });
    return () => { active = false; };
  }, [galleryMonth, galleryOpen, galleryReloadId, today]);

  useEffect(() => {
    setDetailsExpanded(false);
    setDetailsHovered(false);
    if (gallerySkipDate.current === selectedDate) {
      gallerySkipDate.current = null;
      return;
    }
    gallerySkipDate.current = null;
    void loadWallpaper(selectedDate);
  }, [loadWallpaper, selectedDate]);

  useEffect(() => {
    if (!retryTodayWallpaper || selectedDate !== today) return;
    const retryTimer = window.setInterval(() => void loadWallpaper(selectedDate), 2 * 60_000);
    return () => window.clearInterval(retryTimer);
  }, [loadWallpaper, retryTodayWallpaper, selectedDate, today]);

  useEffect(() => {
    if (selectedDate !== today || wallpaper?.date !== today || wallpaper.description.trim()) return;
    let active = true;
    const retryTimer = window.setInterval(() => {
      void getWallpaper(today).then((next) => {
        if (!active || selectedDateRef.current !== today || !next.description.trim()) return;
        const current = wallpaperRef.current;
        if (current?.date !== today) return;
        if (current.imageUrl === next.imageUrl) showWallpaper(next);
        else void loadWallpaper(today);
      }).catch(() => {});
    }, 2 * 60_000);
    return () => {
      active = false;
      window.clearInterval(retryTimer);
    };
  }, [loadWallpaper, selectedDate, showWallpaper, today, wallpaper?.date, wallpaper?.description]);

  useEffect(() => {
    let midnightTimer = 0;

    const refreshWallpaper = () => {
      if (!isTauri()) return;
      void invoke("run_auto_update").catch((reason) => {
        if (isUnpublishedToday(String(reason))) return;
        setError(`自动更新失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
    };

    const refreshDateAndWallpaper = () => {
      const currentDate = formatDateKey(new Date());
      syncToday(currentDate);
      if (lastAutomaticRefreshDate.current === currentDate) return;
      lastAutomaticRefreshDate.current = currentDate;
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
      invoke<string>("get_save_directory").catch(() => "无法读取默认图片目录"),
      invoke<"windows" | "macos">("get_platform"),
      invoke<string>("get_app_version"),
    ]).then(([saved, directory, currentPlatform, currentVersion]) => {
      setSettings(saved);
      setSaveDirectory(directory);
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
          return invoke("apply_wallpaper", {
            imageUrl: record.imageUrl,
            date: currentDate,
            setLockScreen: false,
          });
        });
      }),
      listen<string>("auto-update-complete", (event) => {
        syncToday(event.payload);
        setError((current) => current.startsWith("自动更新失败：") ? "" : current);
        setDismissedToast((current) => current?.startsWith("自动更新失败：") ? null : current);
        if (selectedDateRef.current === event.payload) void loadWallpaper(event.payload);
      }),
      listen<string>("auto-update-error", (event) => {
        if (isUnpublishedToday(event.payload)) return;
        setError(`自动更新失败：${event.payload}`);
      }),
      listen<string>("auto-update-warning", (event) => {
        setError("");
        setMessage(event.payload);
        window.setTimeout(() => setMessage(""), 6_000);
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
  }, [appVersion, cancelUpdateStatusReset, loadWallpaper, setSelectedDate, syncToday]);

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
        date: wallpaper.date,
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
    setMessage(settings.saveWithoutPrompt ? "正在保存原图…" : "请选择保存位置…");
    try {
      const path = await invoke<string | null>("save_wallpaper", {
        imageUrl: wallpaper.imageUrl,
        date: wallpaper.date,
      });
      if (path) {
        setMessage(`已保存到 ${path}`);
        window.setTimeout(() => setMessage(""), 4500);
      } else {
        setMessage("");
      }
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

  const openWallpaperCache = async () => {
    if (!isTauri()) {
      setError("请在桌面应用中打开壁纸缓存目录");
      return;
    }
    try {
      await invoke("open_wallpaper_cache");
    } catch (reason) {
      setError(`打开缓存目录失败：${reason instanceof Error ? reason.message : String(reason)}`);
    }
  };

  const openLockScreenSettings = async () => {
    try {
      await invoke("open_lock_screen_settings");
    } catch (reason) {
      setError(`打开锁屏设置失败：${reason instanceof Error ? reason.message : String(reason)}`);
    }
  };

  const chooseSaveDirectory = async () => {
    if (!isTauri()) return;
    setChoosingSaveDirectory(true);
    setSaveDirectoryError("");
    try {
      const directory = await invoke<string | null>("choose_save_directory");
      if (directory) setSaveDirectory(directory);
    } catch (reason) {
      setSaveDirectoryError(`更改失败：${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setChoosingSaveDirectory(false);
    }
  };

  const openSaveDirectory = async () => {
    if (!isTauri()) return;
    setSaveDirectoryError("");
    try {
      await invoke("open_save_directory");
    } catch (reason) {
      setSaveDirectoryError(`打开失败：${reason instanceof Error ? reason.message : String(reason)}`);
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

  const toggleGallery = () => {
    if (galleryOpen) {
      closeGallery();
      return;
    }
    const month = selectedDate.slice(0, 7);
    const cached = galleryCache.current.get(month);
    const fresh = cached && (month < today.slice(0, 7) || Date.now() - cached.loadedAt < 5 * 60_000);
    setGalleryMonth(month);
    setGalleryRecords(fresh ? cached.records : []);
    setGalleryLoading(!fresh);
    setGalleryError("");
    setGallerySelectionError("");
    setGalleryOpen(true);
  };

  const moveGalleryMonth = (amount: number) => {
    const month = addMonths(galleryMonth, amount);
    if (month < "2010-01" || month > today.slice(0, 7)) return;
    setGalleryMonth(month);
    setGalleryRecords([]);
    setGalleryLoading(true);
    setGallerySelectionError("");
  };

  const selectDockDate = (date: string) => {
    if (galleryOpen) closeGallery();
    setSelectedDate(date);
  };

  const selectGalleryWallpaper = async (record: Wallpaper, card: HTMLButtonElement) => {
    const selectionId = gallerySelectionId.current + 1;
    gallerySelectionId.current = selectionId;
    setGalleryPendingDate(record.date);
    setGallerySelectionError("");
    if (record.date !== selectedDate) {
      gallerySkipDate.current = record.date;
      setSelectedDate(record.date);
    }

    const next = wallpaperRef.current?.date === record.date && wallpaperRef.current.imageUrl === record.imageUrl
      ? wallpaperRef.current
      : await loadWallpaper(record.date, record);
    if (selectionId !== gallerySelectionId.current) return;
    if (!next) {
      setGalleryPendingDate(null);
      setGallerySelectionError("原图加载失败，请重试或选择其他日期");
      return;
    }

    const stage = galleryStageRef.current;
    if (!stage || !card.isConnected) {
      closeGallery();
      return;
    }
    const stageRect = stage.getBoundingClientRect();
    const cardRect = (card.querySelector("img") ?? card).getBoundingClientRect();
    setGalleryZoom({
      imageUrl: next.imageUrl,
      x: cardRect.left - stageRect.left,
      y: cardRect.top - stageRect.top,
      scaleX: cardRect.width / stageRect.width,
      scaleY: cardRect.height / stageRect.height,
      expanded: false,
    });
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (selectionId !== gallerySelectionId.current) return;
      setGalleryZoom((current) => current ? { ...current, expanded: true } : null);
      galleryZoomTimer.current = window.setTimeout(
        () => { if (selectionId === gallerySelectionId.current) closeGallery(); },
        window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 60 : 540,
      );
    }));
  };

  const title = parseTitle(wallpaper?.title ?? "必应每日壁纸");
  const showDetails = !titleCollapsed && (detailsExpanded || detailsHovered);
  const toastText = error || (!action ? message : "");

  return (
    <main className={`app-shell${wallpaper ? " has-wallpaper" : ""}${platform === "macos" ? " mac-titlebar" : ""}${platform === "windows" ? " windows-titlebar" : ""}`}>
      {outgoingWallpaper && (
        <img className="ambient-photo outgoing" src={outgoingWallpaper.imageUrl} alt="" aria-hidden="true" />
      )}
      {wallpaper && (
        <img
          key={wallpaper.imageUrl}
          className="ambient-photo"
          src={wallpaper.imageUrl}
          alt=""
          aria-hidden="true"
        />
      )}
      <div className="ambient" aria-hidden="true" />
      {platform === "macos" && <div className="window-drag-region" data-tauri-drag-region aria-hidden="true" />}
      {platform === "windows" && <WindowsTitleBar />}
      <section className={`wallpaper-stage${titleCollapsed ? " title-collapsed" : ""}`} ref={galleryStageRef} aria-busy={action === "loading" || galleryLoading}>
        {outgoingWallpaper && (
          <img className="wallpaper-image outgoing" src={outgoingWallpaper.imageUrl} alt="" aria-hidden="true" />
        )}
        {wallpaper ? (
          <img key={wallpaper.imageUrl} className="wallpaper-image" src={wallpaper.imageUrl} alt={title.headline} />
        ) : (
          <div className="image-placeholder"><ImageIcon size={44} /></div>
        )}
        <div className="image-shade" aria-hidden="true" />
        {wallpaper && (
          <button
            className="title-collapse-toggle"
            type="button"
            aria-label={titleCollapsed ? "展开壁纸标题" : "收起壁纸标题，完整预览图片"}
            aria-controls="wallpaper-title"
            aria-expanded={!titleCollapsed}
            title={titleCollapsed ? "展开标题" : "收起标题，完整预览"}
            onClick={() => {
              setTitleCollapsed((collapsed) => !collapsed);
              setDetailsHovered(false);
            }}
          >
            {titleCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        )}
        <div
          id="wallpaper-title"
          className={`image-copy${showDetails ? " expanded" : ""}${detailsExpanded ? " pinned" : ""}`}
          aria-hidden={titleCollapsed}
          inert={titleCollapsed}
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
              <p className="eyebrow"><CalendarDays size={14} /> {friendlyDate(wallpaper?.date ?? selectedDate)}</p>
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
        {galleryOpen && (
          <MonthGallery
            month={galleryMonth}
            minimumMonth="2010-01"
            maximumMonth={today.slice(0, 7)}
            today={today}
            selectedDate={selectedDate}
            records={galleryDisplayRecords}
            loading={galleryLoading}
            error={galleryError}
            selectionError={gallerySelectionError}
            pendingDate={galleryPendingDate}
            onMoveMonth={moveGalleryMonth}
            onRetry={() => {
              galleryCache.current.delete(galleryMonth);
              galleryForceRefresh.current = galleryMonth;
              setGalleryReloadId((current) => current + 1);
            }}
            onSelect={(record, card) => void selectGalleryWallpaper(record, card)}
          />
        )}
        {galleryZoom && (
          <div
            className="month-gallery-zoom"
            style={{
              transform: galleryZoom.expanded
                ? "translate(0, 0) scale(1)"
                : `translate(${galleryZoom.x}px, ${galleryZoom.y}px) scale(${galleryZoom.scaleX}, ${galleryZoom.scaleY})`,
              borderRadius: galleryZoom.expanded ? undefined : 12,
            }}
            aria-hidden="true"
          >
            <img src={galleryZoom.imageUrl} alt="" />
          </div>
        )}
        {(action === "loading" || action === "applying" || action === "saving") && (
          <div className="loading-indicator" role="status">
            <LoaderCircle className="spin" size={18} /> {message}
          </div>
        )}
      </section>

      <section className="control-dock" aria-label="壁纸操作">
        <div className="date-navigation">
          <button className="icon-button" type="button" aria-label="前一天" onClick={() => selectDockDate(addDays(selectedDate, -1))}>
            <ChevronLeft size={20} />
          </button>
          <DatePicker
            value={selectedDate}
            minimum="2010-01-01"
            maximum={today}
            onChange={selectDockDate}
          />
          <button className="icon-button" type="button" aria-label="后一天" disabled={selectedDate >= today} onClick={() => selectDockDate(addDays(selectedDate, 1))}>
            <ChevronRight size={20} />
          </button>
          <button className="text-button today-button" type="button" aria-label="今天" title="跳转到今天" onClick={() => selectDockDate(today)}>
            <CalendarCheck2 className="today-icon" size={18} /><span className="dock-navigation-label">今天</span>
          </button>
          <button className={`text-button gallery-toggle${galleryOpen ? " active" : ""}`} type="button" aria-label={galleryOpen ? "返回单图" : "查看当月缩略图"} aria-pressed={galleryOpen} title={galleryOpen ? "返回单图" : "查看当月缩略图"} onClick={toggleGallery}>
            {galleryOpen ? <ImageIcon size={17} /> : <LayoutGrid size={17} />}<span className="dock-navigation-label">{galleryOpen ? "单图" : "月览"}</span>
          </button>
        </div>
        <div className="primary-actions">
          <button className="button secondary compact-action" type="button" aria-label="随机一张" title="随机查看一张壁纸" disabled={!wallpaper || Boolean(action)} onClick={() => selectDockDate(randomDate())}>
            <Shuffle size={17} /><span className="dock-action-label">随机一张</span>
          </button>
          <button className="button secondary compact-action" type="button" aria-label="保存原图" title={settings.saveWithoutPrompt ? "保存到设置中的原图保存位置" : "选择位置和文件名后保存"} disabled={galleryOpen || !wallpaper || wallpaper.date !== selectedDate || Boolean(action)} onClick={saveWallpaper}>
            <Download size={17} /><span className="dock-action-label">保存原图</span>
          </button>
          <button className="button primary" type="button" disabled={galleryOpen || !wallpaper || wallpaper.date !== selectedDate || Boolean(action)} onClick={applyWallpaper}>
            <MonitorDown size={18} /> 设为壁纸
          </button>
          <button className="icon-button dock-settings" type="button" aria-label="打开设置" title="设置" onClick={() => setSettingsOpen(true)}>
            <SettingsIcon size={19} />
          </button>
        </div>
      </section>

      {toastText && toastText !== dismissedToast && (
        <div className={error ? "toast error" : "toast"} role={error ? "alert" : "status"}>
          <span className="toast-message">{toastText}</span>
          {error && <button type="button" onClick={() => void loadWallpaper(selectedDate, undefined, true)}><RefreshCw size={15} />重试</button>}
          <button className="toast-dismiss" type="button" aria-label="关闭提示" title="关闭提示" onClick={() => setDismissedToast(toastText)}><X size={15} /></button>
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
                <>
                  <label className="setting-row">
                    <span><strong>同时更新锁屏</strong><small>Windows 实验功能，可能受系统策略限制</small></span>
                    <input type="checkbox" role="switch" checked={settings.lockScreen} onChange={(event) => void updateSettings({ lockScreen: event.target.checked })} />
                  </label>
                  <div className="setting-row setting-action-row">
                    <span><strong>Windows 锁屏背景</strong><small>选择“图片”后，才会显示应用设置的锁屏壁纸</small></span>
                    <button className="settings-action" type="button" onClick={() => void openLockScreenSettings()}>
                      <ExternalLink size={16} />打开设置
                    </button>
                  </div>
                </>
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
                <span className="setting-text">
                  <strong>原图保存位置</strong>
                  <small className="setting-path" title={saveDirectory}>{isTauri() ? (saveDirectory ? compactDirectory(saveDirectory) : "正在读取保存位置…") : "仅桌面应用可设置"}</small>
                  {saveDirectoryError && <em className="setting-error" role="alert">{saveDirectoryError}</em>}
                </span>
                <div className="setting-actions">
                  <button className="settings-action" type="button" title="打开原图保存目录" disabled={!isTauri() || choosingSaveDirectory} onClick={() => void openSaveDirectory()}>
                    <FolderOpen size={16} />打开
                  </button>
                  <button className="settings-action" type="button" title="更改原图保存位置" disabled={!isTauri() || choosingSaveDirectory} onClick={() => void chooseSaveDirectory()}>
                    {choosingSaveDirectory ? <LoaderCircle className="spin" size={16} /> : <Folder size={16} />}更改
                  </button>
                </div>
              </div>
              <label className="setting-row">
                <span><strong>直接保存到此位置</strong><small>关闭后，每次保存原图都会询问位置和文件名</small></span>
                <input type="checkbox" role="switch" checked={settings.saveWithoutPrompt} onChange={(event) => void updateSettings({ saveWithoutPrompt: event.target.checked })} />
              </label>
              <div className="setting-row setting-action-row">
                <span><strong>壁纸缓存</strong><small>仅供自动更新和设为壁纸使用，与原图保存位置分开</small></span>
                <button className="settings-action" type="button" onClick={openWallpaperCache}>
                  <FolderOpen size={16} />打开缓存
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
