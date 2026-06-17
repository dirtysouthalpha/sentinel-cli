import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the store so the bootstrap wiring is hermetic.
const fakeStore = {
  kind: "fake",
  data: new Map<string, string>(),
  get: vi.fn(async (n: string): Promise<string | null> => fakeStore.data.get(n) ?? null),
  set: vi.fn(async (n: string, v: string): Promise<boolean> => {
    fakeStore.data.set(n, v);
    return true;
  }),
  delete: vi.fn(async (n: string): Promise<boolean> => fakeStore.data.delete(n)),
};
vi.mock("../src/core/secrets/store.js", () => ({
  getSecretStore: vi.fn(async () => fakeStore),
  _resetSecretStoreForTests: vi.fn(),
}));

// Stub ConfigManager.save so migration doesn't touch real disk.
vi.mock("../src/core/config.js", () => ({
  getConfigManager: () => ({ save: vi.fn(() => {}) }),
}));

import { primeEnvFromKeyring, migrateLegacyKeys, applyScrubMarker } from "../src/core/secrets/bootstrap.js";

const KEY_ENV = [
  "ZAI_API_KEY",
  "ZHIPU_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
];

describe("bootstrap: primeEnvFromKeyring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeStore.data.clear();
    for (const k of KEY_ENV) delete process.env[k];
  });

  it("sets process.env from the store for known providers", async () => {
    fakeStore.data.set("zai.apiKey", "stored-zai-key");
    await primeEnvFromKeyring({ zai: { options: {} } });
    expect(process.env.ZAI_API_KEY).toBe("stored-zai-key");
  });

  it("does NOT overwrite an env var already set (env wins)", async () => {
    process.env.ZAI_API_KEY = "env-owned";
    fakeStore.data.set("zai.apiKey", "stored-zai-key");
    await primeEnvFromKeyring({ zai: { options: {} } });
    expect(process.env.ZAI_API_KEY).toBe("env-owned");
  });

  it("ignores custom providers with no canonical env var", async () => {
    fakeStore.data.set("mycustom.apiKey", "x");
    await primeEnvFromKeyring({ mycustom: { options: {} } });
    // No env var name defined for "mycustom" -> nothing set.
    expect(fakeStore.get).not.toHaveBeenCalled();
  });

  it("survives a missing provider map", async () => {
    await expect(primeEnvFromKeyring({})).resolves.toBeUndefined();
    await expect(primeEnvFromKeyring(undefined as never)).resolves.toBeUndefined();
  });
});

describe("bootstrap: migrateLegacyKeys + applyScrubMarker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeStore.data.clear();
    for (const k of KEY_ENV) delete process.env[k];
  });

  it("moves plaintext into the store and returns names to scrub", async () => {
    const providers = {
      zai: { options: { apiKey: "plain-zai" } },
      openai: { options: { apiKey: "plain-openai" } },
    };
    const scrub = await migrateLegacyKeys(providers);
    expect(scrub.sort()).toEqual(["openai", "zai"]);
    expect(fakeStore.data.get("zai.apiKey")).toBe("plain-zai");
    expect(fakeStore.data.get("openai.apiKey")).toBe("plain-openai");
  });

  it("skips env-owned keys", async () => {
    process.env.ZAI_API_KEY = "env-owned";
    const scrub = await migrateLegacyKeys({
      zai: { options: { apiKey: "plain-zai" } },
      openai: { options: { apiKey: "plain-openai" } },
    });
    expect(scrub).toEqual(["openai"]);
    expect(fakeStore.data.has("zai.apiKey")).toBe(false);
  });

  it("is idempotent: re-running with the keyring:// marker is a no-op", async () => {
    // First run migrates.
    await migrateLegacyKeys({ zai: { options: { apiKey: "plain-zai" } } });
    // Simulate the scrubbed config the persistence layer would write.
    const scrubbed = { zai: { options: { apiKey: "keyring://zai" } } };
    const second = await migrateLegacyKeys(scrubbed);
    expect(second).toEqual([]);
  });

  it("applyScrubMarker rewrites plaintext to the marker in both shapes", () => {
    const providers: Record<string, unknown> = {
      zai: { options: { apiKey: "plain-zai" } },
      groq: { apiKey: "plain-groq" },
    };
    applyScrubMarker(providers, ["zai", "groq"]);
    expect((providers.zai as { options: { apiKey: string } }).options.apiKey).toBe("keyring://zai");
    expect((providers.groq as { apiKey: string }).apiKey).toBe("keyring://groq");
  });

  it("leaves providers with no key alone", async () => {
    const scrub = await migrateLegacyKeys({ ollama: { options: { baseURL: "http://x" } } });
    expect(scrub).toEqual([]);
  });
});
