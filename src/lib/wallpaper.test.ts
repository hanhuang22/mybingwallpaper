import { describe, expect, it } from "vitest";
import {
  addDays,
  dateToApiKey,
  parseTitle,
  randomDate,
  syncDateNavigation,
} from "./wallpaper";

describe("wallpaper helpers", () => {
  it("converts a UI date to the archive key", () => {
    expect(dateToApiKey("2026-09-20")).toBe("20260920");
  });

  it("separates the headline and attribution", () => {
    expect(parseTitle("宁静之海 | 摄影师/Getty Images - 2026/09/20")).toEqual({
      headline: "宁静之海",
      attribution: "摄影师/Getty Images",
    });
  });

  it("moves across month boundaries safely", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("keeps random dates inside the requested interval", () => {
    for (let index = 0; index < 20; index += 1) {
      const value = randomDate("2026-01-01", "2026-01-03");
      expect(value >= "2026-01-01" && value <= "2026-01-03").toBe(true);
    }
  });

  it("advances the selected date when the app crosses midnight on today", () => {
    expect(syncDateNavigation({
      today: "2026-09-20",
      selectedDate: "2026-09-20",
    }, "2026-09-21")).toEqual({
      today: "2026-09-21",
      selectedDate: "2026-09-21",
    });
  });

  it("keeps a historical selection while extending the date range", () => {
    expect(syncDateNavigation({
      today: "2026-09-20",
      selectedDate: "2026-09-18",
    }, "2026-09-21")).toEqual({
      today: "2026-09-21",
      selectedDate: "2026-09-18",
    });
  });
});
