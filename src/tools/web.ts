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
