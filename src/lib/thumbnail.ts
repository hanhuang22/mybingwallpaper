const THUMBNAIL_WIDTH = 320;
const THUMBNAIL_HEIGHT = 180;

export function thumbnailUrl(imageUrl: string): string {
  try {
    const url = new URL(imageUrl);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" ||
      !(host === "bing.com" || host.endsWith(".bing.com")) ||
      url.pathname !== "/th") {
      return imageUrl;
    }
    url.searchParams.set("w", String(THUMBNAIL_WIDTH));
    url.searchParams.set("h", String(THUMBNAIL_HEIGHT));
    return url.toString();
  } catch {
    return imageUrl;
  }
}
