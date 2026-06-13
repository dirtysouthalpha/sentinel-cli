import { ToolCall } from "../ai/types.js";

/**
 * Extract tool calls from assistant text content.
 *
 * Handles BOTH:
 *  - ```tool fenced JSON blocks -> parsed as { id?, name, arguments }
 *  - ```bash fenced blocks      -> { name: "bash", arguments: JSON.stringify({ command: body }) }
 *
 * Returns null if no tool calls were found.
 *
 * Ported verbatim from the TUI's TUIApp.extractToolCalls().
 */
export function extractToolCalls(content: string): ToolCall[] | null {
  if (!content) return null;
  const calls: ToolCall[] = [];
  const patterns: [RegExp, "tool" | "bash"][] = [
    // Accept ```tool and ```tool_call as aliases for a JSON tool call.
    [/```tool(?:_call)?\s*\n([\s\S]*?)```/g, "tool"],
    [/```bash\s*\n([\s\S]*?)```/g, "bash"],
  ];
  for (const [re, kind] of patterns) {
    let match;
    while ((match = re.exec(content)) !== null) {
      const body = match[1].trim();
      if (kind === "bash") {
        calls.push({
          id: `call_${calls.length}`,
          name: "bash",
          arguments: JSON.stringify({ command: body }),
        });
      } else {
        try {
          const parsed = JSON.parse(body);
          // Tolerate the common key variants models emit.
          const name = parsed.name ?? parsed.tool ?? parsed.tool_name;
          if (!name || typeof name !== "string") continue; // not a usable call
          const rawArgs = parsed.arguments ?? parsed.args ?? parsed.parameters ?? parsed.input ?? {};
          calls.push({
            id: parsed.id || `call_${calls.length}`,
            name,
            arguments: typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs),
          });
        } catch {
          // skip unparseable
        }
      }
    }
  }
  return calls.length > 0 ? calls : null;
}
