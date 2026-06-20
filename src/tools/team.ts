/**
 * `team` — parallel multi-agent task execution across isolated git worktrees.
 *
 * Wires the existing runTeam() (agent-team.ts) + WorktreeManager (worktree.ts)
 * into a tool the agent can invoke. Each task gets its own worktree/branch;
 * results merge back sequentially; conflicts are reported not force-resolved.
 *
 * The subagent runner and git runner are injected so tests can fake them.
 */

import { ToolDef, ToolResult } from "./types.js";
import { runTeam, asWorktreeOps, type TeamTask, type RunSubagent } from "../core/agent-team.js";
import { WorktreeManager, type GitRunner } from "../core/worktree.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

/** Production git runner: real execFile('git', ...). */
const realGit: GitRunner = {
  async run(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    try {
      const { stdout } = await execFileAsync("git", args, { maxBuffer: 1024 * 1024 * 10 });
      return { ok: true, stdout, stderr: "" };
    } catch (err: any) {
      return { ok: false, stdout: err.stdout ?? "", stderr: err.stderr ?? err.message };
    }
  },
};

/** Module-level singleton for the injected subagent runner.
 *  Set by injectTeamRunner() once the provider is available. */
let activeRunner: RunSubagent | undefined;

/** Inject the real subagent runner (called from app.ts/cli.ts after provider init). */
export function injectTeamRunner(runner: RunSubagent): void {
  activeRunner = runner;
}

/**
 * Create the team tool. Uses the injected subagent runner when available
 * (set via injectTeamRunner after provider init); otherwise falls back to a
 * placeholder for standalone/test use.
 */
export function createTeamTool(projectRoot: string): ToolDef {
  return {
    name: "team",
    description:
      "Run multiple tasks in PARALLEL across isolated git worktrees. Each task gets its own " +
      "branch + working tree; results merge back sequentially; merge conflicts are reported. " +
      "Pass tasks as a JSON array: [{branch, prompt}, ...]. Use for independent subtasks that " +
      "don't depend on each other (e.g. 'fix test A' + 'fix test B' + 'add feature C'). " +
      "Requires a git repo. The subagent runner is the same one GSD uses.",
    parameters: {
      tasks: {
        type: "string",
        description:
          "JSON array of tasks: [{\"branch\":\"fix-a\",\"prompt\":\"fix test A\"},...]. " +
          "Each gets its own worktree.",
        required: true,
      },
    },
    execute: async (args): Promise<ToolResult> => {
      const tasksRaw = String(args.tasks ?? "").trim();
      if (!tasksRaw) {
        return { success: false, output: "", error: "team requires a 'tasks' JSON array." };
      }
      let tasks: TeamTask[];
      try {
        tasks = JSON.parse(tasksRaw);
      } catch (err) {
        return { success: false, output: "", error: `Invalid tasks JSON: ${err}` };
      }
      if (!Array.isArray(tasks) || tasks.length === 0) {
        return { success: false, output: "", error: "tasks must be a non-empty JSON array." };
      }

      try {
        const parentDir = join(projectRoot, ".sentinel", "worktrees");
        const wt = new WorktreeManager(projectRoot, realGit, parentDir);
        const ops = asWorktreeOps(wt);

        // Use the injected runner when available; otherwise placeholder.
        const runSubagent: RunSubagent = activeRunner ?? (async (prompt: string, worktreePath: string) => {
          return {
            ok: true,
            output: `[no subagent wired] Task for worktree ${worktreePath}: ${prompt.slice(0, 100)}`,
          };
        });

        const report = await runTeam(tasks, { runSubagent, worktree: ops });
        const lines = [
          `Team run complete: ${report.merged} merged, ${report.conflicts} conflicts, ${report.failed} failed.`,
          "",
          ...report.results.map((r) =>
            `${r.ok ? "✓" : "✗"} ${r.branch}: ${r.output ?? r.error ?? "(no output)"}${r.conflict ? " [CONFLICT]" : ""}`
          ),
        ];
        return { success: report.failed === 0, output: lines.join("\n") };
      } catch (err) {
        return { success: false, output: "", error: `team tool failed: ${String(err)}` };
      }
    },
  };
}
