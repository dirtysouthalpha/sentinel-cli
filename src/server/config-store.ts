import { existsSync, readFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { writeAtomicFileSync } from "../utils/atomic-write.js";

/**
 * Read/write the GLOBAL Sentinel config (~/.config/sentinel/config.json) so
 * settings made in the GUI — provider keys, custom models, MCP servers — persist
 * across projects. The ConfigManager already merges this under project config.
 */
export function globalConfigPath(): string {
  return join(homedir(), ".config", "sentinel", "config.json");
}

export function readGlobalConfig(): Record<string, unknown> {
  const p = globalConfigPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function writeGlobalConfig(cfg: Record<string, unknown>): void {
  const p = globalConfigPath();
  mkdirSync(dirname(p), { recursive: true });
  writeAtomicFileSync(p, JSON.stringify(cfg, null, 2));
}

type AnyRec = Record<string, unknown>;

/** Merge a provider entry (apiKey/baseURL/defaultModel/...) into global config. */
export function setProviderConfig(name: string, patch: AnyRec): void {
  const g = readGlobalConfig();
  const provider = (g.provider as AnyRec) || {};
  provider[name] = { ...((provider[name] as AnyRec) || {}), ...patch };
  g.provider = provider;
  writeGlobalConfig(g);
}

export function removeProviderConfig(name: string): void {
  const g = readGlobalConfig();
  const provider = (g.provider as AnyRec) || {};
  delete provider[name];
  g.provider = provider;
  writeGlobalConfig(g);
}

/** The user's custom model list shown in the GUI (provider/model strings). */
export function getCustomModels(): string[] {
  const g = readGlobalConfig();
  return Array.isArray(g.models) ? (g.models as string[]) : [];
}

export function addCustomModel(model: string): void {
  const g = readGlobalConfig();
  const models = new Set(getCustomModels());
  models.add(model);
  g.models = [...models];
  writeGlobalConfig(g);
}

export function removeCustomModel(model: string): void {
  const g = readGlobalConfig();
  g.models = getCustomModels().filter((m) => m !== model);
  writeGlobalConfig(g);
}

export interface McpEntry {
  type?: "local" | "remote";
  command?: string[];
  url?: string;
  enabled?: boolean;
}

export function setMcpConfig(name: string, entry: McpEntry): void {
  const g = readGlobalConfig();
  const mcp = (g.mcp as AnyRec) || {};
  mcp[name] = entry;
  g.mcp = mcp;
  writeGlobalConfig(g);
}

export function removeMcpConfig(name: string): void {
  const g = readGlobalConfig();
  const mcp = (g.mcp as AnyRec) || {};
  delete mcp[name];
  g.mcp = mcp;
  writeGlobalConfig(g);
}
