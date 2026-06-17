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

/**
 * `git config` is a persistent-backdoor vector: `--global` writes land in
 * ~/.gitconfig, and `alias.*` / `core.fsmonitor` / `url.*.insteadOf` can run
 * arbitrary commands or redirect fetches to an attacker host. Restrict it to
 * read-only forms (--get / --get-all / --list / --get-regexp with no value
 * operand and no --global/--system/--file). Anything that would mutate config
 * is rejected so a prompt-injected model can't plant a backdoor.
 */
const CONFIG_READ_FLAGS = new Set(["--get", "--get-all", "--get-regexp", "--list", "-l", "--get-urlmatch"]);
const CONFIG_WRITE_FLAGS = new Set(["--global", "--system", "--file", "-f", "--replace-all", "--unset", "--unset-all", "--add", "--rename-section", "--remove-section"]);

function isSafeConfigArgs(argTokens: string[]): boolean {
  // Any write-oriented flag disqualifies the call outright.
  if (argTokens.some((t) => CONFIG_WRITE_FLAGS.has(t))) return false;
  // A name+value pair (`config user.email x@y`) is a write. Read-only forms
  // carry a read flag; bare `config <name>` (get) is also accepted.
  // Distinguish by: if there is no read flag AND more than one positional
  // token, treat it as name=value write.
  const hasReadFlag = argTokens.some((t) => CONFIG_READ_FLAGS.has(t));
  if (hasReadFlag) {
    // Reject `--get <name> <value>` shapes that still carry a second positional.
    const positional = argTokens.filter((t) => !t.startsWith("-"));
    return positional.length <= 1;
  }
  // No read flag: allow only `config` alone or `config <name>` (implicit get).
  const positional = argTokens.filter((t) => !t.startsWith("-"));
  return positional.length <= 1;
}

/** Tokenize a shell-ish arg string, honoring single and double quotes. */
export function tokenizeArgs(input: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return tokens;
}

/**
 * Testable entry point for the `git config` guard: tokenize a raw arg string
 * and decide whether the invocation is read-only. Returns true for safe forms
 * (`--get`, `--list`, bare name lookup), false for anything that mutates.
 */
export function isSafeGitConfig(rawArgs: string): boolean {
  return isSafeConfigArgs(tokenizeArgs(rawArgs));
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

        // `git config` is restricted to read-only forms (see isSafeConfigArgs).
        if (action === "config" && !isSafeConfigArgs(extraArgs)) {
          resolve({
            success: false,
            output: "",
            error:
              'git config is restricted to read-only forms (e.g. `config --get <name>`, `config --list`). ' +
              "Mutating config (--global/--add/--unset/alias writes) is blocked to prevent persistent backdoors.",
          });
          return;
        }

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
