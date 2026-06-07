import { describe, it, expect } from "vitest";
import { buildAbout } from "../src/core/about.js";

describe("buildAbout", () => {
  it("includes the product name and version", () => {
    const out = buildAbout("0.2.0");
    expect(out).toContain("Sentinel CLI");
    expect(out).toContain("v0.2.0");
  });

  it("reports the runtime", () => {
    const out = buildAbout("9.9.9");
    expect(out).toContain(process.version);
    expect(out).toContain(process.platform);
  });

  it("lists key features", () => {
    const out = buildAbout("0.2.0");
    for (const feat of ["MCP", "workflows", "pipeline", "sessions", "vision"]) {
      expect(out).toContain(feat);
    }
  });
});
