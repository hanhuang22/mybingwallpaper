import { afterEach, describe, expect, it, vi } from "vitest";
import { preloadWallpaperImage } from "./image";

class FakeImage {
  static latest: FakeImage;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  complete = false;
  naturalWidth = 0;
  src = "";

  constructor() {
    FakeImage.latest = this;
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("preloadWallpaperImage", () => {
  it("waits for the image itself to load", async () => {
    vi.stubGlobal("Image", FakeImage);
    const loaded = preloadWallpaperImage("https://example.com/wallpaper.jpg");
    expect(FakeImage.latest.src).toBe("https://example.com/wallpaper.jpg");
    FakeImage.latest.onload?.();
    await expect(loaded).resolves.toBeUndefined();
  });

  it("reports an image error", async () => {
    vi.stubGlobal("Image", FakeImage);
    const loaded = preloadWallpaperImage("https://example.com/missing.jpg");
    FakeImage.latest.onerror?.();
    await expect(loaded).rejects.toThrow("图片加载失败");
  });

  it("times out if the network does not respond", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Image", FakeImage);
    const loaded = preloadWallpaperImage("https://example.com/slow.jpg", 1_000);
    const assertion = expect(loaded).rejects.toThrow("图片加载超时");
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });
});
