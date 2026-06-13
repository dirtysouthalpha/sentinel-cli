import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { ToolDef, ToolResult } from "./types.js";
import { replaceLineBlock } from "./edit-match.js";

interface PatchOperation {
  oldText: string;
  newText: string;
}

export function createPatchTool(projectRoot: string): ToolDef {
  return {
    name: "patch",
    description: "Apply smart patches to files (find and replace blocks)",
    parameters: {
      path: { type: "string", description: "File path relative to project root", required: true },
      oldText: { type: "string", description: "Text to find (exact match)", required: true },
      newText: { type: "string", description: "Replacement text", required: true },
      all: { type: "boolean", description: "Replace all occurrences", default: false },
    },
    execute: async (args): Promise<ToolResult> => {
      try {
        const filePath = resolve(projectRoot, args.path as string);
        if (!filePath.startsWith(resolve(projectRoot))) {
          return { success: false, output: "", error: "Path traversal detected" };
        }

        if (!existsSync(filePath)) {
          return { success: false, output: "", error: `File not found: ${filePath}` };
        }

        const content = readFileSync(filePath, "utf-8");
        const oldText = args.oldText as string;
        const newText = args.newText as string;
        const replaceAll = args.all as boolean;

        if (!content.includes(oldText)) {
          // Exact substring missing — fall back to whitespace-tolerant line
          // matching (handles indentation drift), the same matcher the file
          // edit tool uses. Single-replace only; replaceAll stays exact.
          if (!replaceAll) {
            const r = replaceLineBlock(content, oldText, newText, false);
            if (r.ok) {
              writeFileSync(filePath, r.newContent, "utf-8");
              return { success: true, output: `Patched ${filePath} at line ${r.line} (whitespace-tolerant match)` };
            }
            return { success: false, output: "", error: r.error };
          }
          return { success: false, output: "", error: "Text not found in file" };
        }

        const count = content.split(oldText).length - 1;
        if (count > 1 && !replaceAll) {
          return {
            success: false,
            output: "",
            error: `Found ${count} occurrences. Use "all: true" to replace all, or provide more context for a unique match.`,
          };
        }

        const newContent = replaceAll
          ? content.split(oldText).join(newText)
          : content.replace(oldText, newText);

        writeFileSync(filePath, newContent, "utf-8");

        return {
          success: true,
          output: `Patched ${filePath} (${count} replacement${count > 1 ? "s" : ""})`,
        };
      } catch (err) {
        return { success: false, output: "", error: String(err) };
      }
    },
  };
}
