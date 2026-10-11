import { describe, expect, it } from "vitest";
import { FAVORITES_PAGE_SIZE, favoritePagination, parseFavoritePageInput } from "./favorites";

describe("favorites pagination", () => {
  it("limits each page to 30 items", () => {
    expect(FAVORITES_PAGE_SIZE).toBe(30);
    expect(favoritePagination(65, 2)).toEqual({ page: 2, totalPages: 3, start: 30, end: 60 });
    expect(favoritePagination(65, 3)).toEqual({ page: 3, totalPages: 3, start: 60, end: 65 });
  });
  it("handles empty, exact and overflow pages", () => {
    expect(favoritePagination(0, 1)).toEqual({ page: 1, totalPages: 1, start: 0, end: 0 });
    expect(favoritePagination(30, 2).page).toBe(1);
    expect(favoritePagination(31, 2).end).toBe(31);
    expect(favoritePagination(31, -1).page).toBe(1);
    expect(favoritePagination(31, NaN).page).toBe(1);
  });
  it("clamps the page after removing the final item on the last page", () => {
    expect(favoritePagination(60, 3)).toEqual({ page: 2, totalPages: 2, start: 30, end: 60 });
  });
  it("supports typed page jumps and gracefully handles invalid input", () => {
    expect(parseFavoritePageInput("3", 1, 4)).toBe(3);
    expect(parseFavoritePageInput("999", 1, 4)).toBe(4);
    expect(parseFavoritePageInput("0", 2, 4)).toBe(1);
    expect(parseFavoritePageInput("", 2, 4)).toBe(2);
    expect(parseFavoritePageInput("oops", 2, 4)).toBe(2);
    expect(parseFavoritePageInput("1.5", 2, 4)).toBe(2);
  });
});
