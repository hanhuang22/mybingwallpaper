/// <reference types="node" />
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "esbuild";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as favoriteHelpers from "./lib/favorites";
import * as wallpaperHelpers from "./lib/wallpaper";
import type { Favorite } from "./lib/favorites";
import type { Settings, Wallpaper } from "./lib/wallpaper";

// Run the production component's handlers with an in-memory hook/IPC/image host.
// This exercises App orchestration without a WebView, native dialogs or wallpaper writes.
const appCode = transformSync(readFileSync(new URL("./App.tsx", import.meta.url), "utf8"), {
  loader: "tsx", format: "cjs", jsx: "automatic",
}).code;
type Element = { type: unknown; props: Record<string, any> };
type UpdateResult = { currentVersion: string; latestVersion: string; updateAvailable: boolean; readyToRestart: boolean };
const latest: UpdateResult = { currentVersion: "1.2.7", latestVersion: "1.2.7", updateAvailable: false, readyToRestart: false };
const local: Favorite = { id: "local", source: "local", title: "私人照片", date: null, description: "", sourceUrl: null, imagePath: "/local.jpg", thumbnailPath: "/local-small.jpg", addedAt: 1 };
const localUrl = "asset://localhost/local.jpg";
const bingUrl = (date: string) => `https://cn.bing.com/${date}.jpg`;
const bingRecord = (date: string): Wallpaper => ({ date, title: "Bing 壁纸", description: "说明", imageUrl: bingUrl(date) });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function elements(node: any): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object") return [];
  return [node, ...elements(node.props?.children)];
}

