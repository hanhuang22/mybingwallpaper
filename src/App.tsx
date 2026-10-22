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
  Heart,
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
import { FavoritesGallery } from "./components/FavoritesGallery";
import { WallpaperAutomation } from "./components/WallpaperAutomation";
import { favoriteWallpaper, matchingFavorite, type Favorite, type FavoriteImportResult } from "./lib/favorites";
import { WindowsTitleBar } from "./components/WindowsTitleBar";
import { preloadWallpaperImage } from "./lib/image";
import { softwareUpdatePercent, type SoftwareUpdateProgress } from "./lib/softwareUpdate";
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
const MINIMUM_DATE = "2010-01-01";
const GALLERY_CACHE_TTL_MS = 5 * 60_000;

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
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [favoritesLoading, setFavoritesLoading] = useState(true);
  const [favoritesBusy, setFavoritesBusy] = useState(false);
  const [favoritesError, setFavoritesError] = useState("");
  const [favoritesFeedback, setFavoritesFeedback] = useState("");
  const [favoritesPendingId, setFavoritesPendingId] = useState<string | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const favoritePreviewRef = useRef(false);
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
  const [appVersion, setAppVersion] = useState("1.2.5");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheck | null>(null);
  const [updateFeedback, setUpdateFeedback] = useState<UpdateFeedback | null>(null);
  const wallpaperRequest = useRef(0);
  const galleryWallpaperRequest = useRef<number | null>(null);
  const installingUpdateRef = useRef(false);
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
    if (galleryWallpaperRequest.current === wallpaperRequest.current) {
      // Cancel only the picture load owned by this selection. Closing a completed
      // zoom must not invalidate a newer date request or its successfully shown image.
      wallpaperRequest.current += 1;
      setAction(null);
      setMessage("");
      const previous = wallpaperRef.current;
      if (previous && !previous.favoriteId && previous.date !== selectedDateRef.current) {
        gallerySkipDate.current = previous.date;
        setSelectedDate(previous.date);
      }
    }
    galleryWallpaperRequest.current = null;
    if (galleryZoomTimer.current !== null) {
      window.clearTimeout(galleryZoomTimer.current);
      galleryZoomTimer.current = null;
    }
    setGalleryZoom(null);
    setGalleryPendingDate(null);
    setGallerySelectionError("");
    setGalleryOpen(false);
    setFavoritesOpen(false);
    setFavoritesPendingId(null);
  }, [setSelectedDate]);

  useEffect(() => {
    if (!isTauri()) return;
    const listeners = Promise.all([
      listen("main-window-reset-view", () => {
        closeSettings();
        closeGallery();
      }),
      listen("main-window-open-settings", () => {
        closeGallery();
        settingsOpenRef.current = true;
        setSettingsOpen(true);
      }),
    ]);
    return () => { void listeners.then((unlisteners) => unlisteners.forEach((unlisten) => unlisten())); };
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
    favoritePreviewRef.current = Boolean(next.favoriteId);
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
    // Rust owns archive completeness/retention. An old month in this UI cache may
    // still be incomplete, so revisit the backend after the same short TTL.
    if (!forceRefresh && cached && Date.now() - cached.loadedAt < GALLERY_CACHE_TTL_MS) {
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
    if (favoritePreviewRef.current) return;
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
    if (wallpaper?.favoriteId || selectedDate !== today || wallpaper?.date !== today || wallpaper.description.trim()) return;
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
  }, [loadWallpaper, selectedDate, showWallpaper, today, wallpaper?.date, wallpaper?.description, wallpaper?.favoriteId]);

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
    if (!isTauri()) {
      try { setFavorites(JSON.parse(localStorage.getItem("mybingwallpaper-favorites") ?? "[]")); } catch { /* Empty browser preview collection. */ }
      setFavoritesLoading(false);
      return;
    }

    void invoke<Favorite[]>("get_favorites")
      .then(setFavorites)
      .catch((reason) => setFavoritesError(`读取收藏失败：${String(reason)}`))
      .finally(() => setFavoritesLoading(false));

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
      listen<string>("auto-update-complete", (event) => {
        syncToday(event.payload);
        setError((current) => current.startsWith("自动更新失败：") ? "" : current);
        setDismissedToast((current) => current?.startsWith("自动更新失败：") ? null : current);
        if (!favoritePreviewRef.current && selectedDateRef.current === event.payload) void loadWallpaper(event.payload);
      }),
      listen<Settings>("wallpaper-settings-changed", (event) => {
        setSettings(event.payload);
        setFavoritesFeedback("收藏已清空，自动播放已关闭；桌面保留当前壁纸。");
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
      listen<string>("space-wallpaper-error", (event) => {
        setError(`桌面空间壁纸同步失败：${event.payload}`);
      }),
      listen<SoftwareUpdateProgress>("software-update-progress", (event) => {
        cancelUpdateStatusReset();
        setDownloadingUpdate(true);
        setUpdateProgress(softwareUpdatePercent(event.payload));
        if (event.payload.downloaded === 0) {
          setUpdateFeedback({ kind: "info", text: `正在从 ${event.payload.source} 下载并校验更新包…` });
        }
      }),
      listen<string>("software-update-failed", (event) => {
        setDownloadingUpdate(false);
        setUpdateProgress(null);
        setUpdateInfo((current) => current?.updateAvailable ? current : null);
        setUpdateFeedback({ kind: "error", text: `下载更新失败：${event.payload}` });
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
    if (settingsBusy) return;
    const next = { ...settings, ...patch };
    next.autoUpdate = next.wallpaperMode === "daily";
    setSettingsBusy(true);
    setSettings(next);
    setError("");
    try {
      if (isTauri()) await invoke("save_settings", { settings: next });
    } catch (reason) {
      setSettings(settings);
      setError(`设置保存失败：${reason instanceof Error ? reason.message : String(reason)}`);
      setFavoritesError(`设置保存失败：${String(reason)}`);
    } finally {
      setSettingsBusy(false);
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
      const favorite = matchingFavorite(favorites, wallpaper);
      if (favorite) await invoke("apply_favorite", { id: favorite.id });
      else await invoke("apply_wallpaper", {
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
    setMessage("正在保存原图…");
    try {
      const path = wallpaper.favoriteId
        ? await invoke<string>("save_favorite", { id: wallpaper.favoriteId })
        : await invoke<string>("save_wallpaper", { imageUrl: wallpaper.imageUrl, date: wallpaper.date });
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

  const openFavoritesDirectory = async () => {
    if (!isTauri()) {
      setFavoritesError("请在桌面应用中打开收藏文件夹");
      return;
    }
    setFavoritesError("");
    try {
      await invoke("open_favorites_directory");
    } catch (reason) {
      setFavoritesError(`打开收藏文件夹失败：${reason instanceof Error ? reason.message : String(reason)}`);
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

  const showUpdateResult = (result: UpdateCheck, downloadRequested: boolean) => {
    setUpdateInfo(result);
    setUpdateProgress(result.readyToRestart ? 100 : null);
    if (result.readyToRestart) {
      setUpdateFeedback({ kind: "success", text: `v${result.latestVersion} 已下载完成，重启应用即可安装` });
    } else if (result.updateAvailable) {
      setUpdateFeedback(downloadRequested
        ? { kind: "error", text: `发现新版本 v${result.latestVersion}，但未能自动下载，请重试或前往下载页手动安装` }
        : { kind: "success", text: `发现新版本 v${result.latestVersion}` });
    } else {
      setUpdateFeedback({ kind: "success", text: `当前已是最新版本 v${result.currentVersion}` });
      if (settingsOpenRef.current) scheduleUpdateStatusReset();
      else clearUpdateStatus();
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
      showUpdateResult(result, false);
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
      showUpdateResult(result, true);
    } catch (reason) {
      setUpdateInfo((current) => current?.updateAvailable ? current : null);
      setUpdateProgress(null);
      setUpdateFeedback({
        kind: "error",
        text: `下载更新失败：${reason instanceof Error ? reason.message : String(reason)}`,
      });
    } finally {
      setDownloadingUpdate(false);
    }
  };

  const installSoftwareUpdate = async () => {
    // The ref also covers two clicks delivered before React disables the button.
    if (installingUpdateRef.current) return;
    installingUpdateRef.current = true;
    setInstallingUpdate(true);
    cancelUpdateStatusReset();
    setUpdateFeedback({ kind: "info", text: "正在安装更新并重新启动…" });
    try {
      await invoke("install_software_update");
    } catch (reason) {
      setUpdateFeedback({
        kind: "error",
        text: `安装更新失败：${reason instanceof Error ? reason.message : String(reason)}`,
      });
    } finally {
      installingUpdateRef.current = false;
      setInstallingUpdate(false);
    }
  };

  const toggleGallery = () => {
    if (galleryOpen) {
      closeGallery();
      return;
    }
    closeGallery();
    const month = selectedDate.slice(0, 7);
    const cached = galleryCache.current.get(month);
    const fresh = cached && Date.now() - cached.loadedAt < GALLERY_CACHE_TTL_MS;
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
    if (date < MINIMUM_DATE || date > today) return;
    const pendingFavorite = favoritesPendingId !== null;
    if (galleryOpen || favoritesOpen) closeGallery();
    const wasFavorite = favoritePreviewRef.current;
    favoritePreviewRef.current = false;
    if (date === selectedDate && (wasFavorite || pendingFavorite)) void loadWallpaper(date);
    setSelectedDate(date);
  };

  const toggleFavorites = () => {
    if (favoritesOpen) { closeGallery(); return; }
    closeGallery();
    setFavoritesOpen(true);
    setFavoritesFeedback("");
  };

  const persistBrowserFavorites = (next: Favorite[]) => {
    localStorage.setItem("mybingwallpaper-favorites", JSON.stringify(next));
    setFavorites(next);
  };

  const removeFavorite = async (favorite: Favorite) => {
    setFavoritesBusy(true);
    setFavoritesError("");
    try {
      const next = isTauri()
        ? await invoke<Favorite[]>("remove_favorite", { id: favorite.id })
        : favorites.filter((item) => item.id !== favorite.id);
      if (isTauri()) setFavorites(next); else persistBrowserFavorites(next);
      if (wallpaperRef.current?.favoriteId === favorite.id) {
        favoritePreviewRef.current = false;
        void loadWallpaper(selectedDateRef.current);
      }
      setFavoritesFeedback("已移除收藏，原文件不受影响");
      setMessage("已移除收藏");
      window.setTimeout(() => setMessage(""), 2500);
    } catch (reason) {
      setFavoritesError(`移除失败：${String(reason)}`);
      setError(`移除收藏失败：${String(reason)}`);
    } finally { setFavoritesBusy(false); }
  };

  const toggleCurrentFavorite = async () => {
    if (!wallpaper || favoritesBusy) return;
    const current = matchingFavorite(favorites, wallpaper);
    if (current) { await removeFavorite(current); return; }
    setFavoritesBusy(true);
    setError("");
    try {
      if (isTauri()) setFavorites(await invoke<Favorite[]>("add_favorite", { record: wallpaper }));
      else persistBrowserFavorites([...favorites, {
        id: crypto.randomUUID(), source: "bing", date: wallpaper.date, title: wallpaper.title,
        description: wallpaper.description, sourceUrl: wallpaper.imageUrl,
        imagePath: wallpaper.imageUrl, thumbnailPath: wallpaper.imageUrl, addedAt: Date.now(),
      }]);
      setMessage(isTauri() ? "已加入收藏" : "已加入浏览器预览收藏");
      window.setTimeout(() => setMessage(""), 2500);
    } catch (reason) { setError(`收藏失败：${String(reason)}`); }
    finally { setFavoritesBusy(false); }
  };

  const importFavorites = async (folder: boolean) => {
    if (!isTauri()) { setFavoritesError("请在桌面测试版中导入本地图片"); return; }
    setFavoritesBusy(true);
    setFavoritesError("");
    setFavoritesFeedback("");
    try {
      const result = await invoke<FavoriteImportResult | null>("import_favorites", { folder });
      if (!result) return;
      setFavorites(result.favorites);
      setFavoritesFeedback(`已导入 ${result.addedCount} 张到收藏${result.duplicateCount ? `，跳过 ${result.duplicateCount} 张重复图片` : ""}`);
      if (result.errors.length) setFavoritesError(`${result.errors.length} 张导入失败：${result.errors.slice(0, 3).join("；")}`);
    } catch (reason) { setFavoritesError(`导入失败：${String(reason)}`); }
    finally { setFavoritesBusy(false); }
  };

  const advanceFavorite = async () => {
    setFavoritesBusy(true);
    setFavoritesError("");
    try {
      await invoke("advance_favorite");
      setFavoritesFeedback("桌面壁纸已更换，下次更换从现在开始计时。");
    } catch (reason) { setFavoritesError(`更换失败：${String(reason)}`); }
    finally { setFavoritesBusy(false); }
  };

  const selectGalleryWallpaper = async (record: Wallpaper, card: HTMLButtonElement) => {
    const selectionId = gallerySelectionId.current + 1;
    gallerySelectionId.current = selectionId;
    setGalleryPendingDate(record.date);
    setGallerySelectionError("");
    if (!record.favoriteId && record.date !== selectedDate) {
      gallerySkipDate.current = record.date;
      setSelectedDate(record.date);
    }

    let next = wallpaperRef.current?.date === record.date && wallpaperRef.current.imageUrl === record.imageUrl && wallpaperRef.current.favoriteId === record.favoriteId
      ? wallpaperRef.current
      : null;
    if (!next) {
      const loading = loadWallpaper(record.date, record);
      const request = wallpaperRequest.current;
      galleryWallpaperRequest.current = request;
      next = await loading;
      if (galleryWallpaperRequest.current === request) galleryWallpaperRequest.current = null;
    }
    if (selectionId !== gallerySelectionId.current) return;
    if (!next) {
      setGalleryPendingDate(null);
      setGallerySelectionError(record.favoriteId ? "收藏图片加载失败，请重新导入或选择其他图片" : "原图加载失败，请重试或选择其他日期");
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
  const currentFavorite = matchingFavorite(favorites, wallpaper);
  const collectionOpen = galleryOpen || favoritesOpen;
  const canUsePreview = !collectionOpen && Boolean(wallpaper) && (Boolean(wallpaper?.favoriteId) || wallpaper?.date === selectedDate) && !action;

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
        {wallpaper && !collectionOpen && (
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
          aria-hidden={titleCollapsed || collectionOpen}
          inert={titleCollapsed || collectionOpen}
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
              <p className="eyebrow">{wallpaper?.localImage ? <ImageIcon size={14} /> : <CalendarDays size={14} />} {wallpaper?.localImage ? "本地收藏" : friendlyDate(wallpaper?.date ?? selectedDate)}</p>
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
        {wallpaper && !collectionOpen && (
          <button type="button" className={`preview-favorite${currentFavorite ? " active" : ""}`} aria-label={currentFavorite ? "取消收藏当前壁纸" : "收藏当前壁纸"} title={currentFavorite ? "取消收藏" : "收藏壁纸"} aria-pressed={Boolean(currentFavorite)} disabled={favoritesBusy || favoritesLoading || Boolean(action)} onClick={() => void toggleCurrentFavorite()}>
            {favoritesBusy ? <LoaderCircle className="spin" size={19} /> : <Heart size={19} fill={currentFavorite ? "currentColor" : "none"} />}
          </button>
        )}
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
        {favoritesOpen && (
          <FavoritesGallery
            favorites={favorites}
            settings={settings}
            loading={favoritesLoading}
            busy={favoritesBusy}
            settingsBusy={settingsBusy}
            feedback={favoritesFeedback}
            error={favoritesError || gallerySelectionError}
            selectedId={wallpaper?.favoriteId ?? currentFavorite?.id}
            pendingId={favoritesPendingId}
            onSelect={(favorite, card) => {
              setFavoritesPendingId(favorite.id);
              const loading = selectGalleryWallpaper(favoriteWallpaper(favorite, today), card);
              const selectionId = gallerySelectionId.current;
              void loading.then(() => {
                if (selectionId === gallerySelectionId.current) setFavoritesPendingId(null);
              });
            }}
            onRemove={(favorite) => void removeFavorite(favorite)}
            onImport={(folder) => void importFavorites(folder)}
            onOpenDirectory={() => void openFavoritesDirectory()}
            onSettings={(patch) => { setFavoritesError(""); void updateSettings(patch); }}
            onAdvance={() => void advanceFavorite()}
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
          <button className="icon-button" type="button" aria-label="前一天" disabled={selectedDate <= MINIMUM_DATE} onClick={() => selectDockDate(addDays(selectedDate, -1))}>
            <ChevronLeft size={20} />
          </button>
          <DatePicker
            value={selectedDate}
            minimum={MINIMUM_DATE}
            maximum={today}
            onChange={selectDockDate}
          />
          <button className="icon-button" type="button" aria-label="后一天" disabled={selectedDate >= today} onClick={() => selectDockDate(addDays(selectedDate, 1))}>
            <ChevronRight size={20} />
          </button>
          <button className="text-button today-button" type="button" aria-label="今天" title="跳转到今天" onClick={() => selectDockDate(today)}>
            <CalendarCheck2 className="today-icon" size={18} /><span className="dock-navigation-label">今天</span>
          </button>
          <button className={`icon-button gallery-toggle${galleryOpen ? " active" : ""}`} type="button" aria-label={galleryOpen ? "返回单图" : "查看当月缩略图"} aria-pressed={galleryOpen} title={galleryOpen ? "返回单图" : "查看当月缩略图"} onClick={toggleGallery}>
            {galleryOpen ? <ImageIcon size={18} /> : <LayoutGrid size={18} />}
          </button>
          <button className={`icon-button gallery-toggle${favoritesOpen ? " active" : ""}`} type="button" aria-label={favoritesOpen ? "返回单图" : "查看我的收藏"} aria-pressed={favoritesOpen} title={favoritesOpen ? "返回单图" : "我的收藏"} onClick={toggleFavorites}>
            {favoritesOpen ? <ImageIcon size={18} /> : <Heart size={18} />}
          </button>
        </div>
        <div className="primary-actions">
          <button className="icon-button" type="button" aria-label="随机一张" title="随机查看一张壁纸" disabled={!wallpaper || Boolean(action)} onClick={() => selectDockDate(randomDate())}>
            <Shuffle size={18} />
          </button>
          <button className="icon-button" type="button" aria-label="保存原图" title="保存原图" disabled={!canUsePreview} onClick={saveWallpaper}>
            <Download size={18} />
          </button>
          <button className="button primary" type="button" disabled={!canUsePreview} onClick={applyWallpaper}>
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
          {error && <button type="button" onClick={() => void loadWallpaper(selectedDate, wallpaper?.favoriteId ? wallpaper : undefined, true)}><RefreshCw size={15} />重试</button>}
          <button className="toast-dismiss" type="button" aria-label="关闭提示" title="关闭提示" onClick={() => setDismissedToast(toastText)}><X size={15} /></button>
        </div>
      )}

      {settingsOpen && (
        <div className="settings-backdrop" role="presentation" onMouseDown={closeSettings}>
          <aside className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="settings-heading">
              <h2 id="settings-title">设置</h2>
              <button className="icon-button" type="button" aria-label="关闭设置" onClick={closeSettings}><X size={20} /></button>
            </div>
            <div className="setting-list">
              <section className="settings-group" aria-labelledby="wallpaper-settings-title">
                <h3 className="settings-group-title" id="wallpaper-settings-title">壁纸</h3>
                <div className="setting-row automation-setting-row">
                  <WallpaperAutomation variant="settings" settings={settings} favoriteCount={favorites.length} busy={settingsBusy || favoritesLoading} onChange={(patch) => void updateSettings(patch)} />
                </div>
                {platform === "windows" && (
                  <div className="setting-row setting-action-row">
                    <label className="setting-label" htmlFor="lock-screen-setting">
                      <strong>同时设置锁屏</strong>
                      <small id="lock-screen-description">锁屏选择“图片”时生效</small>
                    </label>
                    <div className="setting-actions">
                      <button className="settings-action settings-action-quiet" type="button" onClick={() => void openLockScreenSettings()}>
                        <ExternalLink size={16} />打开设置
                      </button>
                      <input id="lock-screen-setting" type="checkbox" role="switch" aria-describedby="lock-screen-description" checked={settings.lockScreen} onChange={(event) => void updateSettings({ lockScreen: event.target.checked })} />
                    </div>
                  </div>
                )}
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
              </section>
              <section className="settings-group" aria-labelledby="general-settings-title">
                <h3 className="settings-group-title" id="general-settings-title">通用</h3>
                <div className="setting-row theme-setting-row">
                  <span><strong>外观</strong></span>
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
                <label className="setting-row">
                  <span><strong>登录后自动启动</strong><small>静默启动，驻留系统托盘</small></span>
                  <input type="checkbox" role="switch" checked={settings.autoStart} disabled={!isTauri()} onChange={(event) => void updateSettings({ autoStart: event.target.checked })} />
                </label>
              </section>
              <section className="settings-group" aria-labelledby="update-settings-title">
                <h3 className="settings-group-title" id="update-settings-title">软件更新</h3>
                <div className="setting-row setting-action-row">
                  <span>
                    <strong>当前版本</strong>
                    <small>
                      v{appVersion}
                      {updateInfo?.updateAvailable && ` · 最新 v${updateInfo.latestVersion}`}
                      {downloadingUpdate && ` · 下载中${updateProgress === null ? "…" : ` ${updateProgress}%`}`}
                    </small>
                    {updateFeedback && (
                      <em className={`update-inline-feedback ${updateFeedback.kind}`} role={updateFeedback.kind === "error" ? "alert" : "status"}>
                        {updateFeedback.kind === "success" ? <CheckCircle2 size={14} /> : updateFeedback.kind === "error" ? <Info size={14} /> : <LoaderCircle className={checkingUpdate || downloadingUpdate || installingUpdate ? "spin" : undefined} size={14} />}
                        {updateFeedback.text}
                      </em>
                    )}
                  </span>
                  {updateInfo?.readyToRestart ? (
                    <button className="settings-action accent" type="button" disabled={installingUpdate} onClick={() => void installSoftwareUpdate()}>
                      {installingUpdate ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
                      {installingUpdate ? "正在安装" : updateFeedback?.kind === "error" ? "重试安装" : "重启并更新"}
                    </button>
                  ) : updateInfo?.updateAvailable ? (
                    <button className="settings-action accent" type="button" disabled={downloadingUpdate} onClick={() => void downloadSoftwareUpdate()}>
                      {downloadingUpdate ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
                      {downloadingUpdate ? "下载中" : "下载更新"}
                    </button>
                  ) : (
                    <button className="settings-action" type="button" disabled={checkingUpdate || downloadingUpdate || installingUpdate || Boolean(updateInfo)} onClick={() => void checkForUpdates()}>
                      {checkingUpdate ? <LoaderCircle className="spin" size={16} /> : updateInfo ? <CheckCircle2 size={16} /> : <RefreshCw size={16} />}
                      {checkingUpdate ? "检查中" : updateInfo ? "已是最新" : "检查更新"}
                    </button>
                  )}
                </div>
                <label className="setting-row">
                  <span><strong>自动下载更新</strong><small>后台下载，安装前询问</small></span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={settings.autoDownloadUpdates}
                    disabled={installingUpdate}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      void updateSettings({ autoDownloadUpdates: enabled });
                      if (enabled) void downloadSoftwareUpdate();
                    }}
                  />
                </label>
              </section>
            </div>
            <div className="settings-links" aria-label="项目链接">
              <button type="button" onClick={() => void openExternal(OFFICIAL_SITE)}><Globe2 size={15} />官方网站<ExternalLink size={13} /></button>
              <button type="button" onClick={() => void openExternal(GITEE_RELEASES)}><PackageOpen size={15} />国内下载<ExternalLink size={13} /></button>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}

export default App;
