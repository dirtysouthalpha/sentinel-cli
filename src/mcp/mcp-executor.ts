import { ChatMessage, ToolCall } from "../ai/types.js";

/** Minimal host the executor needs — MCPManager satisfies this structurally. */
export interface McpToolHost {
  has(name: string): boolean;
  execute(name: string, args: Record<string, unknown>): Promise<string>;
}

/**
 * Wraps a base tool executor so that `mcp__<server>__<tool>` calls are dispatched
 * to the MCP host, and everything else falls through to the built-in executor.
 * Composes underneath the R2 guarded executor.
 */
export function createMcpAwareExecutor(
  mcp: McpToolHost,
  baseExecute: (tc: ToolCall) => Promise<ChatMessage>
): (tc: ToolCall) => Promise<ChatMessage> {
  return async (tc: ToolCall): Promise<ChatMessage> => {
    if (!mcp.has(tc.name)) return baseExecute(tc);

    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.arguments) as Record<string, unknown>;
    } catch {
      // empty args
    }
    const output = await mcp.execute(tc.name, args);
    return { role: "tool", content: output, toolCallId: tc.id, name: tc.name };
  };
}
