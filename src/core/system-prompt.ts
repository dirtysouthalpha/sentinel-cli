import { agentRegistry } from "../agents/registry.js";

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
Rules: Do it. Don't ask. Be concise. Show results.`;

  return agentPrompt ? `${basePrompt}\n\n${agentPrompt}` : basePrompt;
}
