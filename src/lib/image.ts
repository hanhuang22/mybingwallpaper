export function preloadWallpaperImage(url: string, timeoutMs = 20_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => finish(new Error("图片加载超时，请检查网络后重试")), timeoutMs);
    image.onload = () => finish();
    image.onerror = () => finish(new Error("图片加载失败，请检查网络后重试"));
    image.src = url;
    if (image.complete && image.naturalWidth > 0) finish();
  });
}
