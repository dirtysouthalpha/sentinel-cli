import { AIProvider, ChatMessage, ToolCall, ToolDef } from "../ai/types.js";
import { AgentRunner, ContextManagerLike } from "./agent-runner.js";

/**
 * Subagents (V1 orchestration core). The model can delegate a focused sub-task to
 * an isolated agent that runs its own bounded agentic loop with a FRESH context,
 * then returns only its final answer to the parent. This keeps the parent's
 * context clean (the subagent's intermediate tool churn never pollutes it) and
 * lets specialized work (research, a self-contained edit, a review) be farmed out.
 *
 * Layering mirrors the MCP executor: `createSubagentAwareExecutor` wraps the base
 * tool executor and intercepts the `subagent` tool; everything else passes through.
 */

export const SUBAGENT_TOOL_NAME = "subagent";

/** Array-backed context so each subagent run is fully isolated from the parent. */
class IsolatedContext implements ContextManagerLike {
  private systemPrompt = "";
  private messages: { role: "user" | "assistant" | "tool"; content: string; metadata?: Record<string, unknown> }[] = [];

  setSystemPrompt(p: string): void {
    this.systemPrompt = p;
  }

  addMessage(role: "user" | "assistant" | "tool", content: string, metadata?: Record<string, unknown>): void {
    this.messages.push({ role, content, metadata });
  }

  getMessageCount(): number {
    return this.messages.length;
  }

  getTotalTokens(): number {
    const chars = this.messages.reduce((n, m) => n + m.content.length, 0) + this.systemPrompt.length;
    return Math.ceil(chars / 3.5);
  }

  // Mirror ContextManager.toAIMessages so tool-call linkage stays provider-correct.
  toAIMessages(): ChatMessage[] {
    const out: ChatMessage[] = [];
    if (this.systemPrompt) out.push({ role: "system", content: this.systemPrompt });
    for (const msg of this.messages) {
      const m: ChatMessage = { role: msg.role, content: msg.content };
      const md = msg.metadata;
      if (md) {
        if (md.toolCalls) m.toolCalls = md.toolCalls as ToolCall[];
        if (md.toolCallId) m.toolCallId = md.toolCallId as string;
        if (md.name) m.name = md.name as string;
      }
      out.push(m);
    }
    return out;
  }
}

export interface SubagentDeps {
  provider: AIProvider;
  /** Tools the child may use. The caller should pass the toolset WITHOUT the
   *  subagent tool to bound nesting depth to one level. */
  toolDefs: ToolDef[];
  /** Guarded executor for the child's tool calls (permissions still apply). */
  executeTool: (tc: ToolCall) => Promise<ChatMessage>;
  extractToolCalls: (content: string) => ToolCall[] | null;
  model?: string;
  /** Base system prompt fragment; the subagent framing is appended to it. */
  systemPrompt?: string;
  maxRounds?: number;
}

const DEFAULT_SUBAGENT_PROMPT =
  "You are a focused subagent spawned by a parent agent. You have your own isolated " +
  "context and a bounded number of rounds. Complete ONLY the delegated task, use tools " +
  "as needed, and end with a concise, self-contained answer the parent can act on. Do " +
  "not ask the parent questions — make reasonable assumptions and state them.";

export interface SubagentToolHandle {
  def: ToolDef;
  /** Runs the subagent for a parsed `{ task, context? }` and returns its final text. */
  execute: (args: Record<string, unknown>) => Promise<string>;
}

/** Build the `subagent` tool definition + executor from the parent's deps. */
export function createSubagentTool(deps: SubagentDeps): SubagentToolHandle {
  const def: ToolDef = {
    type: "function",
    function: {
      name: SUBAGENT_TOOL_NAME,
      description:
        "Delegate a focused sub-task to an isolated subagent that runs its own agentic " +
        "loop with a fresh context and returns only its final result. Use for self-contained " +
        "research, a scoped edit, or a review — anything that would otherwise clutter your context. " +
        "The subagent cannot spawn further subagents.",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "The complete, self-contained task for the subagent to perform." },
          context: { type: "string", description: "Optional background the subagent needs (paths, constraints, prior findings)." },
        },
        required: ["task"],
      },
    },
  };

  const execute = async (args: Record<string, unknown>): Promise<string> => {
    const task = typeof args.task === "string" ? args.task.trim() : "";
    if (!task) return "ERROR: subagent requires a non-empty 'task'.";
    const extra = typeof args.context === "string" && args.context.trim() ? `\n\nContext:\n${args.context.trim()}` : "";

    const context = new IsolatedContext();
    const sys = deps.systemPrompt ? `${deps.systemPrompt}\n\n${DEFAULT_SUBAGENT_PROMPT}` : DEFAULT_SUBAGENT_PROMPT;
    context.setSystemPrompt(sys);

    const runner = new AgentRunner(
      {
        provider: deps.provider,
        context,
        toolDefs: deps.toolDefs,
        executeTool: deps.executeTool,
        extractToolCalls: deps.extractToolCalls,
      },
      { model: deps.model, maxRounds: deps.maxRounds ?? 10 }
    );

    const result = await runner.run(`${task}${extra}`);
    const out = result.finalContent?.trim() || "(subagent produced no output)";
    const suffix =
      result.stopReason === "max_rounds"
        ? "\n\n[subagent hit its round limit; result may be incomplete]"
        : result.stopReason === "error"
          ? "\n\n[subagent errored before finishing]"
          : "";
    return out + suffix;
  };

  return { def, execute };
}

/**
 * Wrap a base tool executor so calls to the `subagent` tool are handled by the
 * subagent runner and all other tools pass through unchanged. Drop-in for the
 * `executeTool` dependency of the parent AgentRunner (compose with the MCP-aware
 * and guarded executors).
 */
export function createSubagentAwareExecutor(
  handle: SubagentToolHandle,
  baseExecute: (tc: ToolCall) => Promise<ChatMessage>
): (tc: ToolCall) => Promise<ChatMessage> {
  return async (tc: ToolCall): Promise<ChatMessage> => {
    if (tc.name !== SUBAGENT_TOOL_NAME) return baseExecute(tc);
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.arguments) as Record<string, unknown>;
    } catch {
      return { role: "tool", content: "ERROR: subagent received malformed arguments.", toolCallId: tc.id, name: tc.name };
    }
    const content = await handle.execute(args);
    return { role: "tool", content, toolCallId: tc.id, name: tc.name };
  };
}
