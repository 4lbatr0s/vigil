import { describe, expect, it } from "vitest";
import { isFocusShortcut } from "./focus-mode";

const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });

describe("focus mode shortcut", () => {
  it("is Cmd or Ctrl with Shift and F", () => {
    expect(isFocusShortcut(key("F", { metaKey: true, shiftKey: true }))).toBe(true);
    expect(isFocusShortcut(key("f", { ctrlKey: true, shiftKey: true }))).toBe(true);
  });

  it("is not plain F, Cmd F (find) or Cmd Alt Shift F", () => {
    expect(isFocusShortcut(key("f"))).toBe(false);
    expect(isFocusShortcut(key("f", { metaKey: true }))).toBe(false);
    expect(isFocusShortcut(key("f", { metaKey: true, shiftKey: true, altKey: true }))).toBe(false);
  });
});
