import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, chmodSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { writeAtomicFileSync } from "../src/utils/atomic-write.js";

describe("writeAtomicFileSync", () => {
  it("writes the file content", () => {
    const dir = mkdtempSync(join(tmpdir(), "sentinel-atomic-"));
    const target = join(dir, "config.json");
    writeAtomicFileSync(target, JSON.stringify({ a: 1 }, null, 2));
    expect(JSON.parse(readFileSync(target, "utf-8"))).toEqual({ a: 1 });
  });

  it("leaves no temp files behind after a successful write", () => {
    const dir = mkdtempSync(join(tmpdir(), "sentinel-atomic-"));
    const target = join(dir, "config.json");
    writeAtomicFileSync(target, "hello");
    const leftover = readdirSync(dir).filter((f) => f.includes(".tmp"));
    expect(leftover).toEqual([]);
  });

  it("overwrites an existing file atomically (content replaced, not appended)", () => {
    const dir = mkdtempSync(join(tmpdir(), "sentinel-atomic-"));
    const target = join(dir, "config.json");
    writeFileSync(target, "OLD");
    writeAtomicFileSync(target, "NEW");
    expect(readFileSync(target, "utf-8")).toBe("NEW");
  });

  it("creates parent directories that don't exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "sentinel-atomic-"));
    const target = join(dir, "nested", "deep", "config.json");
    writeAtomicFileSync(target, "x");
    expect(readFileSync(target, "utf-8")).toBe("x");
  });

  it("does not corrupt the existing file when rename fails (target dir read-only)", () => {
    // Make the destination dir read-only so the temp write fails; the existing
    // file at the target must be untouched.
    const dir = mkdtempSync(join(tmpdir(), "sentinel-atomic-"));
    const target = join(dir, "config.json");
    writeFileSync(target, "PRECIOUS");
    // Lock the directory so no new temp file can be created inside it.
    chmodSync(dir, 0o500); // r-x for owner
    try {
      expect(() => writeAtomicFileSync(target, "OVERWRITE")).toThrow();
      // Original content intact.
      expect(readFileSync(target, "utf-8")).toBe("PRECIOUS");
    } finally {
      chmodSync(dir, 0o700); // restore so cleanup can run
    }
  });
});
