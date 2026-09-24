import { describe, expect, it } from "vitest";
import { buildCalendar } from "./calendar";
import { formatDateKey } from "./wallpaper";

describe("calendar grid", () => {
  it("does not add a full extra October week to September 2026", () => {
    const days = buildCalendar(new Date(2026, 8, 1, 12));
    expect(days).toHaveLength(35);
    expect(formatDateKey(days[0])).toBe("2026-08-31");
    expect(formatDateKey(days.at(-1)!)).toBe("2026-10-04");
  });

  it("supports months that fit in four or require six weeks", () => {
    expect(buildCalendar(new Date(2021, 1, 1, 12))).toHaveLength(28);
    expect(buildCalendar(new Date(2020, 7, 1, 12))).toHaveLength(42);
  });
});
