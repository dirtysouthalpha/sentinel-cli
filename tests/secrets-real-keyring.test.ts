import { describe, it, expect } from "vitest";
import { randomBytes } from "crypto";

/**
 * Real (non-mocked) round-trip through whichever backend the platform picks.
 * On this Linux box that's the Secret Service (secret-tool + gnome-keyring),
 * so this proves the S1 plumbing genuinely stores/retrieves a key via the OS
 * keyring — not just the mock used in the other secrets tests.
 *
 * Uses a unique randomized key name so it can never collide with a real
 * provider key, and always cleans up.
 */
describe("secret store: real backend round-trip (no mock)", () => {
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
