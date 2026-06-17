import { exec } from "child_process";
import { resolve, isAbsolute } from "path";
import { ToolDef, ToolResult } from "./types.js";
import { runSandboxed, sandboxAvailable } from "./sandbox.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger({ prefix: "tools:bash" });

export interface BashToolOptions {
  /**
   * Run commands inside a bubblewrap sandbox (Linux + bwrap only): filesystem
   * confined to the project root, network blocked. Opt-in. When bwrap is
   * unavailable the tool logs once and falls back to unsandboxed execution
   * rather than failing every command.
   */
  sandbox?: boolean;
  /** When sandboxed, allow network (e.g. for installs/fetches). Default false. */
  sandboxAllowNetwork?: boolean;
}

export function createBashTool(projectRoot: string, opts: BashToolOptions = {}): ToolDef {
  const wantSandbox = !!opts.sandbox;
  const sandboxWorks = wantSandbox && sandboxAvailable();
  if (wantSandbox && !sandboxWorks) {
    log.warn("sandbox requested but bwrap is unavailable; running commands unsandboxed");
  }

  return {
    name: "bash",
    description: "Execute shell commands (PowerShell on Windows, bash on Unix)",
    parameters: {
      command: { type: "string", description: "Shell command to execute", required: true },
      timeout: { type: "number", description: "Timeout in milliseconds", default: 60000 },
      cwd: { type: "string", description: "Working directory" },
    },
    execute: async (args): Promise<ToolResult> => {
      const command = args.command as string;
      const timeout = (args.timeout as number) || 60000;
      const cwdArg = (args.cwd as string) || projectRoot;

      // Sandboxed path: run via bwrap on Linux. The command is passed to the
      // shell inside the sandbox so pipelines/globs still work; the namespace
      // isolation is what provides the blast-radius floor.
      if (sandboxWorks) {
        try {
          // Validate cwd stays within the project so a model can't escape the
          // bind mount by asking for a different working dir.
          const cwd = ensureWithin(cwdArg, projectRoot);
          const res = await runSandboxed(
            ["sh", "-c", command],
            { projectRoot, cwd, allowNetwork: opts.sandboxAllowNetwork },
            timeout
          );
          return {
            success: res.ok,
            output: res.stdout || "",
            error: res.ok ? (res.stderr || undefined) : (res.stderr || `exited ${res.exitCode ?? "?"}`),
          };
        } catch (err) {
          // A rejected cwd (escape attempt) or a bwrap failure should surface as
          // a clean tool error the model can react to, not an unhandled throw.
          return {
            success: false,
            output: "",
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }

      // Default unsandboxed path (unchanged behavior).
      return new Promise((resolve) => {
        const isWindows = process.platform === "win32";
        const shell = isWindows ? "powershell.exe" : undefined;
        exec(
          command,
          { cwd: cwdArg, timeout, maxBuffer: 10 * 1024 * 1024, shell },
          (error, stdout, stderr) => {
            if (error) {
              resolve({
                success: false,
                output: stdout || "",
                error: stderr || error.message,
              });
            } else {
              resolve({
                success: true,
                output: stdout,
                error: stderr || undefined,
              });
            }
          }
        );
      });
    },
  };
}

/** Resolve cwd and confirm it's inside the project root (sandbox escape guard). */
function ensureWithin(cwd: string, projectRoot: string): string {
  const root = resolve(projectRoot);
  const abs = isAbsolute(cwd) ? resolve(cwd) : resolve(root, cwd);
  if (abs !== root && !abs.startsWith(root + "/") && !abs.startsWith(root + "\\")) {
    throw new Error(`Working directory outside project root is blocked in sandbox mode: ${cwd}`);
  }
  return abs;
}