function createApp(options: {
  settings?: Partial<Settings>;
  favorites?: Favorite[];
  imageLoads?: Record<string, Promise<void>>;
  records?: Wallpaper[];
  update?: UpdateResult;
  prepare?: (download: boolean) => Promise<UpdateResult>;
  install?: () => Promise<void>;
} = {}) {
  const states: any[] = [];
  const refs: Array<{ current: any }> = [];
  let stateIndex = 0;
  let refIndex = 0;
  let effects: Array<() => void | (() => void)> = [];
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  const react = {
    useState(initial: any) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], (value: any) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
    },
    useRef(initial: any) { return refs[refIndex++] ??= { current: initial }; },
    useEffect(effect: () => void | (() => void)) { effects.push(effect); },
    useCallback(callback: any) { return callback; },
    useMemo(factory: () => any) { return factory(); },
  };
  const windowHost = {
    __TAURI_INTERNALS__: { convertFileSrc: (path: string) => `asset://localhost${path}` },
    setTimeout, clearTimeout,
    requestAnimationFrame: (callback: () => void) => callback(),
    matchMedia: () => ({ matches: false }),
  };
  vi.stubGlobal("window", windowHost);
  const invoke = vi.fn(async (command: string, args?: any) => {
    if (command === "get_wallpaper") return bingRecord(args.date);
    if (command === "get_month_wallpapers") return options.records ?? [];
    if (command === "get_favorites") return options.favorites ?? [local];
    if (command === "load_settings") return { ...wallpaperHelpers.defaultSettings, ...options.settings };
    if (command === "get_save_directory") return "/Pictures/MyBingWallpaper";
    if (command === "get_platform") return "macos";
    if (command === "get_app_version") return "1.2.7";
    if (command === "prepare_software_update") return options.prepare?.(Boolean(args?.download)) ?? options.update ?? latest;
    if (command === "install_software_update") return options.install?.();
    if (command === "save_settings") return;
    throw new Error(`Unexpected IPC: ${command}`);
  });
  const jsx = (type: unknown, props: Record<string, any>) => ({ type, props: props ?? {} });
  const require = (name: string) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (name === "lucide-react") return new Proxy({}, { get: (_target, key) => key });
    if (name === "@tauri-apps/api/core") return { invoke };
    if (name === "@tauri-apps/api/event") return { listen: async (event: string, callback: (event: { payload: unknown }) => void) => {
      listeners.set(event, callback);
      return () => listeners.delete(event);
    } };
    if (name === "./lib/wallpaper") return wallpaperHelpers;
    if (name === "./lib/favorites") return favoriteHelpers;
    if (name === "./lib/image") return { preloadWallpaperImage: (url: string) => options.imageLoads?.[url] ?? Promise.resolve() };
    if (name === "./lib/softwareUpdate") return { softwareUpdatePercent: () => null };
    if (name.startsWith("./components/")) {
      const component = name.split("/").at(-1)!;
      return { [component]: component };
    }
    throw new Error(`Unexpected module: ${name}`);
  };
  const module = { exports: {} as { default?: () => Element } };
  vm.runInNewContext(appCode, { require, module, exports: module.exports, window: windowHost, navigator: { userAgent: "Macintosh" }, console, Intl, Date, Promise, Boolean, Map, Set, Error });
  let tree: Element;
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    effects = [];
    tree = module.exports.default!();
    for (const node of elements(tree)) {
      if (node.props.ref) node.props.ref.current = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 500 }) };
    }
    return tree;
  };
  const find = (predicate: (node: Element) => boolean) => {
    const node = elements(tree).find(predicate);
    if (!node) throw new Error("Requested App element not found");
    return node;
  };
  const effect = (source: string) => {
    const callback = effects.find(item => item.toString().includes(source));
    if (!callback) throw new Error(`Requested App effect not found: ${source}`);
    callback();
  };
  const flush = async () => { for (let count = 0; count < 12; count++) await Promise.resolve(); render(); };
  const clickLabel = (label: string) => { find(node => node.props["aria-label"] === label).props.onClick(); render(); };
  const buttonText = (text: string) => find(node => node.type === "button" && elements(node).length > 0 && [node.props.children].flat().some(child => child === text));
  const openSettings = () => { clickLabel("打开设置"); effect("settingsOpenRef.current = settingsOpen"); };
  const enableDownload = () => {
    find(node => node.type === "input" && node.props.onChange?.toString().includes("downloadSoftwareUpdate")).props.onChange({ target: { checked: true } });
    render();
  };
  const selectLocal = (favorite = local) => {
    const card = { isConnected: true, querySelector: () => null, getBoundingClientRect: () => ({ left: 100, top: 100, width: 160, height: 90 }) };
    find(node => node.type === "FavoritesGallery").props.onSelect(favorite, card);
    render();
  };
  const preview = () => find(node => node.type === "img" && node.props.className === "wallpaper-image").props.src;
  const feedback = () => find(node => node.props.className?.startsWith("update-inline-feedback")).props.children.at(-1);
  const initialize = async () => {
    render();
    effect("gallerySkipDate.current === selectedDate");
    effect('"get_favorites"');
    await flush();
  };
  const emit = (event: string, payload: unknown) => {
    const listener = listeners.get(event);
    if (!listener) throw new Error(`Requested App listener not found: ${event}`);
    listener({ payload });
    render();
  };
  return { render, find, effect, flush, clickLabel, buttonText, openSettings, enableDownload, selectLocal, preview, feedback, initialize, invoke, emit };
}

