import { exec } from "child_process";
import { ToolDef, ToolResult } from "./types.js";

export function createGitTool(projectRoot: string): ToolDef {
  return {
    name: "git",
    description: "Git operations",
    parameters: {
      action: { type: "string", description: "Git command to run (status, log, diff, etc.)", required: true },
      args: { type: "string", description: "Additional arguments" },
    },
    execute: async (args): Promise<ToolResult> => {
      return new Promise((resolve) => {
        const action = args.action as string;
        const extraArgs = args.args ? ` ${args.args}` : "";
        const command = `git ${action}${extraArgs}`;

        exec(
          command,
          // 10MB buffer: the 1MB default makes `git diff`/`git log` on a real
          // repo fail with ENOBUFS. Downstream truncation bounds what reaches
          // the model.
          { cwd: projectRoot, timeout: 15000, maxBuffer: 10 * 1024 * 1024 },
          (error, stdout, stderr) => {
            if (error) {
              const e = error as Error & { killed?: boolean; signal?: string };
              if (e.killed && (e.signal === "SIGTERM" || e.signal === "SIGKILL")) {
                resolve({ success: false, output: stdout || "", error: "git command timed out after 15000ms." });
                return;
              }
              if (/maxBuffer/i.test(e.message)) {
                resolve({ success: false, output: stdout || "", error: "git output exceeded the 10MB buffer; narrow it (e.g. add a path, --stat, or -n)." });
                return;
              }
              resolve({ success: false, output: stdout || "", error: stderr || e.message });
            } else {
              resolve({ success: true, output: stdout, error: stderr || undefined });
            }
          }
        );
      });
    },
  };
}
