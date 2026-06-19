/**
 * `memory` — persistent cross-session memory (store + recall + list + delete).
 *
 * Lets the agent remember facts, decisions, and preferences across sessions.
 * Backed by MemoryStore (src/core/memory-store.ts), which persists to
 * `.sentinel/memory.json` via the fileBackend. Closes the "agent forgets
 * everything between sessions" gap vs Claude Code's CLAUDE.md / Cursor's memory.
 *
 * Never throws — a failed read/write degrades to an empty store.
 */

import { ToolDef, ToolResult } from "./types.js";
import { MemoryStore, fileBackend, type MemoryRegion } from "../core/memory-store.js";

const ACTIONS = ["store", "recall", "list", "delete"] as const;
type MemoryAction = (typeof ACTIONS)[number];
const REGIONS: MemoryRegion[] = ["knowledge", "context", "preference", "decision"];

let activeStore: MemoryStore | null = null;
let projectRootCached: string | null = null;

function store(projectRoot: string): MemoryStore {
  // Reuse the store across calls within a process; rebuild if project changed.
  if (!activeStore || projectRootCached !== projectRoot) {
    activeStore = new MemoryStore(fileBackend(projectRoot), { source: "agent", maxEntries: 500 });
    projectRootCached = projectRoot;
  }
  return activeStore;
}

export function createMemoryTool(projectRoot: string): ToolDef {
  return {
    name: "memory",
    description:
      "Persistent cross-session memory. Store facts/decisions/preferences and recall them in " +
      "later sessions. Actions: store (topic+content+region → saved), recall (query → matching " +
      "entries, newest-first), list (all entries), delete (by id). Regions: knowledge, context, " +
      "preference, decision. Use this to remember project decisions, user preferences, and " +
      "workarounds so they survive across sessions.",
    parameters: {
      action: {
        type: "string",
        description: "store | recall | list | delete",
        required: true,
      },
      topic: {
        type: "string",
        description: "Short topic/tag for the memory (for store) or search query (for recall).",
      },
      content: {
        type: "string",
        description: "The memory content to store (for store).",
      },
      region: {
        type: "string",
        description: "knowledge | context | preference | decision (for store, default: knowledge).",
      },
      id: {
        type: "string",
        description: "Entry ID to delete (for delete).",
      },
    },
    execute: async (args): Promise<ToolResult> => {
      const action = String(args.action ?? "") as MemoryAction;
      if (!ACTIONS.includes(action)) {
        return { success: false, output: "", error: `Unknown action '${action}'. Use: ${ACTIONS.join(", ")}.` };
      }

      try {
        const s = store(projectRoot);

        if (action === "store") {
          const topic = String(args.topic ?? "").trim();
          const content = String(args.content ?? "").trim();
          if (!topic || !content) {
            return { success: false, output: "", error: "memory store requires topic + content." };
          }
          const region = (String(args.region ?? "knowledge") as MemoryRegion);
          const entry = s.add(topic, content, REGIONS.includes(region) ? region : "knowledge");
          return { success: true, output: `Stored [${entry.region}] ${topic}: ${content}` };
        }

        if (action === "recall") {
          const query = String(args.topic ?? "").trim();
          const results = s.query(query);
          if (results.length === 0) {
            return { success: true, output: `No memories matching "${query}".` };
          }
          const formatted = results
            .slice(0, 20)
            .map((e) => `[${e.region}] ${e.topic}: ${e.content}`)
            .join("\n");
          return { success: true, output: `${results.length} memor${results.length === 1 ? "y" : "ies"}:\n${formatted}` };
        }

        if (action === "list") {
          const all = s.list();
          if (all.length === 0) return { success: true, output: "Memory is empty." };
          const formatted = all.slice(0, 50).map((e) => `[${e.region}] ${e.topic}: ${e.content}`).join("\n");
          return { success: true, output: `${all.length} entries:\n${formatted}` };
        }

        // delete
        const id = String(args.id ?? "").trim();
        if (!id) return { success: false, output: "", error: "memory delete requires an id." };
        const deleted = s.delete(id);
        return deleted
          ? { success: true, output: `Deleted memory ${id}.` }
          : { success: false, output: "", error: `No memory with id ${id}.` };
      } catch (err) {
        return { success: false, output: "", error: `memory tool failed: ${String(err)}` };
      }
    },
  };
}
