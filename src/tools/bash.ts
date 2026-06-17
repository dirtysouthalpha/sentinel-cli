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
