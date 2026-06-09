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

  /** Force this isolated context under a token budget so a long subagent run
   *  (e.g. autopilot) recovers from overflow instead of wedging. */
  ensureUnder(maxTokens: number): number {
    const limit = Math.max(2000, maxTokens);
    while (this.getTotalTokens() > limit && this.messages.length > 2) this.messages.shift();
    if (this.getTotalTokens() > limit && this.messages.length) {
      const per = Math.max(400, Math.floor((limit / this.messages.length) * 3.5));
      for (const m of this.messages) {
        if (m.content.length > per) m.content = m.content.slice(0, per) + "\n…[trimmed]";
      }
    }
    return this.getTotalTokens();
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
  /** Token-usage sink for each model call the subagent makes (cost accounting). */
  onUsage?: (u: { promptTokens: number; completionTokens: number; totalTokens: number }) => void;
}

const DEFAULT_SUBAGENT_PROMPT =
  "You are a focused subagent spawned by a parent agent. You have your own isolated " +
  "context and a bounded number of rounds. Complete ONLY the delegated task, use tools " +
  "as needed, and end with a concise, self-contained answer the parent can act on. Do " +
  "not ask the parent questions — make reasonable assumptions and state them.";

export interface SubagentToolHandle {
  def: ToolDef;
  /**
   * Runs the subagent for a parsed `{ task, context?, outputSchema? }`.
   * - Without `outputSchema`: returns the child's trimmed final text.
   * - With `outputSchema`: instructs the child to emit ONLY JSON, parses +
   *   lightly validates it against the schema, and returns the pretty-printed
   *   validated JSON (or a clear ERROR string on parse/validation failure).
   */
  execute: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<string>;
}

/**
 * Pull the first JSON value out of arbitrary model output. Tolerates ```json
 * fences and surrounding prose by, in order: direct parse, fenced-block parse,
 * then a balanced-bracket slice of the first `{...}` or `[...]`. Returns the
 * parsed value, or `undefined` if no valid JSON could be recovered. Pure.
 */
export function extractFirstJson(text: string): unknown {
  const trimmed = text.trim();
  const tryParse = (s: string): { ok: true; value: unknown } | { ok: false } => {
    try {
      return { ok: true, value: JSON.parse(s) };
    } catch {
      return { ok: false };
    }
  };

  const direct = tryParse(trimmed);
  if (direct.ok) return direct.value;

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const fenced = tryParse(fence[1].trim());
    if (fenced.ok) return fenced.value;
    const innerSlice = sliceFirstJsonValue(fence[1]);
    if (innerSlice !== undefined) {
      const r = tryParse(innerSlice);
      if (r.ok) return r.value;
    }
  }

  const slice = sliceFirstJsonValue(trimmed);
  if (slice !== undefined) {
    const r = tryParse(slice);
    if (r.ok) return r.value;
  }
  return undefined;
}

/** Slice the first balanced `{...}` or `[...]` from text, ignoring brackets inside strings. */
function sliceFirstJsonValue(text: string): string | undefined {
  const start = text.search(/[{[]/);
  if (start < 0) return undefined;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return text.slice(start, i + 1);
  }
  return undefined;
}

/**
 * Lightweight JSON-Schema validator (intentionally NOT ajv). Checks `type`
 * (object/array/string/number/integer/boolean/null, or an array of those),
 * `required` keys on objects, recurses into `properties` and array `items`.
 * Returns a list of human-readable error paths; empty means valid. Pure.
 */
export function validateAgainstSchema(
  value: unknown,
  schema: Record<string, unknown>,
  path = "$"
): string[] {
  const errors: string[] = [];
  const typeOf = (v: unknown): string =>
    v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
  const matches = (t: string): boolean =>
    t === "integer" ? typeof value === "number" && Number.isInteger(value) : typeOf(value) === t;

  const declared = schema.type;
  const types = Array.isArray(declared)
    ? (declared as string[])
    : typeof declared === "string"
      ? [declared]
      : [];
  if (types.length && !types.some(matches)) {
    errors.push(`${path}: expected ${types.join("|")}, got ${typeOf(value)}`);
    return errors; // type mismatch — deeper checks would be noise
  }

  const isObject = value !== null && typeof value === "object" && !Array.isArray(value);
  if (isObject) {
    const obj = value as Record<string, unknown>;
    const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    for (const key of required) {
      if (!(key in obj)) errors.push(`${path}.${key}: missing required property`);
    }
    const props = (schema.properties ?? {}) as Record<string, unknown>;
    for (const [key, sub] of Object.entries(props)) {
      if (key in obj && sub && typeof sub === "object") {
        errors.push(...validateAgainstSchema(obj[key], sub as Record<string, unknown>, `${path}.${key}`));
      }
    }
  }
  if (Array.isArray(value) && schema.items && typeof schema.items === "object") {
    const items = schema.items as Record<string, unknown>;
    value.forEach((el, i) => errors.push(...validateAgainstSchema(el, items, `${path}[${i}]`)));
  }
  return errors;
}

const truncateForError = (s: string, n = 2000): string =>
  s.length > n ? `${s.slice(0, n)}\n… [truncated ${s.length - n} chars]` : s;

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
          outputSchema: {
            type: "object",
            description:
              "Optional JSON Schema describing the desired result shape. When provided, the subagent is " +
              "instructed to respond with ONLY a JSON value matching it; the result is parsed and " +
              "lightly validated, and the pretty-printed JSON is returned (or an ERROR on mismatch). " +
              "Omit to receive the subagent's free-form text answer.",
          },
        },
        required: ["task"],
      },
    },
  };

  const execute = async (args: Record<string, unknown>, signal?: AbortSignal): Promise<string> => {
    const task = typeof args.task === "string" ? args.task.trim() : "";
    if (!task) return "ERROR: subagent requires a non-empty 'task'.";
    const extra = typeof args.context === "string" && args.context.trim() ? `\n\nContext:\n${args.context.trim()}` : "";

    const schema =
      args.outputSchema && typeof args.outputSchema === "object" && !Array.isArray(args.outputSchema)
        ? (args.outputSchema as Record<string, unknown>)
        : undefined;
    // When a schema is requested, instruct the child to emit ONLY JSON. Stays "" (byte-identical
    // to the legacy path) when no schema is provided.
    const schemaInstruction = schema
      ? "\n\nIMPORTANT: Respond with ONLY a single JSON value that conforms to the following JSON " +
        "Schema. Output raw JSON — no prose, no explanation, no markdown code fences.\n\nJSON Schema:\n" +
        JSON.stringify(schema, null, 2)
      : "";

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
      { model: deps.model, maxRounds: deps.maxRounds ?? 10, maxContextTokens: 120000 }
    );
    if (deps.onUsage) runner.on("usage", deps.onUsage);

    const result = await runner.run(`${task}${extra}${schemaInstruction}`, signal);

    if (schema) {
      const raw = result.finalContent ?? "";
      const parsed = extractFirstJson(raw);
      if (parsed === undefined) {
        return (
          "ERROR: subagent did not return valid JSON for schema (no JSON value could be parsed " +
          `from the response). Raw output:\n${truncateForError(raw)}`
        );
      }
      const errors = validateAgainstSchema(parsed, schema);
      if (errors.length) {
        return (
          `ERROR: subagent did not return valid JSON for schema (${errors.join("; ")}). ` +
          `Raw output:\n${truncateForError(raw)}`
        );
      }
      return JSON.stringify(parsed, null, 2);
    }

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
