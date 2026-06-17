/**
 * Command catalog (V13 command-palette groundwork).
 *
 * A curated, ordered list of the main slash commands with one-line descriptions,
 * used to power a searchable command palette. `searchCatalog` ranks entries with
 * the shared fuzzy matcher (src/core/fuzzy.ts) — do not reimplement matching here.
 */

import { fuzzyFilter } from "./fuzzy.js";

export interface PaletteCommand {
  /** Display form, including the leading slash (e.g. "/plan"). */
  command: string;
  /** One-line description shown next to the command. */
  description: string;
}

/** Curated palette of the main slash commands, in a sensible display order. */
export const COMMAND_CATALOG: PaletteCommand[] = [
  { command: "/plan", description: "Read-only research mode: propose a plan, no edits" },
  { command: "/cmd", description: "AI command-search: natural language → shell command" },
  { command: "/workflow", description: "Saved workflows: list | save | run | delete" },
  { command: "/pipeline", description: "Run a deterministic JSON pipeline of agent steps" },
  { command: "/ship", description: "Autonomous GSD: plan → implement → test → review → fix" },
  { command: "/autopilot", description: "Set-and-forget: loop GSD until the project is production-ready" },
  { command: "/connect", description: "Use Claude via your OAuth router (keyless): /connect claude" },
  { command: "/index", description: "Build a semantic index of the repo (TF-IDF, local)" },
  { command: "/search", description: "Semantic search the repo index for relevant files" },
  { command: "/bg", description: "Run a shell command in the background" },
  { command: "/tasks", description: "List background tasks and their status" },
  { command: "/export", description: "Export this session's transcript to a file" },
  { command: "/branch", description: "Duplicate this session into a new tab" },
  { command: "/usage", description: "Usage metrics: tokens, cost, per-tool table" },
  { command: "/ask-prime", description: "Ask Sentinel Prime (Hermes agent)" },
  { command: "/workspace", description: "Multi-repo roots: list | add | remove | use" },
  { command: "/marketplace", description: "Extension registry: list | search | install" },
  { command: "/permissions", description: "Guardrails: yolo | auto | gated | plan" },
  { command: "/undo", description: "Undo the last agent file change" },
  { command: "/checkpoints", description: "List file checkpoints" },
  { command: "/mcp", description: "List connected MCP tools" },
  { command: "/model", description: "List/switch model (by name or number)" },
  { command: "/agent", description: "List/switch agent (gsd, code, debug, plan, ask)" },
  { command: "/skill", description: "List/run a skill: /skill <name|number> [args]" },
  { command: "/theme", description: "List/switch theme" },
  { command: "/diagnostics", description: "Show provider, config, and runtime diagnostics" },
  { command: "/palette", description: "Search the command palette (alias /p)" },
  { command: "/help", description: "Show the full command list" },
  { command: "/clear", description: "Clear chat history" },
  { command: "/compact", description: "Compress context (save tokens)" },
  { command: "/cost", description: "Session cost breakdown" },
  { command: "/providers", description: "Show providers and which have a key" },
  { command: "/sync", description: "Portable settings bundle: export | import" },
  { command: "/team", description: "Shared team registry: info | add | remove" },
  { command: "/describe", description: "Vision: describe a local image (one-shot)" },
  { command: "/about", description: "Version, runtime, and feature summary" },
  { command: "/update", description: "Check npm for a newer Sentinel release" },
  { command: "/setup", description: "How to connect a provider (keys / wizard)" },
  { command: "/quit", description: "Exit Sentinel" },
];

/**
 * Fuzzy-search the catalog by command text.
 * Empty/whitespace query → the full catalog in original order.
 * No matches → empty array.
 */
export function searchCatalog(
  query: string,
  catalog: PaletteCommand[] = COMMAND_CATALOG,
): PaletteCommand[] {
  const q = query.trim();
  if (!q) return [...catalog];
  return fuzzyFilter(q, catalog, (c) => c.command).map((r) => r.item);
}
