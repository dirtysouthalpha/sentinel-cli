import { lookup } from "dns/promises";
import { isIP } from "net";
import { ToolDef, ToolResult } from "./types.js";

/** True for loopback / private / link-local / reserved IP ranges (SSRF targets). */
function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split(".").map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true; // this-host, private, loopback
    if (p[0] === 169 && p[1] === 254) return true; // link-local (incl. 169.254.169.254 metadata)
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // private
    if (p[0] === 192 && p[1] === 168) return true; // private
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    if (p[0] >= 224) return true; // multicast / reserved
    return false;
  }
  if (v === 6) {
    const l = ip.toLowerCase();
    if (l === "::1" || l === "::") return true; // loopback / unspecified
    if (l.startsWith("fe80")) return true; // link-local
    if (l.startsWith("fc") || l.startsWith("fd")) return true; // unique-local
    if (l.startsWith("::ffff:")) return isBlockedIp(l.slice(7)); // IPv4-mapped
    return false;
  }
  return false;
}

/** Validate scheme is http(s) and the host does not resolve to a private/reserved IP. */
async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Blocked URL scheme "${parsed.protocol}" (only http/https allowed)`);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (host.toLowerCase() === "localhost") {
    throw new Error("Blocked request to localhost");
  }
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new Error(`Blocked request to private/reserved address: ${host}`);
    return parsed;
  }
  // Resolve the hostname and reject if any address is private/reserved (mitigates
  // DNS-rebinding to internal services / cloud metadata endpoints).
  const addrs = await lookup(host, { all: true });
  for (const { address } of addrs) {
    if (isBlockedIp(address)) {
      throw new Error(`Blocked request: ${host} resolves to private/reserved address ${address}`);
    }
  }
  return parsed;
}

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

        // Follow redirects manually, re-validating each hop against the SSRF
        // guard so a redirect can't bounce the request to an internal host.
        let current = url;
        let response: Response | undefined;
        for (let hop = 0; hop < 6; hop++) {
          const safeUrl = await assertSafeUrl(current);
          response = await fetch(safeUrl, {
            headers,
            redirect: "manual",
            signal: AbortSignal.timeout(30000),
          });
          if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get("location");
            if (!location) break;
            current = new URL(location, safeUrl).toString();
            continue;
          }
          break;
        }

        if (!response) {
          return { success: false, output: "", error: "No response" };
        }
        if (response.status >= 300 && response.status < 400) {
          return { success: false, output: "", error: "Too many redirects" };
        }
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
