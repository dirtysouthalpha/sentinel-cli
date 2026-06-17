import { describe, it, expect, vi } from "vitest";

// Mock dns/promises so assertSafeUrl's hostname resolution is hermetic and
// deterministic — no real network. Each test seeds the lookup map it needs.
vi.mock("dns/promises", () => ({
  lookup: vi.fn(async (host: string) => {
    const map: Record<string, string> = {
      "example.com": "93.184.216.34",
      "internal.example.com": "10.0.0.5",
      "meta.example.com": "169.254.169.254",
    };
    const addr = map[host];
    if (!addr) throw new Error(`ENOTFOUND ${host}`);
    return [{ address: addr }];
  }),
}));

import { isBlockedIp, assertSafeUrl } from "../src/tools/url-safety.js";

describe("isBlockedIp (SSRF IP ranges)", () => {
  it("blocks loopback / private / link-local / CGNAT / reserved IPv4", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true); // loopback
    expect(isBlockedIp("10.0.0.1")).toBe(true); // private 10/8
    expect(isBlockedIp("172.16.0.1")).toBe(true); // private 172.16/12
    expect(isBlockedIp("172.31.255.255")).toBe(true); // edge of 172.16/12
    expect(isBlockedIp("192.168.1.1")).toBe(true); // private 192.168/16
    expect(isBlockedIp("169.254.169.254")).toBe(true); // link-local + cloud metadata
    expect(isBlockedIp("100.64.0.1")).toBe(true); // CGNAT
    expect(isBlockedIp("224.0.0.1")).toBe(true); // multicast
    expect(isBlockedIp("0.0.0.0")).toBe(true); // this-host
  });

  it("blocks IPv6 loopback / link-local / unique-local", () => {
    expect(isBlockedIp("::1")).toBe(true); // loopback
    expect(isBlockedIp("::")).toBe(true); // unspecified
    expect(isBlockedIp("fe80::1")).toBe(true); // link-local
    expect(isBlockedIp("fc00::1")).toBe(true); // unique-local
    expect(isBlockedIp("fd12:3456::1")).toBe(true); // unique-local
  });

  it("blocks IPv4-mapped IPv6 by unwrapping", () => {
    expect(isBlockedIp("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedIp("::ffff:10.0.0.1")).toBe(true);
  });

  it("allows public addresses", () => {
    expect(isBlockedIp("93.184.216.34")).toBe(false); // example.com
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false); // public IPv6
  });

  it("rejects non-IP strings without throwing", () => {
    expect(isBlockedIp("not-an-ip")).toBe(false);
    expect(isBlockedIp("example.com")).toBe(false);
  });
});

describe("assertSafeUrl", () => {
  it("rejects non-http(s) schemes (file/data/gopher)", async () => {
    await expect(assertSafeUrl("file:///etc/passwd")).rejects.toThrow(/Blocked URL scheme/);
    await expect(assertSafeUrl("data:text/html,<h1>x</h1>")).rejects.toThrow(/Blocked URL scheme/);
    await expect(assertSafeUrl("gopher://evil/")).rejects.toThrow(/Blocked URL scheme/);
  });

  it("rejects localhost by name", async () => {
    await expect(assertSafeUrl("http://localhost/admin")).rejects.toThrow(/localhost/i);
    await expect(assertSafeUrl("http://LocalHost:8080/")).rejects.toThrow(/localhost/i);
  });

  it("rejects a private/link-local/metadata literal IP", async () => {
    await expect(assertSafeUrl("http://10.0.0.1/")).rejects.toThrow(/private\/reserved/);
    await expect(assertSafeUrl("http://192.168.1.1/")).rejects.toThrow(/private\/reserved/);
    // The headline case: cloud metadata endpoint. web.ts blocked this; browser.ts
    // used to navigate here freely.
    await expect(assertSafeUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      /private\/reserved/
    );
    await expect(assertSafeUrl("http://[::1]/")).rejects.toThrow(/private\/reserved/);
  });

  it("rejects a hostname that resolves to a private/metadata address (DNS rebinding)", async () => {
    await expect(assertSafeUrl("http://internal.example.com/")).rejects.toThrow(/resolves to private/);
    await expect(assertSafeUrl("http://meta.example.com/latest/meta-data")).rejects.toThrow(
      /resolves to private/
    );
  });

  it("rejects malformed URLs", async () => {
    await expect(assertSafeUrl("not a url")).rejects.toThrow(/Invalid URL/);
    await expect(assertSafeUrl("://no-scheme")).rejects.toThrow(/Invalid URL/);
  });

  it("resolves and returns a public http(s) URL", async () => {
    const u = await assertSafeUrl("https://example.com/path?q=1");
    expect(u.protocol).toBe("https:");
    expect(u.hostname).toBe("example.com");
  });
});
