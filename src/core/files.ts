/**
 * File system utilities for TUI
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export async function getRepoFiles(root: string, options?: {
  maxDepth?: number;
  maxFiles?: number;
  ignoreDirs?: string[];
  ignoreExts?: string[];
}): Promise<string[]> {
  const {
    maxDepth = 3,
    maxFiles = 500,
    ignoreDirs = ["node_modules", ".git", "dist", "build", ".next", "target", "vendor"],
    ignoreExts = [".log", ".lock", ".cache"],
  } = options || {};

  const files: string[] = [];
  const queue: { path: string; depth: number }[] = [{ path: root, depth: 0 }];
  const ignoreDirSet = new Set(ignoreDirs);
  const ignoreExtSet = new Set(ignoreExts);

  while (queue.length > 0 && files.length < maxFiles) {
    const { path: currentPath, depth } = queue.shift()!;

    if (depth > maxDepth) continue;

    try {
      const entries = readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(currentPath, entry.name);
        const relativePath = fullPath.replace(root + (root.endsWith("/") ? "" : "/"), "");

        if (entry.isDirectory()) {
          if (!ignoreDirSet.has(entry.name)) {
            queue.push({ path: fullPath, depth: depth + 1 });
          }
        } else if (entry.isFile()) {
          const ext = entry.name.split(".").pop();
          if (!ext || !ignoreExtSet.has(`.${ext}`)) {
            files.push(relativePath);
          }
        }
      }
    } catch (err) {
      // Skip directories we can't read
    }
  }

  return files.sort();
}