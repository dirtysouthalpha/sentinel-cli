/**
 * File tree builder — pure helpers for the 'tree' tool.
 *
 * buildTree takes a flat list of file entries and builds a nested tree.
 * formatTree renders it with └── ├── connectors + file sizes.
 * parseGitignore + shouldIgnore handle .gitignore filtering.
 *
 * Pure: no filesystem I/O — the caller (the tool) reads the dir and passes
 * entries in. This keeps the tree logic fully testable.
 */

export interface FileEntry {
  path: string;
  isDir: boolean;
  size: number;
}

export interface TreeNode {
  name: string;
  isDir: boolean;
  size: number;
  children: TreeNode[];
}

/** Parse .gitignore content into a list of patterns. */
export function parseGitignore(content: string): string[] {
  return content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

/** Check if a path/name matches any gitignore-style pattern. */
export function shouldIgnore(name: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    if (p.includes("*")) {
      // Convert glob to regex: *.log → ^.*\.log$
      const re = new RegExp("^" + p.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
      return re.test(name);
    }
    return name === p || name.startsWith(p + "/");
  });
}

/** Build a nested tree from a flat list of file entries. */
export function buildTree(entries: FileEntry[], ignorePatterns: string[] = [], maxDepth = 10): TreeNode {
  const root: TreeNode = { name: ".", isDir: true, size: 0, children: [] };

  for (const entry of entries) {
    const parts = entry.path.split("/");
    // Truncate to maxDepth (show partial tree, skip deep children).
    const visibleParts = parts.slice(0, maxDepth);
    if (visibleParts.length === 0) continue;

    // Check if any path component is ignored.
    if (visibleParts.some((p) => shouldIgnore(p, ignorePatterns))) continue;

    let current = root;
    for (let i = 0; i < visibleParts.length; i++) {
      const name = visibleParts[i];
      const isLast = i === visibleParts.length - 1;
      const depth = i + 1;

      let child = current.children.find((c) => c.name === name);
      if (!child) {
        child = { name, isDir: !isLast || entry.isDir, size: isLast ? entry.size : 0, children: [] };
        current.children.push(child);
      }
      if (isLast && depth <= maxDepth) child.size = entry.size;
      current = child;
    }
  }

  // Sort: dirs first, then alphabetical.
  sortTree(root);
  return root;
}

function sortTree(node: TreeNode): void {
  node.children.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of node.children) sortTree(child);
}

/** Format bytes as a human-readable size. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** Render a tree as indented text with └── ├── connectors. */
export function formatTree(node: TreeNode, prefix = "", isLast = true, isRoot = true): string {
  const lines: string[] = [];
  if (isRoot) {
    lines.push(node.name + "/");
  } else {
    const connector = isLast ? "└── " : "├── ";
    const label = node.isDir ? `${node.name}/` : `${node.name}  ${formatSize(node.size)}`;
    lines.push(prefix + connector + label);
  }

  const childPrefix = isRoot ? "" : prefix + (isLast ? "    " : "│   ");
  node.children.forEach((child, i) => {
    lines.push(formatTree(child, childPrefix, i === node.children.length - 1, false));
  });

  return lines.join("\n");
}
