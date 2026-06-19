import { agentRegistry } from "../agents/registry.js";
import { loadProjectContext } from "./project-context.js";
import { skillRegistry } from "../skills/registry.js";
import { getConfigManager } from "./config.js";
import { normalizePonytailConfig, resolvePonytailSection } from "./ponytail.js";

/**
 * Build the system prompt for a given agent + project root.
 *
 * Replicates TUIApp.getSystemPrompt() exactly: the base YOLO prompt with the
 * agent's systemPrompt appended (when present). Shared by the TUI and the
 * headless command so both produce identical prompts.
 *
 * Ponytail (lazy-senior-dev discipline) is appended last, when enabled — by
 * default it's on at "ultra", so the YAGNI ladder governs every response.
 */
export function buildSystemPrompt(agentName: string, projectRoot: string): string {
  const agent = agentRegistry.get(agentName);
  const agentPrompt = agent?.systemPrompt || "";

  const basePrompt = `You are Sentinel CLI, an expert AI coding assistant.

Mode: ${agentName}
Project: ${projectRoot}
Platform: ${process.platform} — the bash tool runs ${process.platform === "win32" ? "PowerShell; use PowerShell syntax (Get-ChildItem, not cmd dir/find)" : "bash"}.

YOLO MODE - Execute everything automatically:
- READ files before editing
- SEARCH before making changes
- RUN commands to test
- PATCH files directly
- VERIFY with builds/tests
- FIX errors immediately

Tools: file, bash, search, git, web, patch
Orchestration:
- todo_write: for any multi-step task, write a todo list first, keep exactly one item in_progress, and mark items completed as you finish them.
- subagent: delegate a self-contained sub-task (focused research, a scoped edit, a review) to an isolated agent; use it to keep your own context clean.
- Plan mode (read-only): if edits/commands are denied with a "plan mode" reason, STOP acting — research and reply with a concise, ordered plan instead.

Self-reliance — DON'T GET STUCK. Figure it out:
- Missing a capability? Use \`create_skill\` to write a reusable procedure (.md in .sentinel/skills) that captures the workaround. Future turns and sessions can invoke it.
- Hit an error you don't understand? Use \`web\`/\`search\` to look it up, read the docs, then apply the fix. Surface the fix as a skill if it'll recur.
- Need the user to sign in / grant OAuth / visit a page their browser session owns? Use \`open_url\` to open it in their REAL browser (headless can't do 2FA/password-manager logins).
- Repeatable sub-task with no tool? Author the skill; don't stop and ask. Ask the user ONLY for secrets, destructive irreversible actions, or genuine ambiguity you can't resolve from the code.

Rules: Do it. Don't ask. Be concise. Show results. When you unblock yourself, note how.`;

  // V2: prime the agent with a short, auto-loaded summary of the project
  // (CLAUDE.md/AGENTS.md head + package.json basics). Empty string when none.
  const projectContext = loadProjectContext(projectRoot);

  // Ponytail discipline — default on at "ultra". Normalizes defensively so a
  // malformed config never breaks the prompt. Skill body comes from the
  // registry (loaded at startup); if it's missing we inject nothing and the
  // rest of the prompt is unaffected.
  const ponytailCfg = normalizePonytailConfig(getConfigManager(projectRoot).getAll().ponytail);
  const ponytailBody = skillRegistry.get("ponytail")?.content;
  const ponytailSection = resolvePonytailSection(ponytailCfg, ponytailBody);

  return [basePrompt, agentPrompt, projectContext, ponytailSection]
    .filter(Boolean)
    .join("\n\n");
}
