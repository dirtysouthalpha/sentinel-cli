import type { CommandContext, CommandSpec } from "../context.js";
import { fetchRegistry, searchRegistry, installEntry } from "../../../core/marketplace.js";
import {
  saveWorkflow,
  listWorkflows,
  getWorkflow,
  deleteWorkflow,
  renderSteps,
} from "../../../core/workflows-store.js";
import {
  buildBundle,
  writeBundle,
  readBundle,
  applyBundle,
} from "../../../core/sync.js";
import { searchCatalog } from "../../../core/command-catalog.js";
import { isAbsolute, resolve } from "node:path";

/**
 * Default marketplace registry source for `/marketplace` (V15). A project-local
 * JSON file by default; overridable per-invocation with an explicit path/URL, or
 * by committing a registry document at this path. Can also be a remote URL.
 */
const DEFAULT_MARKETPLACE_SOURCE = ".sentinel/registry.json";

async function marketplace(ctx: CommandContext, args: string[]): Promise<void> {
  const sub = (args[0] || "").toLowerCase();
  const usage =
    "Usage: /marketplace list [source]  ·  /marketplace search <query> [source]  ·  /marketplace install <id> [source]";

  if (!sub) {
    ctx.addSystem(usage);
    return;
  }

  // Resolve a source token against the project root when it's a relative path;
  // URLs and absolute paths pass through.
  const resolveSource = (token?: string): string => {
    const src = token || DEFAULT_MARKETPLACE_SOURCE;
    if (/^https?:\/\//i.test(src) || isAbsolute(src)) return src;
    return resolve(ctx.projectRoot, src);
  };

  const loadRegistry = async (source: string) => fetchRegistry(source);

  if (sub === "list") {
    const source = resolveSource(args[1]);
    try {
      const reg = await loadRegistry(source);
      if (reg.entries.length === 0) {
        ctx.addSystem("Marketplace registry is empty.");
        return;
      }
      let msg = `Marketplace (${reg.entries.length} entr${reg.entries.length === 1 ? "y" : "ies"}):\n`;
      for (const e of reg.entries) {
        msg += `  ${e.id.padEnd(20)} [${e.type}] ${e.name}${e.description ? ` — ${e.description}` : ""}\n`;
      }
      ctx.addSystem(msg.trimEnd());
    } catch (err) {
      ctx.addError(`Marketplace list failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (sub === "search") {
    const query = (args[1] || "").trim();
    if (!query) {
      ctx.addSystem("Usage: /marketplace search <query> [source]");
      return;
    }
    const source = resolveSource(args[2]);
    try {
      const reg = await loadRegistry(source);
      const hits = searchRegistry(reg, query);
      if (hits.length === 0) {
        ctx.addSystem(`No marketplace entries match "${query}".`);
        return;
      }
      let msg = `${hits.length} match${hits.length === 1 ? "" : "es"} for "${query}":\n`;
      for (const e of hits) {
        msg += `  ${e.id.padEnd(20)} [${e.type}] ${e.name}${e.description ? ` — ${e.description}` : ""}\n`;
      }
      ctx.addSystem(msg.trimEnd());
    } catch (err) {
      ctx.addError(`Marketplace search failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (sub === "install") {
    const id = (args[1] || "").trim();
    if (!id) {
      ctx.addSystem("Usage: /marketplace install <id> [source]");
      return;
    }
    const source = resolveSource(args[2]);
    try {
      const reg = await loadRegistry(source);
      const entry = reg.entries.find((e) => e.id === id);
      if (!entry) {
        ctx.addError(`No marketplace entry with id "${id}". Try /marketplace list`);
        return;
      }
      // installEntry never throws on network failure — it returns a status string.
      const summary = await installEntry(ctx.projectRoot, entry);
      ctx.addSystem(summary);
      if (entry.type === "mcp") {
        ctx.addSystem(
          "MCP server recorded in .sentinel/mcp.install.json. Merge it into your config.mcp and restart to connect."
        );
      } else {
        ctx.addSystem("Skill installed. It loads on next start (or restart the session).");
      }
    } catch (err) {
      ctx.addError(`Marketplace install failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  ctx.addSystem(usage);
}

export const extensionCommands: CommandSpec[] = [
  {
    name: "mcp",
    async run(ctx) {
      if (!ctx.isMcpConnected()) {
        ctx.addSystem("MCP connects on your first message. Send one, then run /mcp.");
        return;
      }
      const tools = ctx.mcp.list();
      if (tools.length === 0) {
        ctx.addSystem("No MCP tools (no servers configured or none discovered).");
        return;
      }
      let msg = `MCP tools (${tools.length}):\n`;
      for (const t of tools) msg += `  mcp__${t.server}__${t.tool}\n`;
      ctx.addSystem(msg.trimEnd());
      return;
    },
  },
  {
    name: "marketplace",
    aliases: ["market"],
    async run(ctx) {
      await marketplace(ctx, ctx.args);
    },
  },
  {
    name: "palette",
    aliases: ["p"],
    async run(ctx) {
      const query = ctx.args.join(" ").trim();
      const matches = searchCatalog(query);
      if (matches.length === 0) {
        ctx.addSystem(`No commands match: ${query}`);
        return;
      }
      const width = Math.max(...matches.map((m) => m.command.length));
      const header = query ? `Palette — ${matches.length} match(es) for "${query}":` : "Palette:";
      const lines = matches.map((m) => `  ${m.command.padEnd(width)} — ${m.description}`);
      ctx.addSystem([header, ...lines].join("\n"));
      return;
    },
  },
  {
    name: "workflow",
    async run(ctx) {
      const sub = (ctx.args[0] || "").toLowerCase();

      if (!sub || sub === "list") {
        const wfs = listWorkflows(ctx.projectRoot);
        if (wfs.length === 0) {
          ctx.addSystem(
            "No workflows yet. Save one with:\n  /workflow save <name> <step1> ; <step2> ..."
          );
          return;
        }
        let msg = `Workflows (${wfs.length}):\n`;
        for (const wf of wfs) {
          const desc = wf.description ? ` — ${wf.description}` : "";
          msg += `  ${wf.name.padEnd(16)} ${wf.steps.length} step(s)${desc}\n`;
        }
        ctx.addSystem(msg.trimEnd());
        return;
      }

      if (sub === "save") {
        const name = ctx.args[1];
        if (!name) {
          ctx.addSystem("Usage: /workflow save <name> <step1> ; <step2> ...");
          return;
        }
        const rest = ctx.args.slice(2).join(" ").trim();
        const steps = rest
          .split(" ; ")
          .map((s) => s.trim())
          .filter(Boolean);
        if (steps.length === 0) {
          ctx.addSystem("Usage: /workflow save <name> <step1> ; <step2> ...");
          return;
        }
        try {
          saveWorkflow(ctx.projectRoot, { name, steps });
          ctx.addSystem(`Saved workflow "${name}" (${steps.length} step(s)).`);
        } catch (err) {
          ctx.addError(
            `Failed to save workflow: ${err instanceof Error ? err.message : String(err)}`
          );
        }
        return;
      }

      if (sub === "delete") {
        const name = ctx.args[1];
        if (!name) {
          ctx.addSystem("Usage: /workflow delete <name>");
          return;
        }
        ctx.addSystem(
          deleteWorkflow(ctx.projectRoot, name)
            ? `Deleted workflow "${name}".`
            : `No workflow named "${name}".`
        );
        return;
      }

      if (sub === "run") {
        const name = ctx.args[1];
        if (!name) {
          ctx.addSystem("Usage: /workflow run <name> [args...]");
          return;
        }
        const wf = getWorkflow(ctx.projectRoot, name);
        if (!wf) {
          ctx.addError(`No workflow named "${name}". Try /workflow list`);
          return;
        }
        const rendered = renderSteps(wf, ctx.args.slice(2));
        const composed =
          "Execute this workflow:\n" +
          rendered.map((step, i) => `${i + 1}. ${step}`).join("\n");
        ctx.addSystem(`▶ Running workflow "${name}" (${rendered.length} step(s))...`);
        await ctx.chatWithAI(composed);
        return;
      }

      ctx.addSystem(
        "Usage: /workflow list  ·  /workflow save <name> <step1> ; <step2> ...  ·  /workflow run <name> [args...]  ·  /workflow delete <name>"
      );
      return;
    },
  },
  {
    name: "sync",
    async run(ctx) {
      const sub = (ctx.args[0] || "").toLowerCase();

      if (!sub || sub === "export") {
        const rawPath = ctx.args.slice(1).join(" ").trim() || "sentinel-sync.json";
        const outPath = isAbsolute(rawPath) ? rawPath : resolve(ctx.projectRoot, rawPath);
        try {
          const bundle = buildBundle(ctx.projectRoot);
          writeBundle(outPath, bundle);
          const parts: string[] = [];
          parts.push(bundle.config ? "config (secrets redacted)" : "no config");
          parts.push(`${Object.keys(bundle.skills ?? {}).length} skill(s)`);
          parts.push(`${Object.keys(bundle.workflows ?? {}).length} workflow(s)`);
          ctx.addSystem(`Exported sync bundle → ${outPath}\n  ${parts.join("  ·  ")}`);
        } catch (err) {
          ctx.addError(
            `Sync export failed: ${err instanceof Error ? err.message : String(err)}`
          );
        }
        return;
      }

      if (sub === "import") {
        const rawPath = ctx.args.slice(1).join(" ").trim();
        if (!rawPath) {
          ctx.addSystem("Usage: /sync import <path>");
          return;
        }
        const inPath = isAbsolute(rawPath) ? rawPath : resolve(ctx.projectRoot, rawPath);
        try {
          const bundle = readBundle(inPath);
          const applied = applyBundle(ctx.projectRoot, bundle);
          const summary =
            applied.length > 0
              ? `Applied ${applied.length} item(s):\n  ${applied.join("\n  ")}`
              : "Nothing to apply (bundle had no skills or workflows).";
          const note = bundle.config
            ? "\nNote: the bundle's global config was NOT applied (review it manually)."
            : "";
          ctx.addSystem(`Imported sync bundle ← ${inPath}\n${summary}${note}`);
        } catch (err) {
          ctx.addError(
            `Sync import failed: ${err instanceof Error ? err.message : String(err)}`
          );
        }
        return;
      }

      ctx.addSystem("Usage: /sync export [path]  ·  /sync import <path>");
      return;
    },
  },
];
