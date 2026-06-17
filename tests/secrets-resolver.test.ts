import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir, homedir } from "os";
import { join } from "path";

// Mock the store module so the resolver's keyring path is hermetic and
// injectable, while keeping the real env + legacy-plaintext logic under test.
const fakeStore = {
  kind: "fake",
  get: vi.fn(async (_n: string): Promise<string | null> => null),
  set: vi.fn(async (_n: string, _v: string): Promise<boolean> => true),
  delete: vi.fn(async (_n: string): Promise<boolean> => true),
};
vi.mock("../src/core/secrets/store.js", () => ({
  getSecretStore: vi.fn(async () => fakeStore),
  _resetSecretStoreForTests: vi.fn(),
}));

import { resolveProviderApiKey, migrateProviderKeysToStore, providerKeyName } from "../src/core/secrets/resolver.js";

const KEY_ENV = {
  ANTHROPIC_API_KEY: "",
  OPENAI_API_KEY: "",
  ZAI_API_KEY: "",
  ZHIPU_API_KEY: "",
  GEMINI_API_KEY: "",
  GOOGLE_API_KEY: "",
};

describe("resolveProviderApiKey (env-first)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clean env between tests.
    for (const k of Object.keys(KEY_ENV)) delete process.env[k];
  });

  it("prefers env over store and legacy", async () => {
    process.env.ZAI_API_KEY = "env-key";
    fakeStore.get.mockResolvedValue("store-key");
    const key = await resolveProviderApiKey("zai", "plaintext-key");
    expect(key).toBe("env-key");
    // Store not even consulted when env hit.
    expect(fakeStore.get).not.toHaveBeenCalled();
  });

  it("falls back to the secret store when env is absent", async () => {
    fakeStore.get.mockResolvedValue("store-key");
    const key = await resolveProviderApiKey("zai", "plaintext-key");
    expect(key).toBe("store-key");
    expect(fakeStore.get).toHaveBeenCalledWith(providerKeyName("zai"));
  });

  it("falls back to legacy plaintext when env + store are both empty", async () => {
    fakeStore.get.mockResolvedValue(null);
    const key = await resolveProviderApiKey("zai", "plaintext-key");
    expect(key).toBe("plaintext-key");
  });

  it("returns empty string when nothing is configured", async () => {
    fakeStore.get.mockResolvedValue(null);
    const key = await resolveProviderApiKey("zai");
    expect(key).toBe("");
  });

  it("honors ZAI/ZHIPU alias env vars", async () => {
    process.env.ZHIPU_API_KEY = "zhipu-key";
    const key = await resolveProviderApiKey("zai");
    expect(key).toBe("zhipu-key");
  });

  it("honors GEMINI/GOOGLE alias env vars", async () => {
    process.env.GOOGLE_API_KEY = "google-key";
    const key = await resolveProviderApiKey("gemini");
    expect(key).toBe("google-key");
  });

  it("trims whitespace from resolved keys", async () => {
    process.env.OPENAI_API_KEY = "  spaced-key  ";
    const key = await resolveProviderApiKey("openai");
    expect(key).toBe("spaced-key");
  });
});

describe("migrateProviderKeysToStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(KEY_ENV)) delete process.env[k];
  });

  it("moves plaintext keys into the store (nested options shape)", async () => {
    const providers = {
      zai: { options: { apiKey: "plain-zai" } },
      openai: { options: { apiKey: "plain-openai" } },
    };
    const migrated = await migrateProviderKeysToStore(providers);
    expect(migrated.sort()).toEqual(["openai", "zai"]);
    expect(fakeStore.set).toHaveBeenCalledWith("zai.apiKey", "plain-zai");
    expect(fakeStore.set).toHaveBeenCalledWith("openai.apiKey", "plain-openai");
  });

  it("also handles the flat { apiKey } shape", async () => {
    const migrated = await migrateProviderKeysToStore({ groq: { apiKey: "flat-key" } });
    expect(migrated).toEqual(["groq"]);
    expect(fakeStore.set).toHaveBeenCalledWith("groq.apiKey", "flat-key");
  });

  it("does NOT migrate keys that are present in env (env owns them)", async () => {
    process.env.ZAI_API_KEY = "env-owned";
    const migrated = await migrateProviderKeysToStore({
      zai: { options: { apiKey: "plain-zai" } },
      openai: { options: { apiKey: "plain-openai" } },
    });
    expect(migrated).toEqual(["openai"]); // zai skipped
    expect(fakeStore.set).not.toHaveBeenCalledWith("zai.apiKey", expect.anything());
  });

  it("scrubs plaintext when the store already has the key (store wins)", async () => {
    fakeStore.get.mockResolvedValueOnce("already-stored");
    const migrated = await migrateProviderKeysToStore({
      zai: { options: { apiKey: "plain-zai" } },
    });
    expect(migrated).toEqual(["zai"]);
    expect(fakeStore.set).not.toHaveBeenCalled(); // already present, no re-set
  });

  it("excludes providers with no key configured", async () => {
    const migrated = await migrateProviderKeysToStore({
      zai: { options: {} },
      openai: { options: { apiKey: "" } },
      ollama: { options: { baseURL: "http://x" } },
    });
    expect(migrated).toEqual([]);
    expect(fakeStore.set).not.toHaveBeenCalled();
  });

  it("returns [] for an empty provider map", async () => {
    expect(await migrateProviderKeysToStore({})).toEqual([]);
  });
});
