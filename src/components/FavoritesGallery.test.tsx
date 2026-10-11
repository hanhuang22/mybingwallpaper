import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Favorite } from "../lib/favorites";
import { defaultSettings } from "../lib/wallpaper";
import { FavoritesGallery } from "./FavoritesGallery";

const props = {
  settings: defaultSettings, loading: false, busy: false, settingsBusy: false,
  feedback: "", error: "", pendingId: null,
  onSelect: () => {}, onRemove: () => {}, onImport: () => {}, onSettings: () => {}, onAdvance: () => {},
};
const favorites = Array.from({ length: 31 }, (_, index): Favorite => ({
  id: String(index), source: "local", title: `Picture ${index + 1}`, date: null,
  description: "", sourceUrl: null, imagePath: `/images/${index}.jpg`, thumbnailPath: `/thumbnails/${index}.jpg`, addedAt: index,
}));

describe("favorites gallery", () => {
  beforeEach(() => vi.stubGlobal("window", {}));
  afterEach(() => vi.unstubAllGlobals());

  it("keeps playback beside import without a separate full-width bar", () => {
    const html = renderToStaticMarkup(<FavoritesGallery {...props} favorites={[]} />);
    expect(html).toContain('class="favorites-header-actions"');
    expect(html).toContain('class="wallpaper-automation header"');
    expect(html).not.toContain("favorites-playback");
    expect(html).not.toContain('aria-label="收藏分页"');
  });
  it("renders only the current page and provides an editable page number", () => {
    const html = renderToStaticMarkup(<FavoritesGallery {...props} favorites={favorites} />);
    expect(html.match(/class="favorite-tile"/g)).toHaveLength(30);
    expect(html).not.toContain("/thumbnails/30.jpg");
    expect(html).toContain('aria-label="收藏页码"');
    expect(html).toContain('aria-label="上一页收藏" disabled=""');
    expect(html).toContain('aria-label="下一页收藏"');
    expect(html).toContain("1–30 / 31 张");
  });
  it("does not show pagination for 30 or fewer images", () => {
    const html = renderToStaticMarkup(<FavoritesGallery {...props} favorites={favorites.slice(0, 30)} />);
    expect(html).not.toContain('aria-label="收藏分页"');
  });
});
