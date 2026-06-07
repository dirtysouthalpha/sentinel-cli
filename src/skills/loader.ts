import { SkillDef, SkillLoaderResult } from "./types.js";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join, extname } from "path";
import { homedir } from "os";
import { resolveBuiltinDir } from "../utils/builtins.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger({ prefix: "skill-loader" });

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const fm: Record<string, unknown> = {};
  const lines = match[1].split("\n");
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    try {
      fm[key] = JSON.parse(value);
    } catch {
      fm[key] = value;
    }
  }

  return { frontmatter: fm, body: match[2] };
}

function loadSkillFromFile(filePath: string, source: SkillDef["source"]): SkillDef | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);

    return {
      name: (frontmatter.name as string) || filePath.replace(/\.\w+$/, ""),
      description: (frontmatter.description as string) || "",
      permissions: (frontmatter.permissions as Record<string, string>) || {},
      content: body.trim(),
      source,
      path: filePath,
    };
  } catch (err) {
    log.warn(`Failed to load skill from ${filePath}: ${err}`);
    return null;
  }
}

function loadSkillsFromDir(dir: string, source: SkillDef["source"]): SkillDef[] {
  const skills: SkillDef[] = [];
  if (!existsSync(dir)) return skills;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillFile = join(dir, entry.name, "SKILL.md");
        if (existsSync(skillFile)) {
          const skill = loadSkillFromFile(skillFile, source);
          if (skill) skills.push(skill);
        }
      } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".skill"))) {
        const skill = loadSkillFromFile(join(dir, entry.name), source);
        if (skill) skills.push(skill);
      }
    }
  } catch (err) {
    log.warn(`Failed to read skills directory ${dir}: ${err}`);
  }

  return skills;
}

export function loadAllSkills(projectRoot: string, skillPaths: string[]): SkillLoaderResult {
  const skills: SkillDef[] = [];
  const errors: string[] = [];

  const builtinDir = resolveBuiltinDir(projectRoot, "skills");
  skills.push(...loadSkillsFromDir(builtinDir, "builtin"));

  const projectDirs = [
    join(projectRoot, ".sentinel", "skills"),
    join(projectRoot, ".kilo", "skills"),
    join(projectRoot, ".opencode", "skills"),
  ];

  for (const dir of projectDirs) {
    skills.push(...loadSkillsFromDir(dir, "project"));
  }

  for (const path of skillPaths) {
    const expanded = path.startsWith("~") ? join(homedir(), path.slice(1)) : path;
    skills.push(...loadSkillsFromDir(expanded, "global"));
  }

  log.info(`Loaded ${skills.length} skills`);
  return { skills, errors };
}

export { loadSkillFromFile, loadSkillsFromDir, parseFrontmatter };
