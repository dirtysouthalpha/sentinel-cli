import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

export interface ProjectContext {
  language: string;
  framework: string;
  dependencies: string[];
  scripts: Record<string, string>;
  conventions: string;
}

const CONVENTION_FILES = ["CLAUDE.md", "AGENTS.md", ".cursorrules"];
const CONVENTION_MAX_CHARS = 2000;


async function readJsonSafe<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function readFirstChars(path: string, max: number): Promise<string> {
  try {
    const raw = await readFile(path, "utf8");
    return raw.length > max ? raw.slice(0, max) + "\n... (truncated)" : raw;
  } catch {
    return "";
  }
}

export async function detectProjectContext(
  projectRoot: string
): Promise<ProjectContext> {
  const ctx: ProjectContext = {
    language: "",
    framework: "",
    dependencies: [],
    scripts: {},
    conventions: "",
  };

  // --- package.json / Node.js ---
  const pkg = await readJsonSafe<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  }>(join(projectRoot, "package.json"));

  if (pkg) {
    ctx.language = "Node.js";
    ctx.dependencies = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ];
    ctx.scripts = { ...(pkg.scripts ?? {}) };

    // Detect common frameworks
    const all = ctx.dependencies;
    if (all.includes("next")) ctx.framework = "Next.js";
    else if (all.includes("react")) ctx.framework = "React";
    else if (all.includes("vue")) ctx.framework = "Vue";
    else if (all.includes("express")) ctx.framework = "Express";
  }

  // --- TypeScript ---
  if (existsSync(join(projectRoot, "tsconfig.json"))) {
    if (ctx.language === "Node.js") ctx.language = "TypeScript/Node.js";
  }

  // --- Python ---
  if (ctx.language === "" && existsSync(join(projectRoot, "pyproject.toml"))) {
    ctx.language = "Python";
    const raw = await readFirstChars(
      join(projectRoot, "pyproject.toml"),
      2000
    );
    if (raw.includes("django")) ctx.framework = "Django";
    else if (raw.includes("fastapi")) ctx.framework = "FastAPI";
    else if (raw.includes("flask")) ctx.framework = "Flask";
  }

  // --- Rust ---
  if (ctx.language === "" && existsSync(join(projectRoot, "Cargo.toml"))) {
    ctx.language = "Rust";
  }

  // --- Conventions ---
  const conventionParts: string[] = [];
  for (const name of CONVENTION_FILES) {
    const content = await readFirstChars(
      join(projectRoot, name),
      CONVENTION_MAX_CHARS
    );
    if (content) {
      conventionParts.push(`## ${name}\n${content}`);
    }
  }
  ctx.conventions = conventionParts.join("\n\n");

  // --- .gitignore (noted, not read) ---
  // Presence recorded via conventions field suffix
  if (existsSync(join(projectRoot, ".gitignore"))) {
    if (ctx.conventions) ctx.conventions += "\n\n";
    ctx.conventions += "- .gitignore present";
  }

  return ctx;
}

export function formatProjectContext(ctx: ProjectContext): string {
  const parts: string[] = [`Language: ${ctx.language}`];
  if (ctx.framework) parts.push(`Framework: ${ctx.framework}`);
  if (ctx.dependencies.length) {
    parts.push(`Dependencies: ${ctx.dependencies.join(", ")}`);
  }
  const scriptKeys = Object.keys(ctx.scripts);
  if (scriptKeys.length) {
    parts.push(
      `Scripts:\n${scriptKeys.map((k) => `  ${k}: ${ctx.scripts[k]}`).join("\n")}`
    );
  }
  if (ctx.conventions) {
    parts.push(`Conventions:\n${ctx.conventions}`);
  }
  return parts.join("\n\n");
}

/**
 * Synchronous project context loader for backward compatibility.
 * Returns a short (<~1.5KB) human-readable summary from CLAUDE.md/AGENTS.md
 * and package.json. Used by system-prompt.ts.
 */
export function loadProjectContext(projectRoot: string): string {
  const sections: string[] = [];
  const MAX_LEN = 1500;
  const MAX_DOC_LINES = 15;

  for (const name of ["CLAUDE.md", "AGENTS.md"]) {
    try {
      const content = readFileSync(join(projectRoot, name), "utf8");
      if (content.trim()) {
        const excerpt = content.split(/\r?\n/).slice(0, MAX_DOC_LINES).join("\n").trim();
        sections.push(`## ${name} (excerpt)\n${excerpt}`);
      }
    } catch { /* not found */ }
  }

  try {
    const pkgRaw = readFileSync(join(projectRoot, "package.json"), "utf8");
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
  } catch { /* malformed or missing */ }

  if (sections.length === 0) return "";
  const out = `# Project Context\n${sections.join("\n\n")}`;
  return out.length > MAX_LEN ? out.slice(0, MAX_LEN) + "\n... (truncated)" : out;
}
