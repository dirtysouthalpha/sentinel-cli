import { execFile } from "child_process";
import { readdirSync, statSync, existsSync } from "fs";
import { join, resolve } from "path";
import { ToolDef, ToolResult } from "./types.js";

function searchGlob(root: string, pattern: string, maxResults: number = 100): string[] {
  const results: string[] = [];

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
      // Pass the user-controlled pattern/include/root via environment variables
      // and reference them as $env:* inside the script. PowerShell treats env
      // values as literal strings, so there is no code-injection surface (unlike
      // string-interpolating them into the command text).
      const includeFilter = include ? "-Include $env:SENTINEL_INCLUDE" : "";
      const script = `Get-ChildItem -Path $env:SENTINEL_ROOT -Recurse ${includeFilter} -File -ErrorAction SilentlyContinue | Select-String -Pattern $env:SENTINEL_PATTERN | Select-Object -First ${maxResults} | ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line)" }`;

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        SENTINEL_ROOT: root,
        SENTINEL_PATTERN: pattern,
      };
      if (include) env.SENTINEL_INCLUDE = include;

      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { cwd: root, timeout: 15000, maxBuffer: 5 * 1024 * 1024, env },
        (error, stdout) => {
          resolve(stdout || "No results found");
        }
      );
    } else {
      // execFile with an argv array — no shell, so pattern/include/root cannot
      // be interpreted as shell syntax. `--` terminates option parsing so a
      // pattern beginning with `-` is treated as a pattern, not a flag.
      const grepArgs = ["-rnI"];
      if (include) grepArgs.push(`--include=${include}`);
      grepArgs.push("-E", "--", pattern, root);

      execFile(
        "grep",
        grepArgs,
        { cwd: root, timeout: 15000, maxBuffer: 5 * 1024 * 1024 },
        (error, stdout) => {
          // grep exits 1 when there are no matches — not an error for us.
          const lines = (stdout || "").split("\n").filter(Boolean).slice(0, maxResults);
          resolve(lines.length > 0 ? lines.join("\n") : "No results found");
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
