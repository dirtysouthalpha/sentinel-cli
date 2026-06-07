import { describe, it, expect, vi } from "vitest";
import { route, runWithRouter, RouterConfig } from "../src/ai/router.js";
import { ProviderError } from "../src/ai/errors.js";
import { ChatResponse } from "../src/ai/types.js";

function makeResponse(model: string): ChatResponse {
  return { content: "ok", model };
}

const baseRetry: NonNullable<RouterConfig["retry"]> = {
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 1000,
  retryOn: [429, 503],
};

describe("route", () => {
  it("selects the first matching rule (top-down)", () => {
    const cfg: RouterConfig = {
      default: "anthropic/claude",
      rules: [
        { match: { taskKind: "code" }, use: "openai/gpt-code" },
        { match: { taskKind: "code", requiresTools: true }, use: "zai/glm" },
      ],
    };
    const chain = route(cfg, { taskKind: "code", requiresTools: true }, () => true);
    expect(chain).toEqual(["openai/gpt-code"]);
  });

  it("returns [use, ...fallbacks] when a rule matches", () => {
    const cfg: RouterConfig = {
      default: "anthropic/claude",
      rules: [
        { match: { agent: "planner" }, use: "openai/gpt", fallbacks: ["anthropic/claude", "zai/glm"] },
      ],
    };
    const chain = route(cfg, { agent: "planner" }, () => true);
    expect(chain).toEqual(["openai/gpt", "anthropic/claude", "zai/glm"]);
  });

  it("falls back to default when no rule matches", () => {
    const cfg: RouterConfig = {
      default: "anthropic/claude",
      rules: [{ match: { taskKind: "code" }, use: "openai/gpt" }],
    };
    const chain = route(cfg, { taskKind: "chat" }, () => true);
    expect(chain).toEqual(["anthropic/claude"]);
  });

  it("filters out unavailable targets", () => {
    const cfg: RouterConfig = {
      default: "anthropic/claude",
      rules: [
        { match: { taskKind: "code" }, use: "openai/gpt", fallbacks: ["zai/glm", "anthropic/claude"] },
      ],
    };
    const available = (t: string) => t !== "openai/gpt";
    const chain = route(cfg, { taskKind: "code" }, available);
    expect(chain).toEqual(["zai/glm", "anthropic/claude"]);
  });

  it("falls back to [default] when all targets are filtered out", () => {
    const cfg: RouterConfig = {
      default: "anthropic/claude",
      rules: [{ match: { taskKind: "code" }, use: "openai/gpt", fallbacks: ["zai/glm"] }],
    };
    const chain = route(cfg, { taskKind: "code" }, () => false);
    expect(chain).toEqual(["anthropic/claude"]);
  });

  it("respects minContextTokens matching", () => {
    const cfg: RouterConfig = {
      default: "anthropic/claude",
      rules: [{ match: { minContextTokens: 100000 }, use: "openai/big" }],
    };
    expect(route(cfg, { contextTokens: 50000 }, () => true)).toEqual(["anthropic/claude"]);
    expect(route(cfg, { contextTokens: 200000 }, () => true)).toEqual(["openai/big"]);
  });
});

describe("runWithRouter", () => {
  it("splits 'provider/model' into providerName and model", async () => {
    const call = vi.fn(async (provider: string, model: string | undefined) => {
      expect(provider).toBe("openai");
      expect(model).toBe("gpt-4o");
      return makeResponse(model!);
    });
    const res = await runWithRouter(["openai/gpt-4o"], call, {
      retry: baseRetry,
      firstChunkSeen: () => false,
    });
    expect(res.model).toBe("gpt-4o");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("passes undefined model when target has no slash", async () => {
    const call = vi.fn(async (provider: string, model: string | undefined) => {
      expect(provider).toBe("ollama");
      expect(model).toBeUndefined();
      return makeResponse("ollama");
    });
    await runWithRouter(["ollama"], call, { firstChunkSeen: () => false });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("falls back to next target on a non-retryable error", async () => {
    const call = vi.fn(async (provider: string) => {
      if (provider === "openai") {
        throw new ProviderError("bad request", 400, "openai");
      }
      return makeResponse("claude");
    });
    const sleep = vi.fn(async () => {});
    const res = await runWithRouter(["openai/gpt", "anthropic/claude"], call, {
      retry: baseRetry,
      firstChunkSeen: () => false,
      sleep,
    });
    expect(res.model).toBe("claude");
    // openai attempted once (non-retryable -> next target), then anthropic
    expect(call).toHaveBeenCalledTimes(2);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries on a retryable status using injected sleep (no real delay)", async () => {
    let calls = 0;
    const call = vi.fn(async () => {
      calls++;
      if (calls < 3) {
        throw new ProviderError("rate limited", 429, "openai");
      }
      return makeResponse("gpt");
    });
    const sleep = vi.fn(async () => {});
    const res = await runWithRouter(["openai/gpt"], call, {
      retry: baseRetry,
      firstChunkSeen: () => false,
      sleep,
    });
    expect(res.model).toBe("gpt");
    expect(call).toHaveBeenCalledTimes(3);
    // slept between the two failed attempts
    expect(sleep).toHaveBeenCalledTimes(2);
    // deterministic backoff: 100*2^0 + 25 = 125, then 100*2^1 + 25 = 225
    expect(sleep).toHaveBeenNthCalledWith(1, 125);
    expect(sleep).toHaveBeenNthCalledWith(2, 225);
  });

  it("does NOT retry once firstChunkSeen() returns true", async () => {
    const call = vi.fn(async () => {
      throw new ProviderError("rate limited", 429, "openai");
    });
    const sleep = vi.fn(async () => {});
    await expect(
      runWithRouter(["openai/gpt"], call, {
        retry: baseRetry,
        firstChunkSeen: () => true,
        sleep,
      })
    ).rejects.toBeInstanceOf(ProviderError);
    // streaming already produced output -> attempt once, no retry
    expect(call).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("throws the last error when all targets/attempts are exhausted", async () => {
    const call = vi.fn(async (provider: string) => {
      throw new ProviderError(`fail-${provider}`, 503, provider);
    });
    const sleep = vi.fn(async () => {});
    await expect(
      runWithRouter(["openai/gpt", "anthropic/claude"], call, {
        retry: { ...baseRetry, maxAttempts: 2 },
        firstChunkSeen: () => false,
        sleep,
      })
    ).rejects.toMatchObject({ message: "fail-anthropic" });
    // 2 attempts per target across 2 targets
    expect(call).toHaveBeenCalledTimes(4);
  });
});
