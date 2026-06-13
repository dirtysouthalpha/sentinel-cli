import { exec } from "child_process";
import { ToolDef, ToolResult } from "./types.js";

export function createBashTool(projectRoot: string): ToolDef {
  return {
    name: "bash",
    description: "Execute shell commands (PowerShell on Windows, bash on Unix)",
    parameters: {
      command: { type: "string", description: "Shell command to execute", required: true },
      timeout: { type: "number", description: "Timeout in milliseconds", default: 60000 },
      cwd: { type: "string", description: "Working directory" },
    },
    execute: async (args): Promise<ToolResult> => {
      return new Promise((resolve) => {
        const command = args.command as string;
        const timeout = (args.timeout as number) || 60000;
        const cwd = (args.cwd as string) || projectRoot;

        const isWindows = process.platform === "win32";
        const shell = isWindows ? "powershell.exe" : undefined;

        exec(
          command,
          { cwd, timeout, maxBuffer: 10 * 1024 * 1024, shell },
          (error, stdout, stderr) => {
            if (error) {
              const e = error as Error & { killed?: boolean; signal?: string; code?: number | string };

              // Timeout: exec kills the child and surfaces a generic "Command
              // failed". Say so plainly so the agent can shorten/adjust.
              if (e.killed && (e.signal === "SIGTERM" || e.signal === "SIGKILL")) {
                resolve({
                  success: false,
                  output: stdout || "",
                  error: `Command timed out after ${timeout}ms. Partial output (if any) is above; narrow the work or raise the timeout.`,
                });
                return;
              }

              // Output exceeded maxBuffer: return what we captured with a clear note.
              if (/maxBuffer/i.test(e.message)) {
                resolve({
                  success: false,
                  output: stdout || "",
                  error: "Output exceeded the 10MB buffer. Narrow the command (filter, head / Select-Object -First, or redirect to a file).",
                });
                return;
              }

              const exit = typeof e.code === "number" ? ` (exit ${e.code})` : "";
              resolve({
                success: false,
                output: stdout || "",
                error: (stderr || e.message) + exit,
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
