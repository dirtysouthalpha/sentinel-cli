import { execFile } from "child_process";
import { ToolDef, ToolResult } from "./types.js";

/**
 * Git subcommands this tool is willing to run. The `args` string is tokenized
 * and passed to `execFile` (no shell), so even with the allow-list there is no
 * command-injection surface — an `action` like `status; rm -rf ~` simply fails
 * the allow-list check, and shell metacharacters in `args` are inert.
 */
const ALLOWED_ACTIONS = new Set([
  "status", "log", "diff", "show", "branch", "add", "commit", "fetch", "pull",
  "push", "remote", "stash", "tag", "rev-parse", "ls-files", "ls-remote",
  "blame", "describe", "config", "init", "checkout", "switch", "restore",
  "reset", "merge", "rebase", "cherry-pick", "clean", "shortlog", "reflog",
  "worktree", "whatchanged", "grep", "cat-file", "symbolic-ref", "show-ref",
  "rev-list", "for-each-ref", "name-rev", "count-objects", "fsck",
]);

/** Tokenize a shell-ish arg string, honoring single and double quotes. */
function tokenizeArgs(input: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return tokens;
}

export function createGitTool(projectRoot: string): ToolDef {
  return {
    name: "git",
    description: "Git operations",
    parameters: {
      action: { type: "string", description: "Git subcommand to run (status, log, diff, etc.)", required: true },
      args: { type: "string", description: "Additional arguments" },
    },
    execute: async (args): Promise<ToolResult> => {
      return new Promise((resolve) => {
        const action = String(args.action ?? "").trim();

        if (!ALLOWED_ACTIONS.has(action)) {
          resolve({
            success: false,
            output: "",
            error: `Git subcommand not allowed: "${action}". Allowed: ${Array.from(ALLOWED_ACTIONS).join(", ")}`,
          });
          return;
        }

        const extraArgs = args.args ? tokenizeArgs(String(args.args)) : [];

        execFile(
          "git",
          [action, ...extraArgs],
          { cwd: projectRoot, timeout: 15000, maxBuffer: 5 * 1024 * 1024 },
          (error, stdout, stderr) => {
            if (error) {
              resolve({ success: false, output: stdout || "", error: stderr || error.message });
            } else {
              resolve({ success: true, output: stdout, error: stderr || undefined });
            }
          }
        );
      });
    },
  };
}