describe("App interaction regressions", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-22T12:00:00")); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("does not let a cancelled favorite load override Today", async () => {
    const localImage = deferred<void>();
    const app = createApp({ imageLoads: { [localUrl]: localImage.promise } });
    await app.initialize();
    const original = app.preview();
    app.clickLabel("查看我的收藏");
    app.selectLocal();
    app.clickLabel("返回单图");
    app.clickLabel("今天");
    localImage.resolve();
    await app.flush();
    expect(app.preview()).toBe(original);
    expect(app.find(node => node.type === "DatePicker").props.value).toBe("2026-10-22");
    expect(app.find(node => node.type === "button" && [node.props.children].flat().includes(" 设为壁纸")).props.disabled).toBe(false);
  });

  it("keeps the selected picture when a successful gallery zoom closes", async () => {
    const app = createApp();
    await app.initialize();
    app.clickLabel("查看我的收藏");
    app.selectLocal();
    await app.flush();
    await vi.advanceTimersByTimeAsync(600);
    app.render();
    expect(app.preview()).toBe(localUrl);
    expect(app.find(node => node.props["aria-label"] === "查看我的收藏")).toBeDefined();
  });

  it("does not clear a newer selection's pending state when a cancelled load finishes", async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const secondFavorite = { ...local, id: "second", imagePath: "/second.jpg" };
    const secondUrl = "asset://localhost/second.jpg";
    const app = createApp({ favorites: [local, secondFavorite], imageLoads: { [localUrl]: first.promise, [secondUrl]: second.promise } });
    await app.initialize();
    app.clickLabel("查看我的收藏");
    app.selectLocal();
    app.clickLabel("返回单图");
    app.clickLabel("查看我的收藏");
    app.selectLocal(secondFavorite);
    first.resolve();
    await app.flush();
    expect(app.find(node => node.type === "FavoritesGallery").props.pendingId).toBe("second");
    expect(app.preview()).toBe(bingUrl("2026-10-22"));
    second.resolve();
    await app.flush();
    expect(app.preview()).toBe(secondUrl);
  });

  it("restores the previous date when a pending month selection is cancelled", async () => {
    const yesterday = "2026-10-21";
    const image = deferred<void>();
    const record = bingRecord(yesterday);
    const app = createApp({ records: [record], imageLoads: { [record.imageUrl]: image.promise } });
    await app.initialize();
    const previous = app.preview();
    app.clickLabel("查看当月缩略图");
    app.effect("galleryForceRefresh.current === galleryMonth");
    await app.flush();
    app.find(node => node.type === "MonthGallery").props.onSelect(record, { isConnected: true });
    app.render();
    app.effect("gallerySkipDate.current === selectedDate");
    expect(app.find(node => node.type === "DatePicker").props.value).toBe(yesterday);
    app.clickLabel("返回单图");
    app.effect("gallerySkipDate.current === selectedDate");
    image.resolve();
    await app.flush();
    expect(app.preview()).toBe(previous);
    expect(app.find(node => node.type === "DatePicker").props.value).toBe("2026-10-22");
  });

  it("fetches Bing instead of adding the local preview to today's month grid", async () => {
    const app = createApp();
    await app.initialize();
    app.clickLabel("查看我的收藏");
    app.selectLocal();
    await app.flush();
    await vi.advanceTimersByTimeAsync(600);
    app.render();
    app.clickLabel("查看当月缩略图");
    app.effect("galleryForceRefresh.current === galleryMonth");
    await app.flush();
    const today = app.find(node => node.type === "MonthGallery").props.records.find((record: Wallpaper) => record.date === "2026-10-22");
    expect(today.imageUrl).toBe(bingUrl("2026-10-22"));
    expect(today.favoriteId).toBeUndefined();
    expect(app.invoke.mock.calls.filter(([command]) => command === "get_wallpaper")).toHaveLength(2);
  });

  it("rechecks an expired incomplete previous-month memory cache after a day changes", async () => {
    vi.setSystemTime(new Date("2026-11-01T23:59:00"));
    const october30 = bingRecord("2026-10-30");
    const october31 = bingRecord("2026-10-31");
    const options = { records: [october30] };
    const app = createApp(options);
    await app.initialize();
    app.clickLabel("查看当月缩略图");
    app.find(node => node.type === "MonthGallery").props.onMoveMonth(-1);
    app.render();
    app.effect("galleryForceRefresh.current === galleryMonth");
    await app.flush();
    expect(app.find(node => node.type === "MonthGallery").props.records).toHaveLength(1);
    app.find(node => node.type === "MonthGallery").props.onSelect(october30, {
      isConnected: true, querySelector: () => null,
      getBoundingClientRect: () => ({ left: 100, top: 100, width: 160, height: 90 }),
    });
    app.render();
    app.effect("gallerySkipDate.current === selectedDate");
    await app.flush();
    await vi.advanceTimersByTimeAsync(600);
    app.render();
    expect(app.find(node => node.type === "DatePicker").props.value).toBe("2026-10-30");

    options.records = [october30, october31];
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    app.emit("auto-update-complete", "2026-11-02");
    app.clickLabel("查看当月缩略图");
    // The opening fast path must not present this stale month as a cache hit.
    expect(app.find(node => node.type === "MonthGallery").props.loading).toBe(true);
    app.effect("galleryForceRefresh.current === galleryMonth");
    await app.flush();
    expect(app.find(node => node.type === "MonthGallery").props.records.map((record: Wallpaper) => record.date)).toEqual(["2026-10-30", "2026-10-31"]);
    expect(app.invoke.mock.calls.filter(([command]) => command === "get_month_wallpapers")).toHaveLength(2);
  });

  it("resets a no-update auto-download result back to Check for updates", async () => {
    const app = createApp({ settings: { autoDownloadUpdates: false } });
    await app.initialize();
    app.openSettings();
    app.enableDownload();
    await app.flush();
    expect(app.feedback()).toBe("当前已是最新版本 v1.2.7");
    expect(app.buttonText("已是最新").props.disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(3_000);
    app.render();
    expect(app.buttonText("检查更新").props.disabled).toBe(false);
  });

  it("stops the loading feedback and allows retry if only a release was found", async () => {
    const app = createApp({ settings: { autoDownloadUpdates: false }, update: { ...latest, latestVersion: "1.2.8", updateAvailable: true } });
    await app.initialize();
    app.openSettings();
    app.enableDownload();
    await app.flush();
    expect(app.feedback()).toContain("未能自动下载");
    expect(app.feedback()).not.toContain("正在下载");
    expect(app.buttonText("下载更新").props.disabled).toBe(false);
  });

  it("does not leave an earlier latest-version result disabling retry after download failure", async () => {
    const app = createApp({ settings: { autoDownloadUpdates: false }, prepare: async (download) => {
      if (download) throw new Error("服务不可达");
      return latest;
    } });
    await app.initialize();
    app.openSettings();
    app.buttonText("检查更新").props.onClick();
    await app.flush();
    expect(app.buttonText("已是最新").props.disabled).toBe(true);
    app.enableDownload();
    await app.flush();
    expect(app.feedback()).toContain("服务不可达");
    expect(app.buttonText("检查更新").props.disabled).toBe(false);
  });

  it("blocks duplicate installation clicks and allows retry after installation fails", async () => {
    const firstInstall = deferred<void>();
    let attempts = 0;
    const app = createApp({ settings: { autoDownloadUpdates: false }, update: { ...latest, latestVersion: "1.2.8", updateAvailable: true, readyToRestart: true }, install: () => ++attempts === 1 ? firstInstall.promise : Promise.resolve() });
    await app.initialize();
    app.openSettings();
    app.enableDownload();
    await app.flush();
    const install = app.buttonText("重启并更新");
    install.props.onClick();
    install.props.onClick();
    app.render();
    expect(attempts).toBe(1);
    expect(app.buttonText("正在安装").props.disabled).toBe(true);
    firstInstall.reject(new Error("磁盘已满"));
    await app.flush();
    expect(app.feedback()).toContain("磁盘已满");
    expect(app.buttonText("重试安装").props.disabled).toBe(false);
    app.buttonText("重试安装").props.onClick();
    await app.flush();
    expect(attempts).toBe(2);
    expect(app.invoke.mock.calls.filter(([command]) => command === "prepare_software_update")).toHaveLength(1);
  });

  it("does not navigate before the archive's minimum date", async () => {
    vi.setSystemTime(new Date("2010-01-01T12:00:00"));
    const app = createApp();
    await app.initialize();
    const previous = app.find(node => node.props["aria-label"] === "前一天");
    expect(previous.props.disabled).toBe(true);
    previous.props.onClick();
    app.render();
    expect(app.find(node => node.type === "DatePicker").props.value).toBe("2010-01-01");
    expect(app.invoke.mock.calls.filter(([command]) => command === "get_wallpaper")).toHaveLength(1);
  });
});
