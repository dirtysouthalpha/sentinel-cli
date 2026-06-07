import { describe, it, expect } from "vitest";
import { COMMAND_CATALOG, searchCatalog, type PaletteCommand } from "../src/core/command-catalog.js";

describe("command-catalog", () => {
  it("catalog is non-empty and well-formed", () => {
    expect(COMMAND_CATALOG.length).toBeGreaterThan(0);
    for (const entry of COMMAND_CATALOG) {
      expect(typeof entry.command).toBe("string");
      expect(entry.command.startsWith("/")).toBe(true);
      expect(entry.command.length).toBeGreaterThan(1);
      expect(typeof entry.description).toBe("string");
      expect(entry.description.length).toBeGreaterThan(0);
    }
    // command display forms are unique
    const names = COMMAND_CATALOG.map((c) => c.command);
    expect(new Set(names).size).toBe(names.length);
  });

  it("searchCatalog('plan') ranks /plan first", () => {
    const results = searchCatalog("plan");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].command).toBe("/plan");
  });

  it("empty query returns the full catalog in original order", () => {
    const results = searchCatalog("");
    expect(results.map((c) => c.command)).toEqual(COMMAND_CATALOG.map((c) => c.command));
    // whitespace-only behaves the same
    expect(searchCatalog("   ").map((c) => c.command)).toEqual(
      COMMAND_CATALOG.map((c) => c.command),
    );
  });

  it("a no-match query returns []", () => {
    expect(searchCatalog("zzqqxx")).toEqual([]);
  });

  it("searches a custom catalog when provided", () => {
    const custom: PaletteCommand[] = [
      { command: "/alpha", description: "first" },
      { command: "/beta", description: "second" },
    ];
    const results = searchCatalog("beta", custom);
    expect(results.length).toBe(1);
    expect(results[0].command).toBe("/beta");
  });
});
