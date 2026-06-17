import { describe, it, expect } from "vitest";
import { isAllowedOrigin } from "../src/server/serve.js";

describe("WS origin allow-list (isAllowedOrigin)", () => {
  it("accepts loopback http origins on any port", () => {
    expect(isAllowedOrigin("http://127.0.0.1:5173")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:8080")).toBe(true);
    expect(isAllowedOrigin("http://localhost:3000")).toBe(true);
    expect(isAllowedOrigin("http://[::1]:5173")).toBe(true);
  });

  it("accepts Tauri webview origins", () => {
    expect(isAllowedOrigin("tauri://localhost")).toBe(true);
    expect(isAllowedOrigin("https://tauri.localhost")).toBe(true);
  });

  it("rejects external/non-loopback origins (CSRF-style cross-site WS)", () => {
    expect(isAllowedOrigin("http://evil.example.com")).toBe(false);
    expect(isAllowedOrigin("https://attacker.test:443")).toBe(false);
    expect(isAllowedOrigin("http://192.168.1.5:5173")).toBe(false); // private, not loopback
    expect(isAllowedOrigin("http://0.0.0.0:5173")).toBe(false);
  });

  it("rejects malformed origins", () => {
    expect(isAllowedOrigin("not a url")).toBe(false);
    expect(isAllowedOrigin("")).toBe(false);
  });
});
