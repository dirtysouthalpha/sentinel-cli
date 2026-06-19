/**
 * `lsp` — language-server queries (definitions, references, diagnostics).
 *
 * Gives the agent structural code awareness that grep can't provide: real
 * go-to-definition, find-all-references, and live type errors. Backed by the
 * LSPManager (src/core/lsp-client.ts), which spawns language servers per
 * language on demand.
 *
 * GRACEFUL DEGRADATION (critical):
 * No servers configured → every action returns a clear "LSP not configured"
 * message and the agent falls back to `search`. LSP is an accelerator for
 * supported languages, never a blocker. The tool never throws.
 */

import { ToolDef, ToolResult } from "./types.js";
import {
  LSPManager,
  LSPServerMap,
  languageForPath,
} from "../core/lsp-client.js";
import { getConfigManager } from "../core/config.js";
import {
  formatDefinition,
  formatReferences,
  formatDiagnostics,
} from "../core/lsp-context.js";

// Singleton manager — servers stay alive across queries within a session.
// Lazily built on first use so a misconfigured or absent LSP setup costs zero
// startup time. The server map is read from config on first use (the config is
// already loaded by the time any tool fires), so no boot-time wiring is needed.
let activeManager: LSPManager | null = null;
let loadedServers: LSPServerMap | null = null;

/** Read the lsp server map from config (cached after first read). */
function servers(): LSPServerMap {
  if (loadedServers !== null) return loadedServers;
  try {
    const cfg = getConfigManager().getAll();
    loadedServers = (cfg.lsp as unknown as LSPServerMap) ?? {};
  } catch {
    // Config not loaded yet (e.g. test harness) — treat as unconfigured.
    loadedServers = {};
  }
  return loadedServers;
}

/** Force a re-read of config (used by tests / config-reload flows). */
export function reloadLspConfig(): void {
  loadedServers = null;
  if (activeManager) {
    activeManager.shutdown();
    activeManager = null;
  }
}

function manager(): LSPManager {
  if (!activeManager) {
    activeManager = new LSPManager(servers());
  }
  return activeManager;
}

/** Tear down all spawned servers. Called at process exit. */
export function shutdownLsp(): void {
  if (activeManager) {
    activeManager.shutdown();
    activeManager = null;
  }
}

const ACTIONS = ["definition", "references", "diagnostics"] as const;
type LspAction = (typeof ACTIONS)[number];

export function createLspTool(): ToolDef {
  return {
    name: "lsp",
    description:
      "Query a language server for structural code intelligence: go-to-definition, " +
      "find-all-references, or diagnostics (type errors/warnings) for a file. " +
      "Use this instead of grep when you need real symbol resolution. " +
      "Actions: definition (file+line+col → definition location), " +
      "references (file+line+col → all reference sites), " +
      "diagnostics (file → current errors/warnings). " +
      "Line/column are 1-based (editor convention). " +
      "Returns a clear 'not configured' message if no LSP server is set up for the file's language.",
    parameters: {
      action: {
        type: "string",
        description: "definition | references | diagnostics",
        required: true,
      },
      file: {
        type: "string",
        description: "File path (absolute or relative to project root).",
        required: true,
      },
      line: {
        type: "number",
        description: "1-based line number (for definition/references).",
      },
      col: {
        type: "number",
        description: "1-based column number (for definition/references).",
      },
    },
    execute: async (args): Promise<ToolResult> => {
      const action = String(args.action ?? "") as LspAction;
      const file = String(args.file ?? "").trim();
      if (!ACTIONS.includes(action)) {
        return {
          success: false,
          output: "",
          error: `Unknown action '${action}'. Use one of: ${ACTIONS.join(", ")}.`,
        };
      }
      if (!file) {
        return { success: false, output: "", error: "lsp requires a 'file'." };
      }

      // If the file's language has no server configured, say so plainly — the
      // agent should fall back to search, not error out.
      const language = languageForPath(file);
      const cfgServers = servers();
      if (!language || !cfgServers[language]) {
        return {
          success: true,
          output:
            `LSP not configured for ${language ?? "this file type"}. ` +
            `Falling back to grep/search is recommended. ` +
            (language
              ? `Configure under "lsp": { "${language}": { "command": "<server>", "args": ["--stdio"] } } to enable.`
              : `Supported extensions: .ts/.tsx/.js/.jsx/.py/.go/.rs/.java/.c/.cpp/.cs/.rb/.php`),
        };
      }

      // Convert 1-based editor coords → 0-based LSP coords.
      const line = Math.max(0, Number(args.line ?? 1) - 1);
      const col = Math.max(0, Number(args.col ?? 1) - 1);

      try {
        if (action === "definition") {
          const loc = await manager().getDefinition(file, line, col);
          return { success: true, output: formatDefinition(loc) };
        }
        if (action === "references") {
          const refs = await manager().getReferences(file, line, col);
          return { success: true, output: formatReferences(refs) };
        }
        // diagnostics
        const diags = await manager().getDiagnostics(file);
        return { success: true, output: formatDiagnostics(diags) };
      } catch (err) {
        // Never let an LSP failure break the agent loop.
        return {
          success: false,
          output: "",
          error: `LSP query failed: ${String(err)}. The server may not have started; fall back to search.`,
        };
      }
    },
  };
}
