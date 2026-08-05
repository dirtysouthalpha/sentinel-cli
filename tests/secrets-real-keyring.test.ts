import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomBytes } from "crypto";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Real (non-mocked) round-trip through whichever backend the platform picks:
 * Secret Service on Linux, Keychain on macOS, DPAPI on Windows. This proves the
 * S1 plumbing genuinely stores and retrieves a key via the OS — not just the
 * mock used in the other secrets tests.
 *
 * Sandboxed through SENTINEL_CONFIG_DIR. The file-backed backends (DPAPI's
 * sidecar, and the encrypted-file fallback) otherwise write to the user's REAL
 * ~/.config/sentinel — measured on Windows 2026-08-05, this suite created
 * secrets.dpapi.json in the live vault. Only the sidecar's *location* moves;
 * DPAPI still does the actual encrypt/decrypt through PowerShell, so the test
 * stays honest about what it claims to prove.
 *
 * Uses a unique randomized key name so it can never collide with a real
 * provider key, and always cleans up.
 */
describe("secret store: real backend round-trip (no mock)", () => {
  let origConfigDir: string | undefined;

  beforeEach(() => {
    origConfigDir = process.env.SENTINEL_CONFIG_DIR;
    process.env.SENTINEL_CONFIG_DIR = mkdtempSync(join(tmpdir(), "sentinel-real-"));
    // The backends read the path at module load, so the sandbox only takes
    // effect on a fresh import.
    vi.resetModules();
  });

  afterEach(() => {
    if (origConfigDir === undefined) delete process.env.SENTINEL_CONFIG_DIR;
    else process.env.SENTINEL_CONFIG_DIR = origConfigDir;
  });

  it("stores, retrieves, and deletes a key via the platform backend", async () => {
    const { getSecretStore } = await import("../src/core/secrets/store.js");
    const store = await getSecretStore();
    const name = `test.${randomBytes(6).toString("hex")}`;
    const value = `sk-real-roundtrip-${randomBytes(6).toString("hex")}`;

    try {
      const setOk = await store.set(name, value);
      expect(setOk).toBe(true);

      const got = await store.get(name);
      expect(got).toBe(value);

      const delOk = await store.delete(name);
      expect(delOk).toBe(true);

      const after = await store.get(name);
      expect(after).toBeNull();
    } finally {
      // Ensure cleanup even if an assertion threw.
      await store.delete(name).catch(() => {});
    }
  });
});
