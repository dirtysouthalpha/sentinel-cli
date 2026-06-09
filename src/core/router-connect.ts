/**
 * One-command Claude-over-OAuth setup. Points the `anthropic` provider at the
 * local anthropic-oauth-router (keyless — the provider is proxy-aware) so you can
 * use a Claude subscription from any tool, safely behind the router.
 *
 * The config builder is pure (testable); the probe and global-config write are
 * the thin I/O wrappers.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export const DEFAULT_ROUTER_URL = "http://127.0.0.1:8080/v1/anthropic";
export const DEFAULT_CLAUDE_MODEL = "anthropic/claude-sonnet-4-6";

/** Global config path (same layered location ConfigManager reads first). */
export function globalConfigPath(): string {
  return join(homedir(), ".config", "sentinel", "config.json");
}

/**
 * Return a NEW config object with the anthropic provider pointed at the router
 * (keyless) and the model set to Claude. Pure — does not touch disk. The provider
 * block uses the `{ options: { baseURL } }` shape (no apiKey); the proxy-aware
 * AnthropicProvider needs no key when baseURL isn't api.anthropic.com.
 */
export function applyRouterConfig(
  config: Record<string, unknown>,
  routerUrl: string = DEFAULT_ROUTER_URL,
  model: string = DEFAULT_CLAUDE_MODEL
): Record<string, unknown> {
  const provider = { ...((config.provider as Record<string, unknown>) || {}) };
  provider.anthropic = {
    options: { baseURL: routerUrl },
    models: { "claude-sonnet-4-6": { name: "Claude Sonnet 4.6" }, "claude-opus-4-8": { name: "Claude Opus 4.8" } },
  };
  return { ...config, provider, model };
}

/** Read the global config, apply the router settings, and write it back. */
export function writeRouterConfig(routerUrl: string = DEFAULT_ROUTER_URL, model: string = DEFAULT_CLAUDE_MODEL): string {
  const path = globalConfigPath();
  let current: Record<string, unknown> = {};
  try {
    if (existsSync(path)) current = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    current = {};
  }
  const next = applyRouterConfig(current, routerUrl, model);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2));
  return path;
}

/** Best-effort reachability probe of the router. */
export async function probeRouter(routerUrl: string = DEFAULT_ROUTER_URL): Promise<{ reachable: boolean; detail: string }> {
  // Hit the router origin; any HTTP response (even 401/404) means it's up.
  let origin: string;
  try {
    const u = new URL(routerUrl);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    return { reachable: false, detail: `invalid router URL: ${routerUrl}` };
  }
  try {
    const res = await fetch(origin, { method: "GET", signal: AbortSignal.timeout(2500) });
    return { reachable: true, detail: `router responded (HTTP ${res.status})` };
  } catch (err) {
    return { reachable: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** The exact commands to start + authenticate the router (shown as guidance). */
export function routerStartHelp(): string {
  return [
    "Start it in the anthropic-oauth-router repo:",
    "  python cli.py serve         # proxy on 127.0.0.1:8080 — leave running",
    "  python cli.py authenticate  # opens your browser; log in with Claude",
  ].join("\n");
}
