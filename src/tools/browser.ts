import { resolve, sep } from "path";
import type { ToolDef, ToolResult } from "./types.js";
import { assertSafeUrl } from "./url-safety.js";
import { createLogger } from "../utils/logger.js";

// Puppeteer is a heavy dependency (ships Chromium). Import it lazily so the
// core CLI doesn't pay the load cost unless the browser tool is actually used,
// and a missing/broken puppeteer install degrades gracefully instead of
// crashing every CLI invocation.
type LaunchedBrowser = {
  newPage(): Promise<LaunchedPage>;
  pages(): Promise<LaunchedPage[]>;
  close(): Promise<void>;
};
type LaunchedPage = {
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  title(): Promise<string>;
  click(selector: string): Promise<unknown>;
  type(selector: string, text: string): Promise<unknown>;
  screenshot(opts: { path: string; fullPage?: boolean }): Promise<unknown>;
  waitForSelector(selector: string, opts?: { timeout?: number }): Promise<unknown>;
  evaluate(fn: string): Promise<unknown>;
  evaluateOnNewDocument(script: string): Promise<unknown>;
  content(): Promise<string>;
  bringToFront(): Promise<unknown>;
};

const log = createLogger({ prefix: "tools:browser" });

let cachedBrowser: LaunchedBrowser | null = null;
// The page actions (click/type/screenshot/waitFor) operate on. Previously every
// action grabbed browser.pages()[0] — but navigate/scrape/open call newPage(),
// so a navigate followed by click clicked on about:blank. Track the active page
// explicitly so the action targets the page the user navigated to.
let currentPage: LaunchedPage | null = null;

async function loadPuppeteer(): Promise<(opts: Record<string, unknown>) => Promise<LaunchedBrowser>> {
  // Dynamic import: if puppeteer isn't installed (e.g. an optional-dep setup),
  // throw a clear error instead of crashing module load.
  const mod = await import("puppeteer");
  return (mod.launch ?? mod.default?.launch) as (opts: Record<string, unknown>) => Promise<LaunchedBrowser>;
}

async function getBrowser(): Promise<LaunchedBrowser> {
  if (!cachedBrowser) {
    const launch = await loadPuppeteer();
    // NOTE: --no-sandbox is required to run headless Chromium as a non-root
    // user on most Linux CI without extra setup. This weakens Chromium's own
    // renderer sandbox, so the *process* should be further isolated at the OS
    // level (see the bash/browser sandbox work). Kept as the pragmatic default
    // so the tool works out of the box; revisit when an OS wrapper exists.
    cachedBrowser = await launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
  }
  return cachedBrowser;
}

/** Constrain a screenshot path to the project root (path-traversal guard). */
function safeScreenshotPath(filePath: string, projectRoot: string): string {
  const root = resolve(projectRoot);
  const resolved = resolve(root, filePath);
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new Error(`Screenshot path escapes project root: ${filePath}`);
  }
  return resolved;
}

export function createBrowserTool(projectRoot: string = process.cwd()): ToolDef {
  return {
    name: "browser",
    description: "Headless browser automation with Puppeteer (http/https URLs only)",
    parameters: {
      action: { type: "string", description: "new|navigate|click|type|screenshot|scrape|waitFor|close", required: true },
      url: { type: "string", description: "URL to navigate to (for navigate/scrape actions; http/https only)" },
      selector: { type: "string", description: "CSS selector for click/type/waitFor actions" },
      text: { type: "string", description: "Text to type" },
      filePath: { type: "string", description: "File path for screenshot (within project root)" },
      wait: { type: "number", description: "Wait time in ms" },
      stealth: { type: "boolean", description: "Use stealth mode (default: true)" },
    },
    execute: async (args): Promise<ToolResult> => {
      try {
        const action = args.action as string;
        const browser = await getBrowser();

        switch (action) {
          case "new": {
            const newPage = await browser.newPage();
            currentPage = newPage;
            if (args.stealth !== false) {
              await newPage.evaluateOnNewDocument(`
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                Object.defineProperty(navigator, 'userAgent', {
                  get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                });
              `);
            }
            return { success: true, output: `New page opened`, data: { pageId: Date.now() } };
          }

          case "navigate": {
            const url = args.url as string;
            if (!url) return { success: false, output: "", error: "URL required" };
            // SSRF guard: block file://, localhost, private/link-local IPs
            // (incl. 169.254.169.254 cloud metadata), and DNS-rebinding targets.
            // Reuse the same check the web tool enforces so the two can't drift.
            await assertSafeUrl(url);
            const page = await browser.newPage();
            currentPage = page;
            await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
            const title = await page.title();
            return { success: true, output: `Navigated to ${url} (title: ${title})` };
          }

          case "click": {
            const selector = args.selector as string;
            if (!selector) return { success: false, output: "", error: "Selector required" };
            const page = currentPage ?? (await browser.pages())[0];
            if (!page) return { success: false, output: "", error: "No open page; use navigate first" };
            await page.click(selector);
            return { success: true, output: `Clicked on ${selector}` };
          }

          case "type": {
            const selector = args.selector as string;
            const text = args.text as string;
            if (!selector || !text) return { success: false, output: "", error: "Selector and text required" };
            const page = currentPage ?? (await browser.pages())[0];
            if (!page) return { success: false, output: "", error: "No open page; use navigate first" };
            await page.type(selector, text);
            return { success: true, output: `Typed "${text}" into ${selector}` };
          }

          case "screenshot": {
            const filePath = safeScreenshotPath(
              (args.filePath as string) || "screenshot.png",
              projectRoot
            );
            const page = currentPage ?? (await browser.pages())[0];
            if (!page) return { success: false, output: "", error: "No open page; use navigate first" };
            await page.screenshot({ path: filePath, fullPage: true });
            return { success: true, output: `Screenshot saved to ${filePath}` };
          }

          case "close": {
            await browser.close();
            cachedBrowser = null;
            currentPage = null;
            return { success: true, output: "Browser closed" };
          }

          case "scrape": {
            const url = args.url as string;
            if (!url) return { success: false, output: "", error: "URL required" };
            await assertSafeUrl(url);
            const page = await browser.newPage();
            currentPage = page;
            await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
            const content = await page.content();
            const title = await page.title();
            const text = (await page.evaluate(`() => document.body?.innerText || ""`)) as string;
            return {
              success: true,
              output: `Scraped ${url}\nTitle: ${title}\nContent length: ${content.length} chars`,
              data: { url, title, text: text.slice(0, 5000) },
            };
          }

          case "waitFor": {
            const selector = args.selector as string;
            const timeout = (args.wait as number) || 5000;
            if (!selector) return { success: false, output: "", error: "Selector required" };
            const page = currentPage ?? (await browser.pages())[0];
            if (!page) return { success: false, output: "", error: "No open page; use navigate first" };
            try {
              await page.waitForSelector(selector, { timeout });
              return { success: true, output: `Found ${selector}` };
            } catch {
              return { success: false, output: "", error: `Timeout waiting for ${selector}` };
            }
          }

          default:
            return { success: false, output: "", error: `Unknown action: ${action}` };
        }
      } catch (err) {
        // Puppeteer not installed, or a navigation blocked by the SSRF guard,
        // or a path-traversal rejection — surface the message to the model.
        log.warn(`browser action failed: ${err instanceof Error ? err.message : String(err)}`);
        return { success: false, output: "", error: String(err) };
      }
    },
  };
}
