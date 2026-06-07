import { describe, it, expect } from "vitest";
import {
  parseSemver,
  isNewer,
  checkForUpdate,
} from "../src/core/update-check.js";

describe("parseSemver", () => {
  it("parses a plain x.y.z", () => {
    expect(parseSemver("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });
  it("tolerates a leading v", () => {
    expect(parseSemver("v0.2.0")).toEqual({ major: 0, minor: 2, patch: 0 });
  });
  it("ignores prerelease and build suffixes", () => {
    expect(parseSemver("v1.4.0-beta.2+sha")).toEqual({
      major: 1,
      minor: 4,
      patch: 0,
    });
  });
  it("returns null for garbage", () => {
    expect(parseSemver("nope")).toBeNull();
    expect(parseSemver("1.2")).toBeNull();
    expect(parseSemver("")).toBeNull();
  });
});

describe("isNewer", () => {
  it("compares core versions across each component", () => {
    expect(isNewer("1.0.0", "0.9.9")).toBe(true);
    expect(isNewer("0.3.0", "0.2.9")).toBe(true);
    expect(isNewer("0.2.1", "0.2.0")).toBe(true);
  });
  it("is false for equal and older", () => {
    expect(isNewer("0.2.0", "0.2.0")).toBe(false);
    expect(isNewer("0.1.0", "0.2.0")).toBe(false);
  });
  it("handles v-prefix and prerelease (core only)", () => {
    expect(isNewer("v0.3.0", "0.2.0")).toBe(true);
    // prerelease suffix is ignored → same core means not newer
    expect(isNewer("0.2.0-rc.1", "0.2.0")).toBe(false);
  });
  it("treats unparseable as not newer", () => {
    expect(isNewer("bad", "0.2.0")).toBe(false);
    expect(isNewer("0.2.0", "bad")).toBe(false);
  });
});

describe("checkForUpdate", () => {
  it("reports an available update when npm has a newer version", async () => {
    const r = await checkForUpdate("0.2.0", {
      fetchJson: async () => ({ version: "0.3.0" }),
    });
    expect(r).toEqual({
      current: "0.2.0",
      latest: "0.3.0",
      updateAvailable: true,
    });
  });

  it("reports no update when versions match", async () => {
    const r = await checkForUpdate("0.2.0", {
      fetchJson: async () => ({ version: "0.2.0" }),
    });
    expect(r.updateAvailable).toBe(false);
    expect(r.latest).toBe("0.2.0");
  });

  it("degrades safely on network error", async () => {
    const r = await checkForUpdate("0.2.0", {
      fetchJson: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    expect(r).toEqual({
      current: "0.2.0",
      latest: null,
      updateAvailable: false,
    });
  });

  it("degrades safely when payload lacks a version", async () => {
    const r = await checkForUpdate("0.2.0", {
      fetchJson: async () => ({}),
    });
    expect(r.latest).toBeNull();
    expect(r.updateAvailable).toBe(false);
  });
});
