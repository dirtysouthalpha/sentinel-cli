import type { CommandContext, CommandSpec } from "../context.js";
import { suggestCommand } from "../../../core/command-search.js";
import { state } from "../../../core/state.js";
import { providerManager } from "../../../ai/provider.js";
import { runDiagnostics, formatDiagnostics } from "../../../core/diagnostics.js";

/** /cmd <natural language> — AI command-search: NL → one shell command. */
async function cmdSearch(ctx: CommandContext, nl: string): Promise<void> {
  const query = nl.trim();
  if (!query) {
    ctx.addSystem("Usage: /cmd <natural language>  e.g. /cmd list the 5 largest files");
    return;
  }

  const [providerName, ...modelParts] = state.get("currentModel").split("/");
  const modelName = modelParts.join("/") || undefined;
  const provider = providerManager.getProvider(providerName);
  if (!provider) {
    ctx.addError(`No provider "${providerName}". Try /providers`);
    return;
  }
  if (!provider.isAvailable()) {
    ctx.addError(`No API key for "${providerName}". Type /connect`);
    return;
  }

  ctx.addSystem(`Searching for a command for: ${query}`);
  try {
    const { command, explanation } = await suggestCommand(provider, query, {
      model: modelName,
    });
    if (!command) {
      ctx.addSystem(
        explanation
          ? `No command produced. ${explanation}`
          : "No command produced."
      );
      return;
    }
    let msg = `Suggested command:\n  ${command}`;
    if (explanation) msg += `\n\n${explanation}`;
    msg += `\n\nRun it with /bg ${command}  — or copy/paste it into your shell.`;
    ctx.addSystem(msg);
  } catch (err) {
    ctx.addError(
      `Command search failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export const taskCommands: CommandSpec[] = [
  // /bg <cmd> runs a shell command in the background; /bg cancel <id> stops it.
  {
    name: "bg",
    description: "Run a shell command in the background",
    usage: "<command>",
    group: "repo",
    async run(ctx) {
      if (ctx.args[0] === "cancel") {
        const id = ctx.args[1];
        if (!id) return void ctx.addError("Usage: /bg cancel <id>");
        ctx.addSystem(ctx.background.cancel(id) ? `bg #${id} cancelled.` : `No running bg task #${id}.`);
        return;
      }
      const command = ctx.args.join(" ").trim();
      if (!command) return void ctx.addSystem("Usage: /bg <shell command>   ·   /bg cancel <id>   ·   /tasks");
      ctx.wireBackground();
      const task = ctx.background.start(command, (signal) => ctx.runShell(command, signal));
      ctx.addSystem(`▶ bg #${task.id} started: ${command}`);
      return;
    },
  },

  // /tasks lists background tasks and their status.
  {
    name: "tasks",
    description: "List background tasks (and their status)",
    group: "repo",
    async run(ctx) {
      const tasks = ctx.background.list();
      if (tasks.length === 0) return void ctx.addSystem("No background tasks. Start one with /bg <command>.");
      const mark: Record<string, string> = { running: "▶", done: "✓", error: "✗", cancelled: "∅" };
      ctx.addSystem(
        "Background tasks:\n" +
          tasks.map((t) => `${mark[t.status] || "?"} #${t.id} [${t.status}] ${t.label}`).join("\n")
      );
      return;
    },
  },

  // /diagnostics (alias /diag): run the project's typecheck/build and surface
  // structured errors. Optional args override the command (e.g. /diag npm run build).
  {
    name: "diagnostics",
    aliases: ["diag"],
    description: "Run typecheck/build, report errors",
    usage: "[command]",
    group: "repo",
    async run(ctx) {
      const command = ctx.args.join(" ").trim() || undefined;
      ctx.addSystem(`Running diagnostics: ${command || "npx tsc --noEmit"} …`);
      try {
        const { ok, diagnostics } = await runDiagnostics(ctx.projectRoot, { command });
        if (ok && diagnostics.length === 0) {
          ctx.addSystem("No problems found.");
        } else {
          ctx.addSystem(formatDiagnostics(diagnostics));
        }
      } catch (err) {
        ctx.addError(`Diagnostics failed: ${(err as Error).message}`);
      }
      return;
    },
  },

  {
    name: "cmd",
    description: "AI command-search: natural language → shell command",
    usage: "<text>",
    group: "agentic",
    async run(ctx) {
      await cmdSearch(ctx, ctx.args.join(" "));
    },
  },
];
