import { describe, it, expect } from "vitest";
import {
  resolvePonytailSection,
  normalizePonytailConfig,
  DEFAULT_PONYTAIL,
  type PonytailConfig,
} from "../src/core/ponytail.js";

const BODY = "You are a lazy senior developer.\n\n## The ladder\n1. YAGNI\n2. stdlib\n";

describe("normalizePonytailConfig — what survives a bad config", () => {
  it("returns the default (ultra, on) for undefined", () => {
    expect(normalizePonytailConfig(undefined)).toEqual(DEFAULT_PONYTAIL);
    expect(DEFAULT_PONYTAIL).toEqual({ enabled: true, level: "ultra" });
  });

  it("returns the default for null / primitives", () => {
    expect(normalizePonytailConfig(null)).toEqual(DEFAULT_PONYTAIL);
    expect(normalizePonytailConfig("ultra")).toEqual(DEFAULT_PONYTAIL);
    expect(normalizePonytailConfig(42)).toEqual(DEFAULT_PONYTAIL);
  });

  it("preserves a well-formed config", () => {
    expect(normalizePonytailConfig({ enabled: false, level: "lite" })).toEqual({
      enabled: false,
      level: "lite",
    });
  });

  it("fills missing fields with defaults (default level = ultra)", () => {
    expect(normalizePonytailConfig({})).toEqual({ enabled: true, level: "ultra" });
    expect(normalizePonytailConfig({ level: "full" })).toEqual({ enabled: true, level: "full" });
    expect(normalizePonytailConfig({ enabled: true })).toEqual({ enabled: true, level: "ultra" });
  });

  it("rejects an invalid level and falls back to ultra", () => {
    expect(normalizePonytailConfig({ enabled: true, level: "extreme" })).toEqual({
      enabled: true,
      level: "ultra",
    });
    expect(normalizePonytailConfig({ enabled: true, level: 3 })).toEqual({
      enabled: true,
      level: "ultra",
    });
  });

  it("rejects a non-boolean enabled and falls back to true", () => {
    expect(normalizePonytailConfig({ enabled: "yes", level: "lite" })).toEqual({
      enabled: true,
      level: "lite",
    });
  });
});

describe("resolvePonytailSection — what gets injected", () => {
  it("returns null when disabled, even with a valid body", () => {
    const cfg: PonytailConfig = { enabled: false, level: "ultra" };
    expect(resolvePonytailSection(cfg, BODY)).toBeNull();
  });

  it("returns null when the skill body is missing", () => {
    const cfg: PonytailConfig = { enabled: true, level: "ultra" };
    expect(resolvePonytailSection(cfg, undefined)).toBeNull();
    expect(resolvePonytailSection(cfg, "")).toBeNull();
    expect(resolvePonytailSection(cfg, "   \n  ")).toBeNull();
  });

  it("injects the body with an ALWAYS-ON header naming the level", () => {
    const section = resolvePonytailSection({ enabled: true, level: "ultra" }, BODY);
    expect(section).not.toBeNull();
    expect(section!).toContain("ALWAYS ON");
    expect(section!).toContain("level: ultra");
    expect(section!).toContain("You are a lazy senior developer.");
    expect(section!).toContain("The ladder");
  });

  it("reflects the chosen level in the header and the active-line", () => {
    const lite = resolvePonytailSection({ enabled: true, level: "lite" }, BODY)!;
    expect(lite).toContain("level: lite");
    expect(lite).toContain("Active level is **lite**");

    const full = resolvePonytailSection({ enabled: true, level: "full" }, BODY)!;
    expect(full).toContain("level: full");
    expect(full).toContain("Active level is **full**");
  });

  it("trims surrounding whitespace from the body", () => {
    const section = resolvePonytailSection(
      { enabled: true, level: "ultra" },
      "\n\n  " + BODY + "  \n\n"
    )!;
    // No leading newlines between the header block and the body content.
    expect(section).not.toMatch(/\n\n\n/);
    expect(section).toContain("You are a lazy senior developer.");
  });
});
