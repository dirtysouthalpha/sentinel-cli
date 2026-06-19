/**
 * `pr` — first-class GitHub PR tool (create/list/view/merge + conflict detection).
 *
 * Replaces the old /pr slash command that shelled `gh` blindly via bash. Now PR
 * creation is a real tool: gh auth check, structured output, merge-conflict
 * extraction. Backed by the pure argv builders + GhRunner seam in pr-tool.ts.
 *
 * GRACEFUL DEGRADATION: gh not installed/authed → every action returns a clear
 * "gh not authenticated, run gh auth login" message. Never throws.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ToolDef, ToolResult } from "./types.js";
import {
  GhRunner,
  createPr,
  buildConflictHunks,
  buildPrListArgs,
  buildPrViewArgs,
  buildPrMergeArgs,
  ghAvailable,
} from "../core/pr-tool.js";

const execFileAsync = promisify(execFile);

/** Production gh runner: real execFile('gh', ...). */
const realGh: GhRunner = {
  async run(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    try {
      const { stdout } = await execFileAsync("gh", args, { maxBuffer: 1024 * 1024 * 10 });
      return { ok: true, stdout, stderr: "" };
    } catch (err: any) {
      return { ok: false, stdout: err.stdout ?? "", stderr: err.stderr ?? err.message };
    }
  },
};

const ACTIONS = ["create", "list", "view", "merge", "conflicts"] as const;
type PrAction = (typeof ACTIONS)[number];

export function createPrTool(): ToolDef {
  return {
    name: "pr",
    description:
      "Manage GitHub pull requests via the gh CLI. Actions: create (title+body → PR URL), " +
      "list (open PRs), view (PR details as JSON), merge (squash/merge/rebase + delete branch), " +
      "conflicts (file content with <<<<<<< markers → structured ours/theirs hunks). " +
      "Requires gh installed and authenticated (gh auth login). Returns a clear " +
      "'not authenticated' message if gh isn't set up.",
    parameters: {
      action: {
        type: "string",
        description: "create | list | view | merge | conflicts",
        required: true,
      },
      title: {
        type: "string",
        description: "PR title (for create).",
      },
      body: {
        type: "string",
        description: "PR body/description (for create).",
      },
      draft: {
        type: "boolean",
        description: "Create as draft PR (for create).",
      },
      number: {
        type: "number",
        description: "PR number (for view/merge).",
      },
      labels: {
        type: "string",
        description: "Comma-separated labels (for create).",
      },
      assignees: {
        type: "string",
        description: "Comma-separated GitHub usernames (for create).",
      },
      file: {
        type: "string",
        description: "File path to scan for merge conflicts (for conflicts).",
      },
      strategy: {
        type: "string",
        description: "Merge strategy: squash | merge | rebase (for merge).",
      },
    },
    execute: async (args): Promise<ToolResult> => {
      const action = String(args.action ?? "") as PrAction;
      if (!ACTIONS.includes(action)) {
        return {
          success: false,
          output: "",
          error: `Unknown action '${action}'. Use one of: ${ACTIONS.join(", ")}.`,
        };
      }

      try {
        if (action === "create") {
          const title = String(args.title ?? "").trim();
          const body = String(args.body ?? "").trim();
          if (!title) return { success: false, output: "", error: "pr create requires a title." };
          const labels = args.labels ? String(args.labels).split(",").map((s) => s.trim()) : undefined;
          const assignees = args.assignees ? String(args.assignees).split(",").map((s) => s.trim()) : undefined;
          const res = await createPr(realGh, title, body, {
            draft: !!args.draft,
            labels,
            assignees,
          });
          return res.ok
            ? { success: true, output: `PR created: ${res.output}` }
            : { success: false, output: "", error: res.error };
        }

        if (action === "list") {
          if (!(await ghAvailable(realGh))) {
            return { success: true, output: "gh not authenticated. Run 'gh auth login' to enable PR listing." };
          }
          const res = await realGh.run(buildPrListArgs(20));
          return res.ok
            ? { success: true, output: res.stdout || "No open PRs." }
            : { success: false, output: "", error: res.stderr };
        }

        if (action === "view") {
          const num = Number(args.number);
          if (!num) return { success: false, output: "", error: "pr view requires a number." };
          if (!(await ghAvailable(realGh))) {
            return { success: true, output: "gh not authenticated. Run 'gh auth login'." };
          }
          const res = await realGh.run(buildPrViewArgs(num));
          return res.ok ? { success: true, output: res.stdout } : { success: false, output: "", error: res.stderr };
        }

        if (action === "merge") {
          const num = Number(args.number);
          if (!num) return { success: false, output: "", error: "pr merge requires a number." };
          if (!(await ghAvailable(realGh))) {
            return { success: true, output: "gh not authenticated. Run 'gh auth login'." };
          }
          const strat = (String(args.strategy ?? "squash") as "squash" | "merge" | "rebase");
          const res = await realGh.run(buildPrMergeArgs(num, strat, true));
          return res.ok
            ? { success: true, output: `PR #${num} merged (${strat}).` }
            : { success: false, output: "", error: res.stderr };
        }

        // conflicts
        const file = String(args.file ?? "").trim();
        if (!file) return { success: false, output: "", error: "pr conflicts requires a file path." };
        const { readFileSync } = await import("node:fs");
        const { resolve } = await import("node:path");
        let content: string;
        try {
          content = readFileSync(resolve(file), "utf-8");
        } catch (err) {
          return { success: false, output: "", error: `Cannot read ${file}: ${err}` };
        }
        const hunks = buildConflictHunks(content, file);
        if (hunks.length === 0) {
          return { success: true, output: `No conflict markers found in ${file}.` };
        }
        const formatted = hunks
          .map((h, i) => `Conflict ${i + 1} in ${h.file}:\n  ours:   ${h.ours.replace(/\n/g, "\n          ")}\n  theirs: ${h.theirs.replace(/\n/g, "\n          ")}`)
          .join("\n\n");
        return { success: true, output: `${hunks.length} conflict(s) found:\n\n${formatted}` };
      } catch (err) {
        return { success: false, output: "", error: `pr tool failed: ${String(err)}` };
      }
    },
  };
}
