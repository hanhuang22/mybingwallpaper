import { convertFileSrc } from "@tauri-apps/api/core";
import type { Settings, Wallpaper } from "./wallpaper";

export interface Favorite {
  id: string;
  source: "bing" | "local";
  date: string | null;
  title: string;
  description: string;
  sourceUrl: string | null;
  imagePath: string;
  thumbnailPath: string;
  addedAt: number;
}

export interface FavoriteImportResult {
  favorites: Favorite[];
  addedCount: number;
  duplicateCount: number;
  errors: string[];
}

export function favoriteImageUrl(path: string): string {
  return window.__TAURI_INTERNALS__ ? convertFileSrc(path) : path;
}

export function favoriteWallpaper(favorite: Favorite, today: string): Wallpaper {
  return {
    date: favorite.date ?? today,
    title: favorite.title,
    description: favorite.description,
    imageUrl: favoriteImageUrl(favorite.imagePath),
    favoriteId: favorite.id,
    localImage: favorite.source === "local",
  };
}

export function matchingFavorite(favorites: Favorite[], wallpaper: Wallpaper | null): Favorite | undefined {
  if (!wallpaper) return undefined;
  return favorites.find((favorite) => favorite.id === wallpaper.favoriteId || favorite.sourceUrl === wallpaper.imageUrl);
}

export function isFavoriteMode(mode: Settings["wallpaperMode"]): boolean {
  return mode === "favoritesSequential" || mode === "favoritesRandom";
}

export const FAVORITES_PAGE_SIZE = 30;

export function favoritePagination(count: number, requestedPage: number) {
  const totalPages = Math.max(1, Math.ceil(count / FAVORITES_PAGE_SIZE));
  const page = Math.max(1, Math.min(totalPages, Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1));
  const start = (page - 1) * FAVORITES_PAGE_SIZE;
  return { page, totalPages, start, end: Math.min(count, start + FAVORITES_PAGE_SIZE) };
}

export function parseFavoritePageInput(value: string, currentPage: number, totalPages: number): number {
  if (!/^\d+$/.test(value.trim())) return currentPage;
  return Math.max(1, Math.min(totalPages, Number(value.trim())));
}
