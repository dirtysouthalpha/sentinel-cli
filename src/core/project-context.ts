import { readFileSync } from "node:fs";
import { join } from "node:path";

const MAX_LEN = 1500;
const MAX_DOC_LINES = 15;

/** Read a file, returning undefined if missing/unreadable (never throws). */
function tryRead(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** First N non-empty-trimmed lines of `text`, joined back together. */
function firstLines(text: string, n: number): string {
  return text.split(/\r?\n/).slice(0, n).join("\n").trim();
}

/**
 * Build a short (<~1.5KB) human-readable summary of a project for priming the
 * model: the head of CLAUDE.md / AGENTS.md when present, plus key fields from
 * package.json (name, version, scripts, dependency names). Missing files are
 * tolerated; the result is hard-capped in length. Returns "" when nothing of
 * note is found.
 */
export function loadProjectContext(projectRoot: string): string {
  const sections: string[] = [];

  for (const name of ["CLAUDE.md", "AGENTS.md"]) {
    const content = tryRead(join(projectRoot, name));
    if (content && content.trim()) {
      sections.push(`## ${name} (excerpt)\n${firstLines(content, MAX_DOC_LINES)}`);
    }
  }

  const pkgRaw = tryRead(join(projectRoot, "package.json"));
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
      const lines: string[] = [];
      if (pkg.name) lines.push(`name: ${String(pkg.name)}`);
      if (pkg.version) lines.push(`version: ${String(pkg.version)}`);
      const scripts = pkg.scripts;
      if (scripts && typeof scripts === "object") {
        const keys = Object.keys(scripts as Record<string, unknown>);
        if (keys.length) lines.push(`scripts: ${keys.join(", ")}`);
      }
      const deps = pkg.dependencies;
      if (deps && typeof deps === "object") {
        const keys = Object.keys(deps as Record<string, unknown>);
        if (keys.length) lines.push(`dependencies: ${keys.join(", ")}`);
      }
      if (lines.length) sections.push(`## package.json\n${lines.join("\n")}`);
    } catch {
      // malformed package.json — skip silently
    }
  }

  if (sections.length === 0) return "";

  const out = `# Project Context\n${sections.join("\n\n")}`;
  return out.length > MAX_LEN ? out.slice(0, MAX_LEN) + "\n... (truncated)" : out;
}
