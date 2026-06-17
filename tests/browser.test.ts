import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Mock puppeteer so no real Chromium is launched. Tests override `launchImpl`
// to script browser/page behavior. `vi.doMock` (not `vi.mock`) so we can vary
// the mock per-test and pair it with vi.resetModules() — needed because the
// browser tool holds module-level `cachedBrowser`/`currentPage` singletons that
// would otherwise leak across tests.

const fakePage = {
  goto: vi.fn(() => Promise.resolve()),
  title: vi.fn(() => Promise.resolve("Title")),
  click: vi.fn(() => Promise.resolve()),
  type: vi.fn(() => Promise.resolve()),
  screenshot: vi.fn(() => Promise.resolve()),
  waitForSelector: vi.fn(() => Promise.resolve()),
  evaluate: vi.fn(() => Promise.resolve("body text")),
  evaluateOnNewDocument: vi.fn(() => Promise.resolve()),
  content: vi.fn(() => Promise.resolve("<html></html>")),
  bringToFront: vi.fn(() => Promise.resolve()),
};

// Default launch returns a browser whose pages() has one page.
let launchImpl: () => Promise<unknown> = () =>
  Promise.resolve({
    newPage: () => Promise.resolve({ ...fakePage }),
    pages: () => Promise.resolve([{ ...fakePage }]),
    close: () => Promise.resolve(),
  });

async function freshTool(projectRoot: string) {
  vi.resetModules();
  vi.doMock("puppeteer", () => ({
    default: { launch: () => launchImpl() },
    launch: () => launchImpl(),
  }));
  const mod = await import("../src/tools/browser.js");
  return mod.createBrowserTool(projectRoot);
}

describe("browser tool hardening (S5)", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "sentinel-browser-"));
    vi.clearAllMocks();
    launchImpl = () =>
      Promise.resolve({
        newPage: () => Promise.resolve({ ...fakePage }),
        pages: () => Promise.resolve([{ ...fakePage }]),
        close: () => Promise.resolve(),
      });
  });

  it("rejects a file:// navigation before touching the browser (SSRF guard)", async () => {
    const tool = await freshTool(projectRoot);
    const res = await tool.execute({ action: "navigate", url: "file:///etc/passwd" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Blocked URL scheme|Invalid URL/);
  });

  it("rejects the cloud metadata IP on navigate", async () => {
    const tool = await freshTool(projectRoot);
    const res = await tool.execute({
      action: "navigate",
      url: "http://169.254.169.254/latest/meta-data/iam/",
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/private\/reserved/);
  });

  it("rejects the metadata IP on scrape too", async () => {
    const tool = await freshTool(projectRoot);
    const res = await tool.execute({ action: "scrape", url: "http://169.254.169.254/" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/private\/reserved/);
  });

  it("contains screenshot paths to the project root", async () => {
    const tool = await freshTool(projectRoot);
    await tool.execute({ action: "new" });
    const escape = await tool.execute({
      action: "screenshot",
      filePath: "../../../tmp/evil.png",
    });
    expect(escape.success).toBe(false);
    expect(escape.error).toMatch(/escapes project root/);
  });

  it("allows a screenshot inside the project root", async () => {
    const tool = await freshTool(projectRoot);
    await tool.execute({ action: "new" });
    const ok = await tool.execute({ action: "screenshot", filePath: "shot.png" });
    expect(ok.success).toBe(true);
  });

  it("returns a clear error when an action runs with no open page", async () => {
    launchImpl = () =>
      Promise.resolve({
        newPage: () => Promise.resolve({ ...fakePage }),
        pages: () => Promise.resolve([]),
        close: () => Promise.resolve(),
      });
    const tool = await freshTool(projectRoot);
    const res = await tool.execute({ action: "click", selector: "#x" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/No open page/);
  });

  it("navigating sets the current page so a follow-up click targets it (wrong-page fix)", async () => {
    const navPage = { ...fakePage, click: vi.fn(() => Promise.resolve()) };
    launchImpl = () =>
      Promise.resolve({
        // newPage returns a distinct object; the blank [0] page also exists.
        newPage: () => Promise.resolve(navPage),
        pages: () => Promise.resolve([{ ...fakePage, click: vi.fn(() => Promise.resolve()) }]),
        close: () => Promise.resolve(),
      });
    const tool = await freshTool(projectRoot);
    await tool.execute({ action: "navigate", url: "https://example.com/" });
    await tool.execute({ action: "click", selector: "#go" });
    // The click landed on the page navigate created, not a freshly-fetched [0].
    expect(navPage.click).toHaveBeenCalledWith("#go");
  });
});
