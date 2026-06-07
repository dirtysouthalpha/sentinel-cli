import { agentRegistry } from "../agents/registry.js";
import { loadProjectContext } from "./project-context.js";

/**
 * Build the system prompt for a given agent + project root.
 *
 * Replicates TUIApp.getSystemPrompt() exactly: the base YOLO prompt with the
 * agent's systemPrompt appended (when present). Shared by the TUI and the
 * headless command so both produce identical prompts.
 */
export function buildSystemPrompt(agentName: string, projectRoot: string): string {
  const agent = agentRegistry.get(agentName);
  const agentPrompt = agent?.systemPrompt || "";

  const basePrompt = `You are Sentinel CLI, an expert AI coding assistant.

Mode: ${agentName}
Project: ${projectRoot}

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
Rules: Do it. Don't ask. Be concise. Show results.`;

  // V2: prime the agent with a short, auto-loaded summary of the project
  // (CLAUDE.md/AGENTS.md head + package.json basics). Empty string when none.
  const projectContext = loadProjectContext(projectRoot);

  return [basePrompt, agentPrompt, projectContext].filter(Boolean).join("\n\n");
}
