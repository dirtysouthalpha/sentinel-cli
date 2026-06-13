import { ToolDef, ToolResult } from "./types.js";

/**
 * Lightweight HTML→text conversion so `format:text` returns readable content
 * instead of raw markup (which is noisy and ~3-5x the tokens). Not a full parser
 * — drops script/style/comments, turns block-level closes into newlines, strips
 * remaining tags, and decodes the common entities.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|header|footer)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * SSRF guard: block requests to loopback, private, and link-local (cloud
 * metadata) hosts. Covers IP literals and obvious local hostnames — not a
 * defense against DNS rebinding, but stops the common internal-fetch case.
 */
export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1" || h === "0.0.0.0") return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 0 || a === 127) return true;                 // this-host / loopback
    if (a === 10) return true;                             // private
    if (a === 192 && b === 168) return true;               // private
    if (a === 172 && b >= 16 && b <= 31) return true;      // private
    if (a === 169 && b === 254) return true;               // link-local + metadata
  }
  if (h.startsWith("fe80") || h.startsWith("fc") || h.startsWith("fd")) return true; // IPv6 LL/ULA
  return false;
}

/** Validate a URL for fetching; returns an error string or null if allowed. */
export function checkFetchUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `Invalid URL: ${url}`;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `Blocked scheme "${parsed.protocol}" — only http(s) is allowed.`;
  }
  if (isBlockedHost(parsed.hostname)) {
    return `Blocked host "${parsed.hostname}" (loopback/private/link-local). Use bash if you genuinely need a local request.`;
  }
  return null;
}

export function createWebTool(): ToolDef {
  return {
    name: "web",
    description: "Fetch content from URLs (docs, APIs, web pages)",
    parameters: {
      url: { type: "string", description: "URL to fetch", required: true },
      format: { type: "string", description: "Response format: text|json|html (text strips HTML to readable text)", default: "text" },
      headers: { type: "object", description: "Custom headers (JSON)" },
    },
    execute: async (args): Promise<ToolResult> => {
      const url = args.url as string;
      const format = (args.format as string) || "text";

      const blocked = checkFetchUrl(url);
      if (blocked) {
        return { success: false, output: "", error: blocked };
      }

      try {
        const headers: Record<string, string> = {
          "User-Agent": "SentinelCLI/0.2.0",
          "Accept": format === "json" ? "application/json" : "text/html,application/xhtml+xml,text/plain",
        };

        if (args.headers && typeof args.headers === "object") {
          Object.assign(headers, args.headers as Record<string, string>);
        }

        const response = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
          return { success: false, output: "", error: `HTTP ${response.status}: ${response.statusText}` };
        }

        const contentType = response.headers.get("content-type") || "";
        let text = await response.text();

        // For text format, strip HTML markup to readable text so the model
        // isn't fed a wall of tags. JSON/html formats are returned as-is.
        if (format === "text" && /html/i.test(contentType)) {
          text = htmlToText(text);
        }

        const truncated = text.length > 50000 ? text.slice(0, 50000) + "\n... (truncated)" : text;
        return { success: true, output: truncated };
      } catch (err) {
        return { success: false, output: "", error: String(err) };
      }
    },
  };
}
