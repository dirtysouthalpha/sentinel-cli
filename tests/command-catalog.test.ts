import { describe, it, expect } from "vitest";
import { searchCatalog, type PaletteCommand } from "../src/core/command-catalog.js";

// The palette catalog is now derived from the command registry (see
// command-registry.test.ts for source-of-truth coverage). This file covers the
// generic fuzzy search over an explicitly-provided catalog.

const SAMPLE: PaletteCommand[] = [
  { command: "/plan", description: "Read-only research mode" },
  { command: "/palette", description: "Search the command palette" },
  { command: "/model", description: "Switch model" },
  { command: "/clear", description: "Clear chat history" },
];

describe("searchCatalog", () => {
  it("ranks an exact-ish match first", () => {
    const results = searchCatalog("plan", SAMPLE);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].command).toBe("/plan");
  });

  it("empty query returns the full catalog in original order", () => {
    expect(searchCatalog("", SAMPLE).map((c) => c.command)).toEqual(
      SAMPLE.map((c) => c.command)
    );
    // whitespace-only behaves the same
    expect(searchCatalog("   ", SAMPLE).map((c) => c.command)).toEqual(
      SAMPLE.map((c) => c.command)
    );
  });

  it("a no-match query returns []", () => {
    expect(searchCatalog("zzqqxx", SAMPLE)).toEqual([]);
  });

  it("filters to the matching subset", () => {
    const results = searchCatalog("model", SAMPLE);
    expect(results.map((c) => c.command)).toEqual(["/model"]);
  });
});
