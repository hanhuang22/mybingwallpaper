import { describe, expect, it } from "vitest";
import { thumbnailUrl } from "./thumbnail";

describe("thumbnailUrl", () => {
  it("requests a small image from Bing without changing its image id", () => {
    const source = "https://cn.bing.com/th?id=OHR.DecoCrab_ZH-CN0973306994_UHD.jpg";
    const thumbnail = new URL(thumbnailUrl(source));
    expect(thumbnail.searchParams.get("id")).toBe("OHR.DecoCrab_ZH-CN0973306994_UHD.jpg");
    expect(thumbnail.searchParams.get("w")).toBe("320");
    expect(thumbnail.searchParams.get("h")).toBe("180");
  });

  it("replaces existing size parameters", () => {
    const thumbnail = new URL(thumbnailUrl("https://www.bing.com/th?id=test&w=1920&h=1080"));
    expect(thumbnail.searchParams.getAll("w")).toEqual(["320"]);
    expect(thumbnail.searchParams.getAll("h")).toEqual(["180"]);
  });

  it("does not pretend older archive hosts support resizing", () => {
    const source = "https://bing.ee123.net/img/cn/fhd/2010/01/01.jpg";
    expect(thumbnailUrl(source)).toBe(source);
  });

  it("does not add parameters to unrelated sources", () => {
    const source = "https://bing.com.evil.test/th?id=test";
    expect(thumbnailUrl(source)).toBe(source);
  });
});
