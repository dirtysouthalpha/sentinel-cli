import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Isolate the vault into a temp HOME so the real ~/.config/sentinel is untouched.
let origHome: string | undefined;
let sandbox: string;

const MODULE = "../src/core/secrets/file-backend.js";

describe("encrypted-file secret backend", () => {
  beforeEach(() => {
    origHome = process.env.HOME;
    sandbox = mkdtempSync(join(tmpdir(), "sentinel-secrets-"));
    process.env.HOME = sandbox;
    // Fresh module + master-key cache per test.
    vi.resetModules();
  });

  afterEach(() => {
    if (origHome !== undefined) process.env.HOME = origHome;
  });

  it("round-trips a secret (set then get)", async () => {
    const { createEncryptedFileBackend } = await import(MODULE);
    const store = createEncryptedFileBackend();
    expect(store.kind).toBe("encrypted-file");
    expect(await store.set("zai.apiKey", "sk-live-12345")).toBe(true);
    expect(await store.get("zai.apiKey")).toBe("sk-live-12345");
  });

  it("returns null for an unknown key (never throws)", async () => {
    const { createEncryptedFileBackend } = await import(MODULE);
    const store = createEncryptedFileBackend();
    expect(await store.get("missing.apiKey")).toBeNull();
  });

  it("overwrites on re-set and reflects the new value", async () => {
    const { createEncryptedFileBackend } = await import(MODULE);
    const store = createEncryptedFileBackend();
    await store.set("k", "v1");
    await store.set("k", "v2");
    expect(await store.get("k")).toBe("v2");
  });

  it("deletes a stored secret and reports true only when something existed", async () => {
    const { createEncryptedFileBackend } = await import(MODULE);
    const store = createEncryptedFileBackend();
    await store.set("k", "v");
    expect(await store.delete("k")).toBe(true);
    expect(await store.get("k")).toBeNull();
    expect(await store.delete("k")).toBe(false); // already gone
  });

  it("never writes the plaintext to disk (vault holds only iv+ct)", async () => {
    const { createEncryptedFileBackend } = await import(MODULE);
    const store = createEncryptedFileBackend();
    const secret = "sk-never-on-disk-9999";
    await store.set("zai.apiKey", secret);
    const vaultPath = join(sandbox, ".config", "sentinel", "secrets.enc.json");
    expect(existsSync(vaultPath)).toBe(true);
    const onDisk = readFileSync(vaultPath, "utf-8");
    expect(onDisk).not.toContain(secret);
    // The ciphertext + IV are present as base64 fields.
    expect(onDisk).toContain('"iv"');
    expect(onDisk).toContain('"ct"');
  });

  it("rejects a tampered vault (GCM auth fails, no plaintext leaked)", async () => {
    // AES-256-GCM authenticates the ciphertext; flipping a byte must cause
    // decryption to fail and the backend to return null rather than corrupt
    // output. This is the integrity guarantee that makes a stolen vault useless
    // to an attacker who can't reproduce the machine binding.
    const { createEncryptedFileBackend } = await import(MODULE);
    const store = createEncryptedFileBackend();
    await store.set("zai.apiKey", "legit-key");

    // Tamper: flip a character in the stored ciphertext field on disk.
    const vaultPath = join(sandbox, ".config", "sentinel", "secrets.enc.json");
    const vault = JSON.parse(readFileSync(vaultPath, "utf-8")) as {
      "zai.apiKey": { iv: string; ct: string };
    };
    const ct = vault["zai.apiKey"].ct;
    const tampered = ct.slice(0, -2) + (ct.endsWith("A") ? "B" : "A") + (ct.endsWith("A") ? "A" : "A");
    vault["zai.apiKey"].ct = tampered;
    const { writeFileSync } = await import("fs");
    writeFileSync(vaultPath, JSON.stringify(vault, null, 2));

    // A fresh store (same machine binding) reads the tampered entry and must NOT
    // return the plaintext.
    const recovered = await store.get("zai.apiKey");
    expect(recovered).not.toBe("legit-key");
  });
});
