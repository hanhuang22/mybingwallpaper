import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addDays,
  addMonths,
  dateToApiKey,
  fetchMonthWallpapersInBrowser,
  parseTitle,
  randomDate,
  resolveMonthWallpapers,
  syncDateNavigation,
  withTodayFallback,
} from "./wallpaper";

describe("wallpaper helpers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("bypasses the browser cache when a month is explicitly retried", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    await fetchMonthWallpapersInBrowser("2026-09", true);
    expect(fetchMock).toHaveBeenCalledWith("/archive/month/202609.json", { cache: "reload" });
  });

  it("shows a live today record only until the month JSON contains one", () => {
    const yesterday = { date: "2026-09-29", title: "昨日", description: "", imageUrl: "https://cn.bing.com/yesterday.jpg" };
    const live = { date: "2026-09-30", title: "Bing 今日", description: "", imageUrl: "https://cn.bing.com/live.jpg" };
    const archived = { ...live, title: "OSS 今日", imageUrl: "https://cn.bing.com/archive.jpg" };
    expect(withTodayFallback([yesterday], live.date, live)).toEqual([yesterday, live]);
    expect(withTodayFallback([yesterday, archived], live.date, live)).toEqual([yesterday, archived]);
    expect(withTodayFallback([yesterday], "2026-10-01", live)).toEqual([yesterday]);
  });

  it("only fetches Bing for a missing date in the current month", async () => {
    const live = { date: "2026-09-30", title: "Bing 今日", description: "", imageUrl: "https://cn.bing.com/live.jpg" };
    const archived = { ...live, title: "OSS 今日" };
    const fetchToday = vi.fn().mockResolvedValue(live);
    expect(await resolveMonthWallpapers("2026-09", live.date, [archived], null, fetchToday)).toEqual([archived]);
    expect(await resolveMonthWallpapers("2026-08", live.date, [], null, fetchToday)).toEqual([]);
    expect(fetchToday).not.toHaveBeenCalled();
    expect(await resolveMonthWallpapers("2026-09", live.date, [], live, fetchToday)).toEqual([live]);
    expect(fetchToday).not.toHaveBeenCalled();
    expect(await resolveMonthWallpapers("2026-09", live.date, [], null, fetchToday)).toEqual([live]);
    expect(fetchToday).toHaveBeenCalledOnce();
    fetchToday.mockRejectedValue(new Error("Bing 不可用"));
    expect(await resolveMonthWallpapers("2026-09", live.date, [], null, fetchToday)).toEqual([]);
  });

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
    expect(addMonths("2026-01", 1)).toBe("2026-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
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
