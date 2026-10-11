import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultSettings } from "../lib/wallpaper";
import { WallpaperAutomation } from "./WallpaperAutomation";

describe("wallpaper automation controls", () => {
  it("uses one settings label and a custom menu trigger instead of a native select", () => {
    const html = renderToStaticMarkup(<WallpaperAutomation variant="settings" settings={defaultSettings} favoriteCount={0} busy={false} onChange={() => {}} />);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain("<select");
    expect(html.match(/<strong>自动换壁纸<\/strong>/g)).toHaveLength(1);
    expect(html).not.toContain('aria-label="收藏壁纸更换间隔"');
  });

  it("only shows interval buttons for favorites and selects the saved interval", () => {
    const html = renderToStaticMarkup(<WallpaperAutomation settings={{ ...defaultSettings, wallpaperMode: "favoritesRandom", favoritesIntervalMinutes: 60 }} favoriteCount={3} busy={false} onChange={() => {}} />);
    expect(html).toContain("随机收藏");
    expect(html).toContain('aria-label="收藏壁纸更换间隔"');
    expect(html).toContain('aria-pressed="true">1 小时</button>');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it("disables changes while settings are being saved", () => {
    const html = renderToStaticMarkup(<WallpaperAutomation settings={{ ...defaultSettings, wallpaperMode: "favoritesSequential" }} favoriteCount={2} busy onChange={() => {}} />);
    expect(html.match(/disabled=""/g)).toHaveLength(5);
  });

  it("keeps header controls to a single button, with interval controls inside the popup", () => {
    const html = renderToStaticMarkup(<WallpaperAutomation variant="header" settings={{ ...defaultSettings, wallpaperMode: "favoritesSequential" }} favoriteCount={2} busy={false} onChange={() => {}} />);
    expect(html).toContain("收藏循环");
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).not.toContain("更换间隔");
    expect(html).not.toContain("按收藏顺序播放");
  });
});
