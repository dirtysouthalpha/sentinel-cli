import { ToolDef, ToolResult } from "./types.js";
import { launch, Browser, Page } from "puppeteer";
import { createLogger } from "../utils/logger.js";

const log = createLogger({ prefix: "tools:browser" });

let cachedBrowser: Browser | null = null;
let exitHookInstalled = false;

async function getBrowser(): Promise<Browser> {
  if (!cachedBrowser) {
    cachedBrowser = await launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    // Kill the headless Chromium on process exit so it isn't orphaned when the
    // session ends without an explicit `close` (mirrors the LSP exit hook).
    if (!exitHookInstalled) {
      exitHookInstalled = true;
      const kill = () => {
        try { cachedBrowser?.process()?.kill(); } catch { /* already gone */ }
      };
      process.once("exit", kill);
      process.once("SIGINT", () => { kill(); process.exit(130); });
      process.once("SIGTERM", () => { kill(); process.exit(143); });
    }
  }
  return cachedBrowser;
}

export function createBrowserTool(): ToolDef {
  return {
    name: "browser",
    description: "Headless browser automation with Puppeteer",
    parameters: {
      action: { type: "string", description: "new|navigate|click|type|screenshot|close", required: true },
      url: { type: "string", description: "URL to navigate to (for navigate action)" },
      selector: { type: "string", description: "CSS selector for click/type actions" },
      text: { type: "string", description: "Text to type or extract" },
      filePath: { type: "string", description: "File path for screenshot" },
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
            const page = await browser.newPage();
            await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
            const title = await page.title();
            return { success: true, output: `Navigated to ${url} (title: ${title})` };
          }

          case "click": {
            const selector = args.selector as string;
            if (!selector) return { success: false, output: "", error: "Selector required" };
            const pages = await browser.pages();
            const page = pages[0];
            await page.click(selector);
            return { success: true, output: `Clicked on ${selector}` };
          }

          case "type": {
            const selector = args.selector as string;
            const text = args.text as string;
            if (!selector || !text) return { success: false, output: "", error: "Selector and text required" };
            const pages = await browser.pages();
            const page = pages[0];
            await page.type(selector, text);
            return { success: true, output: `Typed "${text}" into ${selector}` };
          }

          case "screenshot": {
            const filePath = (args.filePath as string) || "screenshot.png";
            const pages = await browser.pages();
            const page = pages[0];
            await page.screenshot({ path: filePath, fullPage: true });
            return { success: true, output: `Screenshot saved to ${filePath}` };
          }

          case "close": {
            await browser.close();
            cachedBrowser = null;
            return { success: true, output: "Browser closed" };
          }

          case "scrape": {
            const url = args.url as string;
            if (!url) return { success: false, output: "", error: "URL required" };
            const page = await browser.newPage();
            await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
            const content = await page.content();
            const title = await page.title();
            const text = await page.evaluate(`() => document.body?.innerText || ""`) as string;
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
            const pages = await browser.pages();
            const page = pages[0];
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
        return { success: false, output: "", error: String(err) };
      }
    },
  };
}