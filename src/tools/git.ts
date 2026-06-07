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
          { cwd: projectRoot, timeout: 15000 },
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
