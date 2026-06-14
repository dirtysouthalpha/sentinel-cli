import type { CommandSpec } from "../context.js";
import { buildIndex, search as searchRepoIndex } from "../../../core/repo-index.js";
import { CheckpointManager } from "../../../core/checkpoints.js";

export const repoCommands: CommandSpec[] = [
  // /index — build the lite TF-IDF repo index (V11).
  {
    name: "index",
    description: "Build a semantic index of the repo (TF-IDF, local)",
    group: "repo",
    async run(ctx) {
      const index = buildIndex(ctx.projectRoot);
      ctx.setRepoIndex(index);
      const note = index.truncated ? " (truncated — file cap hit)" : "";
      ctx.addSystem(`Indexed ${index.fileCount} file(s)${note}.`);
      return;
    },
  },

  // /search <query> — semantic search over the repo index (builds it first if needed).
  {
    name: "search",
    description: "Semantic search the repo index for relevant files",
    usage: "<query>",
    group: "repo",
    async run(ctx) {
      const query = ctx.args.join(" ").trim();
      if (!query) {
        ctx.addSystem("Usage: /search <query>");
        return;
      }
      let idx = ctx.getRepoIndex();
      if (!idx) {
        idx = buildIndex(ctx.projectRoot);
        ctx.setRepoIndex(idx);
        ctx.addSystem(`Built index of ${idx.fileCount} file(s).`);
      }
      const results = searchRepoIndex(idx, query, 8);
      if (results.length === 0) {
        ctx.addSystem(`No matches for: ${query}`);
        return;
      }
      let msg = `Top ${results.length} result(s) for "${query}":\n`;
      for (const r of results) {
        msg += `  ${r.path}  (${r.score.toFixed(3)})\n`;
        if (r.snippet) msg += `      ${r.snippet}\n`;
      }
      ctx.addSystem(msg.trimEnd());
      return;
    },
  },

  {
    name: "checkpoints",
    description: "List file checkpoints",
    group: "repo",
    async run(ctx) {
      const cps = new CheckpointManager(ctx.projectRoot).list();
      if (cps.length === 0) {
        ctx.addSystem("No checkpoints yet. They're created when the agent edits files.");
        return;
      }
      let msg = `Checkpoints (${cps.length}, newest last):\n`;
      for (const c of cps) {
        msg += `  ${c.id}  ${c.tool.padEnd(6)} ${c.existed ? "edit  " : "create"}  ${c.path}\n`;
      }
      ctx.addSystem(msg.trimEnd());
      return;
    },
  },

  {
    name: "undo",
    description: "Undo the last agent file change",
    group: "repo",
    async run(ctx) {
      const cp = new CheckpointManager(ctx.projectRoot).undoLast();
      if (!cp) {
        ctx.addSystem("Nothing to undo.");
        return;
      }
      ctx.addSystem(`Undid ${cp.tool} ${cp.existed ? "edit" : "create"} of ${cp.path}`);
      return;
    },
  },
];
