import { exec, execFile } from "child_process";
import { readdirSync, statSync, existsSync } from "fs";
import { join, resolve } from "path";
import { ToolDef, ToolResult } from "./types.js";

function searchGlob(root: string, pattern: string, maxResults: number = 100): string[] {
  const results: string[] = [];
  const parts = pattern.split("*");

  function walk(dir: string, depth: number): void {
    if (results.length >= maxResults || depth > 15) return;
    if (!existsSync(dir)) return;

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxResults) return;
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (entry.isFile()) {
          if (matchGlob(entry.name, pattern)) {
            results.push(fullPath);
          }
        }
      }
    } catch {
      // skip inaccessible dirs
    }
  }

  walk(root, 0);
  return results;
}

function matchGlob(name: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${regexStr}$`, "i").test(name);
}

async function searchGrep(root: string, pattern: string, include?: string, maxResults: number = 100): Promise<string> {
  return new Promise<string>((resolve) => {
    const isWindows = process.platform === "win32";

    if (isWindows) {
      // Single-quote every interpolated value. In PowerShell, single-quoted
      // strings are literal (no $() expansion, no quote break-out); the only
      // escape needed is doubling an embedded '. This makes the pattern data,
      // not code — closing the previous "${pattern}" injection hole.
      const sq = (s: string) => `'${s.replace(/'/g, "''")}'`;
      const includeFilter = include ? `-Include ${sq(include)}` : "";
      const cmd = `Get-ChildItem -Path ${sq(root)} -Recurse ${includeFilter} -File -ErrorAction SilentlyContinue | Select-String -Pattern ${sq(pattern)} | Select-Object -First ${maxResults} | ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line)" }`;

      exec(
        cmd,
        { cwd: root, timeout: 15000, shell: "powershell.exe", maxBuffer: 5 * 1024 * 1024 },
        (error, stdout) => {
          if (error) {
            resolve(`Search error: ${error.message}`);
          } else {
            resolve(stdout || "No results found");
          }
        }
      );
    } else {
      // execFile with an argv array runs grep directly (no shell), so the
      // pattern and path can't be interpreted as shell syntax. We slice to
      // maxResults in JS instead of piping to `head`.
      const argv = ["-rnE"];
      if (include) argv.push(`--include=${include}`);
      argv.push(pattern, root);
      execFile(
        "grep",
        argv,
        { cwd: root, timeout: 15000, maxBuffer: 5 * 1024 * 1024 },
        (error, stdout) => {
          if (error && (error as NodeJS.ErrnoException & { code?: number }).code !== 1) {
            // grep exits 1 when there are no matches — not a real error.
            resolve(`Search error: ${error.message}`);
          } else {
            const lines = (stdout || "").split("\n").filter(Boolean).slice(0, maxResults);
            resolve(lines.length ? lines.join("\n") : "No results found");
          }
        }
      );
    }
  });
}

export function createSearchTool(projectRoot: string): ToolDef {
  return {
    name: "search",
    description: "Search code using grep or glob patterns (Windows + Unix)",
    parameters: {
      pattern: { type: "string", description: "Search pattern (regex supported)", required: true },
      type: { type: "string", description: "grep|glob", default: "grep" },
      include: { type: "string", description: "File pattern to include (e.g. *.ts)" },
      path: { type: "string", description: "Subdirectory to search in" },
    },
    execute: async (args): Promise<ToolResult> => {
      const pattern = args.pattern as string;
      const type = (args.type as string) || "grep";
      const include = args.include as string | undefined;
      const searchPath = args.path
        ? resolve(projectRoot, args.path as string)
        : projectRoot;

      try {
        if (type === "glob") {
          const results = searchGlob(searchPath, pattern);
          return {
            success: true,
            output: results.length > 0 ? results.join("\n") : "No files found matching pattern",
            data: results,
          };
        }

        const output = await searchGrep(searchPath, pattern, include);
        return { success: true, output };
      } catch (err) {
        return { success: false, output: "", error: String(err) };
      }
    },
  };
}
