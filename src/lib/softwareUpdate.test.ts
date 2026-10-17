import { expect, test } from "vitest";
import { softwareUpdatePercent } from "./softwareUpdate";

test("switching mirrors clears the previous download percentage", () => {
  expect(softwareUpdatePercent({ source: "Gitee", downloaded: 80, total: 100 })).toBe(80);
  expect(softwareUpdatePercent({ source: "GitHub", downloaded: 0, total: null })).toBeNull();
  expect(softwareUpdatePercent({ source: "GitHub", downloaded: 1, total: 100 })).toBe(1);
});

test("missing or invalid sizes do not show a stale percentage", () => {
  for (const total of [undefined, null, 0, -1, Infinity, NaN]) {
    expect(softwareUpdatePercent({ source: "GitHub", downloaded: 20, total })).toBeNull();
  }
  expect(softwareUpdatePercent({ source: "Gitee", downloaded: NaN, total: 100 })).toBeNull();
});

test("download percentage is rounded and constrained to 0–100", () => {
  expect(softwareUpdatePercent({ source: "GitHub", downloaded: 1, total: 3 })).toBe(33);
  expect(softwareUpdatePercent({ source: "GitHub", downloaded: -1, total: 100 })).toBe(0);
  expect(softwareUpdatePercent({ source: "GitHub", downloaded: 200, total: 100 })).toBe(100);
});
