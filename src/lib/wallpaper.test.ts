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

  it("parses pre-February 2022 titles without a pipe separator", () => {
    expect(parseTitle(
      "睡在海滩上的竖琴海豹，纽约长岛 (© Vicki Jauron/Getty Images)  -  2022/01/01",
    )).toEqual({
      headline: "睡在海滩上的竖琴海豹，纽约长岛",
      attribution: "(© Vicki Jauron/Getty Images)",
    });
  });

  it("parses early archive credits whose copyright mark is at the end", () => {
    expect(parseTitle(
      "从“新”开始：新生的企鹅宝宝寄托新的希望(Thorsten Milse/Photolibrary ©) - 2010/01/01",
    )).toEqual({
      headline: "从“新”开始：新生的企鹅宝宝寄托新的希望",
      attribution: "(Thorsten Milse/Photolibrary ©)",
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
