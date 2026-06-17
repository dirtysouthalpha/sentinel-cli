import { AgentDef } from "./types.js";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { resolveBuiltinDir } from "../utils/builtins.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger({ prefix: "agent-loader" });

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

function loadAgentFromFile(filePath: string, source: AgentDef["source"]): AgentDef | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);
    const name = filePath.split(/[\\/]/).pop()?.replace(/\.\w+$/, "") || "unknown";
    return {
      name: (frontmatter.name as string) || name,
      description: (frontmatter.description as string) || "",
      mode: (frontmatter.mode as AgentDef["mode"]) || "primary",
      model: frontmatter.model as string | undefined,
      steps: frontmatter.steps as number | undefined,
      color: frontmatter.color as string | undefined,
      permissions: frontmatter.permissions as Record<string, unknown> | undefined,
      systemPrompt: body.trim(),
      source,
      path: filePath,
    };
  } catch (err) {
    log.warn(`Failed to load agent from ${filePath}: ${err}`);
    return null;
  }
}

export function loadAgentsFromDir(dir: string, source: AgentDef["source"]): AgentDef[] {
  const agents: AgentDef[] = [];
  if (!existsSync(dir)) return agents;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".agent"))) {
        const agent = loadAgentFromFile(join(dir, entry.name), source);
        if (agent) agents.push(agent);
      }
    }
  } catch (err) {
    log.warn(`Failed to read agents from ${dir}: ${err}`);
  }
  return agents;
}

export function loadAllAgents(projectRoot: string): AgentDef[] {
  const agents: AgentDef[] = [];
  const builtinDir = resolveBuiltinDir(projectRoot, "agents");
  agents.push(...loadAgentsFromDir(builtinDir, "builtin"));
  agents.push(...loadAgentsFromDir(join(projectRoot, ".sentinel", "agents"), "project"));
  log.info(`Loaded ${agents.length} agents`);
  return agents;
}
