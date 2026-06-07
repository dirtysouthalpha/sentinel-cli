import { ChatMessage, ToolCall, contentToText } from "../ai/types.js";

/** Default Sentinel Prime brain-recall tool name (MCP-namespaced). */
export const DEFAULT_RECALL_TOOL = "mcp__sentinel-prime__brain_recall";

export interface RecallRelevantOptions {
  /** Override the MCP tool name to call. Defaults to {@link DEFAULT_RECALL_TOOL}. */
  toolName?: string;
  /** Override the ToolCall id. Defaults to "recall_1". */
  id?: string;
}

/**
 * Asks the Sentinel Prime brain for memory relevant to `userMessage` by invoking
 * the `mcp__sentinel-prime__brain_recall` tool through the provided executor.
 *
 * Pure + side-effect-free aside from the injected `executeTool` call, so it is
 * trivially testable with a fake executor.
 *
 * @returns A formatted block to splice into the prompt, or "" when there is no
 *          usable memory (empty result, whitespace-only, or an ERROR result).
 */
export async function recallRelevant(
  executeTool: (tc: ToolCall) => Promise<ChatMessage>,
  userMessage: string,
  opts?: RecallRelevantOptions
): Promise<string> {
  const toolCall: ToolCall = {
    id: opts?.id ?? "recall_1",
    name: opts?.toolName ?? DEFAULT_RECALL_TOOL,
    arguments: JSON.stringify({ query: userMessage }),
  };

  const result = await executeTool(toolCall);
  const content = contentToText(result?.content ?? "").trim();

  if (content.length === 0) return "";
  if (content.startsWith("ERROR")) return "";

  return `\n\n--- Relevant memory (Sentinel Prime brain) ---\n${content}`;
}
