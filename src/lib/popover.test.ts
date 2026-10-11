import { describe, expect, it } from "vitest";
import { alignedPopover } from "./popover";

describe("panel-aligned popovers", () => {
  const bounds = { left: 42, right: 958, top: 62, bottom: 602 };
  it("aligns with the trigger's right edge", () => {
    expect(alignedPopover({ left: 700, right: 854, top: 80, bottom: 114 }, { width: 264, height: 210 }, bounds)).toEqual({ left: 590, top: 122, maxHeight: 540 });
  });
  it("never escapes the panel's left or right edge", () => {
    expect(alignedPopover({ left: 100, right: 200, top: 80, bottom: 114 }, { width: 264, height: 210 }, bounds).left).toBe(42);
    expect(alignedPopover({ left: 900, right: 1000, top: 80, bottom: 114 }, { width: 264, height: 210 }, bounds).left).toBe(694);
  });
  it("flips above when needed and constrains tall menus", () => {
    expect(alignedPopover({ left: 700, right: 854, top: 570, bottom: 604 }, { width: 264, height: 210 }, bounds).top).toBe(352);
    expect(alignedPopover({ left: 700, right: 854, top: 80, bottom: 114 }, { width: 264, height: 700 }, bounds)).toEqual({ left: 590, top: 62, maxHeight: 540 });
  });
});
