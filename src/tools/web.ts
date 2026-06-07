import { ToolDef, ToolResult } from "./types.js";

export function createWebTool(): ToolDef {
  return {
    name: "web",
    description: "Fetch content from URLs (docs, APIs, web pages)",
    parameters: {
      url: { type: "string", description: "URL to fetch", required: true },
      format: { type: "string", description: "Response format: text|json|html", default: "text" },
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

        const text = await response.text();
        const truncated = text.length > 50000 ? text.slice(0, 50000) + "\n... (truncated)" : text;

        return { success: true, output: truncated };
      } catch (err) {
        return { success: false, output: "", error: String(err) };
      }
    },
  };
}
