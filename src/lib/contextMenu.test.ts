import { describe, expect, it } from "vitest";
import { allowsNativeTextMenu } from "./contextMenu";

describe("native context menu policy", () => {
  it("hides browser menus for images, buttons and empty areas", () => {
    expect(allowsNativeTextMenu(null)).toBe(false);
    for (const tagName of ["IMG", "BUTTON", "DIV", "SVG"]) {
      expect(allowsNativeTextMenu({ tagName })).toBe(false);
    }
  });
  it("preserves the page-number input and normal text fields", () => {
    expect(allowsNativeTextMenu({ tagName: "INPUT" })).toBe(true);
    for (const inputType of ["text", "search", "number", "email", "url", "tel", "password"]) {
      expect(allowsNativeTextMenu({ tagName: "input", inputType })).toBe(true);
    }
  });
  it("does not mistake switches or other controls for text inputs", () => {
    for (const inputType of ["checkbox", "radio", "range", "file", "color", "button", "hidden"]) {
      expect(allowsNativeTextMenu({ tagName: "input", inputType })).toBe(false);
    }
    expect(allowsNativeTextMenu({ tagName: "input", disabled: true })).toBe(false);
  });
  it("preserves text areas and editable text, but not contenteditable=false", () => {
    expect(allowsNativeTextMenu({ tagName: "textarea" })).toBe(true);
    expect(allowsNativeTextMenu({ tagName: "div", contentEditable: true })).toBe(true);
    expect(allowsNativeTextMenu({ tagName: "div", contentEditable: false })).toBe(false);
  });
});
