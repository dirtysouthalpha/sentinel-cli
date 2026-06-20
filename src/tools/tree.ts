/**
 * `tree` — directory tree viewer with file sizes + .gitignore respect.
 *
 * Renders the project directory as an indented tree. Reads .gitignore to
 * exclude build artifacts. Backed by the pure buildTree/formatTree helpers.
 */

import { ToolDef, ToolResult } from "./types.js";
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { buildTree, formatTree, parseGitignore, type FileEntry } from "../core/tree-builder.js";

export function createTreeTool(projectRoot: string): ToolDef {
  return {
    name: "tree",
    description:
      "Render the project directory as an indented tree with file sizes. " +
      "Respects .gitignore (excludes node_modules, dist, .git, etc). " +
      "Use to understand project structure at a glance. " +
      "Options: depth (default 3), path (subdirectory, default project root).",
    parameters: {
      path: {
        type: "string",
        description: "Subdirectory to tree (default: project root).",
      },
      depth: {
        type: "number",
        description: "Maximum depth (default: 3).",
      },
    },
    execute: async (args): Promise<ToolResult> => {
      const subPath = String(args.path ?? "").trim();
      const depth = Number(args.depth ?? 3);
      const targetDir = subPath ? join(projectRoot, subPath) : projectRoot;

      if (!existsSync(targetDir)) {
        return { success: false, output: "", error: `Directory not found: ${subPath || projectRoot}` };
      }

      try {
        // Read .gitignore patterns.
        let ignorePatterns = ["node_modules", ".git", "dist", ".next", ".vite"];
        const gitignorePath = join(projectRoot, ".gitignore");
        if (existsSync(gitignorePath)) {
          ignorePatterns = [...ignorePatterns, ...parseGitignore(readFileSync(gitignorePath, "utf-8"))];
        }

        // Walk the directory collecting entries.
        const entries: FileEntry[] = [];
        function walk(dir: string, currentDepth: number): void {
          if (currentDepth > depth) return;
          let items;
          try { items = readdirSync(dir, { withFileTypes: true }); } catch { return; }
          for (const item of items) {
            if (ignorePatterns.includes(item.name)) continue;
            const fullPath = join(dir, item.name);
            const relPath = relative(targetDir, fullPath).replace(/\\/g, "/");
            if (item.isDirectory()) {
              entries.push({ path: relPath, isDir: true, size: 0 });
              walk(fullPath, currentDepth + 1);
            } else {
              try {
                const stat = statSync(fullPath);
                entries.push({ path: relPath, isDir: false, size: stat.size });
              } catch { /* skip unreadable */ }
            }
          }
        }
        walk(targetDir, 0);

        const tree = buildTree(entries, ignorePatterns, depth);
        const output = formatTree(tree);
        const fileCount = entries.filter((e) => !e.isDir).length;
        return {
          success: true,
          output: `${subPath || "."} (${fileCount} files)\n${output}`,
        };
      } catch (err) {
        return { success: false, output: "", error: `tree failed: ${String(err)}` };
      }
    },
  };
}
