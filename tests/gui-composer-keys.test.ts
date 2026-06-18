import { describe, it, expect } from "vitest";
import { resolveKey } from "../gui/src/composer-keys.js";

// Minimal KeyboardEvent-shape — resolveKey reads only these fields.
function ke(key: string, mods: { meta?: boolean; ctrl?: boolean; shift?: boolean } = {}): {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
} {
  return {
    key,
    metaKey: !!mods.meta,
    ctrlKey: !!mods.ctrl,
    shiftKey: !!mods.shift,
  };
}

describe("resolveKey (GUI global keymap)", () => {
  it("maps Cmd/Ctrl+K to 'palette'", () => {
    expect(resolveKey(ke("k", { meta: true }))).toBe("palette");
    expect(resolveKey(ke("k", { ctrl: true }))).toBe("palette");
  });
  it("maps Cmd/Ctrl+F to 'search'", () => {
    expect(resolveKey(ke("f", { ctrl: true }))).toBe("search");
    expect(resolveKey(ke("f", { meta: true }))).toBe("search");
  });
  it("maps Cmd/Ctrl+L to 'focusComposer'", () => {
    expect(resolveKey(ke("l", { ctrl: true }))).toBe("focusComposer");
  });
  it("maps '?' (shift+/) to 'cheatsheet'", () => {
    expect(resolveKey(ke("?", { shift: true }))).toBe("cheatsheet");
  });
  it("returns null for unbound keys", () => {
    expect(resolveKey(ke("z"))).toBeNull();
    expect(resolveKey(ke("k"))).toBeNull(); // plain k, no modifier
  });
});
