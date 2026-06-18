import { readdirSync, statSync, existsSync } from "fs";
import { join, relative } from "path";

/**
 * Glob the project for @-mention autocomplete (D2). Recursive walk, skipping
 * noise directories (node_modules, .git, dist, build artifacts) and hidden
 * files, matching `query` as a substring (case-insensitive) against the
 * project-relative path. Capped to keep the popup useful. Pure + testable
 * (no network, deterministic for a given tree).
 */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".cache", "coverage", ".turbo", ".sentinel"]);

export function globProject(projectRoot: string, query: string, max = 50): string[] {
  if (!existsSync(projectRoot)) return [];
  const q = query.trim().toLowerCase();
  const out: string[] = [];
  let visited = 0;
  const cap = 4000; // hard wall on files scanned so a giant tree can't hang the server

  const walk = (dir: string): void => {
    if (out.length >= max || visited > cap) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as { name: string | Buffer; isDirectory: () => boolean; isFile: () => boolean }[];
    } catch {
      return; // permission denied, etc.
    }
    for (const entry of entries) {
      if (out.length >= max || visited > cap) return;
      const name = String(entry.name);
      if (name.startsWith(".") && name !== ".") continue;
      const full = join(dir, name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        walk(full);
      } else if (entry.isFile()) {
        visited++;
        const rel = relative(projectRoot, full).replace(/\\/g, "/");
        if (!q || rel.toLowerCase().includes(q)) out.push(rel);
      }
    }
  };

  walk(projectRoot);
  out.sort();
  return out.slice(0, max);
}
