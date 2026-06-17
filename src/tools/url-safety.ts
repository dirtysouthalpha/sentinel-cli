import { lookup } from "dns/promises";
import { isIP } from "net";

/**
 * SSRF defense for any tool that fetches an attacker-controllable URL (web,
 * browser). Centralized here so the `web` and `browser` tools share one
 * implementation and can't drift — previously `web.ts` enforced these checks
 * while `browser.ts` navigated to file:// and 169.254.169.254 freely.
 *
 * Pure + dependency-free aside from `dns/promises`, so it is unit-testable.
 */

/** True for loopback / private / link-local / reserved IP ranges (SSRF targets). */
export function isBlockedIp(ip: string): boolean {
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

/**
 * Validate scheme is http(s) and the host does not resolve to a private/reserved
 * IP. Throws with a human-readable message when the URL is unsafe. Resolves to
 * the parsed URL otherwise. Callers should re-validate after each redirect hop.
 */
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
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
