import { describe, it, expect } from "vitest";
import { hexToRGB, readAccentRGB } from "../gui/src/background-palette.js";

describe("hexToRGB — pure palette extraction", () => {
  it("parses a 6-digit hex", () => {
    expect(hexToRGB("#00D4FF")).toEqual([0, 212, 255]);
    expect(hexToRGB("00D4FF")).toEqual([0, 212, 255]);
  });
  it("parses a 3-digit hex", () => {
    expect(hexToRGB("#0DF")).toEqual([0, 221, 255]);
    expect(hexToRGB("f00")).toEqual([255, 0, 0]);
  });
  it("returns null for invalid input", () => {
    expect(hexToRGB("not-a-color")).toBeNull();
    expect(hexToRGB("#12")).toBeNull();
    expect(hexToRGB("")).toBeNull();
  });
});

describe("readAccentRGB — reads the live CSS var", () => {
  it("parses a 'r, g, b' accent-rgb string", () => {
    expect(readAccentRGB("59, 130, 246")).toEqual([59, 130, 246]);
    expect(readAccentRGB("0, 240, 255")).toEqual([0, 240, 255]);
  });
  it("falls back to a default when the string is malformed", () => {
    const fb = readAccentRGB("garbage");
    expect(fb).toEqual([59, 130, 246]); // the GUI's default blue accent
  });
  it("falls back when empty", () => {
    expect(readAccentRGB("")).toEqual([59, 130, 246]);
  });
});
