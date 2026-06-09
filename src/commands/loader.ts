import { CommandDef, ParsedCommand } from "./types.js";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { resolveBuiltinDir } from "../utils/builtins.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger({ prefix: "cmd-loader" });

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const fm: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    try { fm[key] = JSON.parse(val); } catch { fm[key] = val; }
  }
  return { frontmatter: fm, body: match[2] };
}

function loadCommandFromFile(filePath: string, source: CommandDef["source"]): CommandDef | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);
    const name = filePath.split(/[\\/]/).pop()?.replace(/\.\w+$/, "") || "unknown";
    return {
      name: (frontmatter.name as string) || name,
      description: (frontmatter.description as string) || "",
      agent: frontmatter.agent as string | undefined,
      model: frontmatter.model as string | undefined,
      subtask: frontmatter.subtask as boolean | undefined,
      template: body.trim(),
      source,
      path: filePath,
    };
  } catch (err) {
    log.warn(`Failed to load command from ${filePath}: ${err}`);
    return null;
  }
}

export function loadCommandsFromDir(dir: string, source: CommandDef["source"]): CommandDef[] {
  const commands: CommandDef[] = [];
  if (!existsSync(dir)) return commands;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".cmd"))) {
        const cmd = loadCommandFromFile(join(dir, entry.name), source);
        if (cmd) commands.push(cmd);
      }
    }
  } catch (err) {
    log.warn(`Failed to read commands from ${dir}: ${err}`);
  }
  return commands;
}

export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return { name: "", args: [trimmed], raw: trimmed };

  const parts = trimmed.slice(1).split(/\s+/);
  const name = parts[0] || "";
  const args = parts.slice(1);
  return { name, args, raw: trimmed };
}

export function resolveTemplate(template: string, args: string[]): string {
  let result = template;
  result = result.replace(/\$ARGUMENTS/g, args.join(" "));
  args.forEach((arg, i) => {
    result = result.replace(new RegExp(`\\$${i + 1}`, "g"), arg);
  });
  return result;
}

export function loadAllCommands(projectRoot: string): CommandDef[] {
  const commands: CommandDef[] = [];
  const builtinDir = resolveBuiltinDir(projectRoot, "commands");
  commands.push(...loadCommandsFromDir(builtinDir, "builtin"));
  commands.push(...loadCommandsFromDir(join(projectRoot, ".sentinel", "commands"), "project"));
  log.info(`Loaded ${commands.length} commands`);
  return commands;
}
