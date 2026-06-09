import { describe, it, expect } from "vitest";
import { redact, containsSecret } from "../src/core/redact.js";

describe("redact", () => {
  it("masks provider API keys but keeps a short prefix", () => {
    const out = redact("key is sk-abcd1234efgh5678ijkl here");
    expect(out).not.toContain("abcd1234efgh5678ijkl");
    expect(out).toContain("sk-a");
    expect(out).toMatch(/•/);
  });

  it("masks composio, github, aws, google, slack tokens", () => {
    expect(redact("ak_FNiQcRm2MH3asVQ1gAPX")).not.toContain("FNiQcRm2MH3asVQ1gAPX");
    expect(redact("uak_xUuNg3sudGE9S6udvstTdUnu7C")).not.toContain("xUuNg3sudGE9S6udvstTdUnu7C");
    expect(redact("ghp_abcdefghijklmnopqrstuvwxyz0123")).not.toContain("abcdefghijklmnopqrstuvwxyz0123");
    expect(redact("AKIAIOSFODNN7EXAMPLE")).not.toContain("IOSFODNN7EXAMPLE");
    expect(redact("AIzaSyA1234567890abcdefghijklmno")).not.toContain("SyA1234567890abcdefghijklmno");
    expect(redact("xoxb-12345-abcdef-XYZ")).not.toContain("abcdef-XYZ");
  });

  it("masks Bearer tokens", () => {
    const out = redact("Authorization: Bearer sentinel-api-b9e10cda1234");
    expect(out).toContain("Bearer sent");
    expect(out).not.toContain("b9e10cda1234");
  });

  it("masks KEY=value style assignments", () => {
    expect(redact('COMPOSIO_API_KEY=ak_secretvalue123')).not.toContain("secretvalue123");
    expect(redact('"token": "abcdef123456"')).not.toContain("abcdef123456");
    expect(redact("PASSWORD = hunter2hunter2")).not.toContain("hunter2hunter2");
  });

  it("leaves ordinary text untouched", () => {
    const text = "The quick brown fox runs npm test and reads file.ts";
    expect(redact(text)).toBe(text);
    expect(containsSecret(text)).toBe(false);
  });

  it("containsSecret detects credentials", () => {
    expect(containsSecret("sk-abcd1234efgh5678ijkl")).toBe(true);
    expect(containsSecret("just words")).toBe(false);
  });
});
