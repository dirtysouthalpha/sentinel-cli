import { describe, it, expect } from "vitest";
import { openBrowserCommand, createOpenUrlTool } from "../src/tools/open-url.js";

describe("openBrowserCommand (platform dispatch)", () => {
  it("uses xdg-open on Linux", () => {
    const r = openBrowserCommand("https://x.com", "linux");
    expect(r.cmd).toBe("xdg-open");
    expect(r.args).toEqual(["https://x.com"]);
  });
  it("uses open on macOS", () => {
    const r = openBrowserCommand("https://x.com", "darwin");
    expect(r.cmd).toBe("open");
    expect(r.args).toEqual(["https://x.com"]);
  });
  it("uses cmd /c start on Windows", () => {
    const r = openBrowserCommand("https://x.com", "win32");
    expect(r.cmd).toBe("cmd");
    expect(r.args).toEqual(["/c", "start", "", "https://x.com"]);
  });
});

describe("open_url tool URL safety", () => {
  it("rejects a missing url", async () => {
    const t = createOpenUrlTool();
    expect((await t.execute({})).success).toBe(false);
  });
  it("rejects non-http(s) schemes", async () => {
    const t = createOpenUrlTool();
    const fileRes = await t.execute({ url: "file:///etc/passwd" });
    expect(fileRes.success).toBe(false);
    expect(fileRes.error).toMatch(/non-http\(s\)/);
    const jsRes = await t.execute({ url: "javascript:alert(1)" });
    expect(jsRes.success).toBe(false);
  });
  it("accepts an https URL (and launches detached — returns optimistic success)", async () => {
    const t = createOpenUrlTool();
    // On a headless CI box xdg-open may be missing; the tool returns success
    // optimistically (the spawn error is async). We assert it doesn't throw and
    // reports the launch. Skip the launch assertion if no display server.
    const res = await t.execute({ url: "https://example.com" });
    expect(res.success).toBe(true);
    expect(res.output).toContain("example.com");
  });
});
