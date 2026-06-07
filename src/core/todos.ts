import { ChatMessage, ToolCall, ToolDef } from "../ai/types.js";

/**
 * Todos (V1 orchestration core). A lightweight task tracker the model drives to
 * plan and sequence multi-step work — the natural companion to plan mode (which
 * produces the plan) and subagents (which execute pieces of it). Mirrors the
 * proven "write the whole list each time" shape: one `todo_write` call replaces
 * the full list, so state is always coherent.
 *
 * The store is a process/session singleton-ish object owned by the caller; the
 * tool result echoes the rendered list (so the model and transcript see state),
 * and the UI can subscribe via onChange to render a live board.
 */

export const TODO_TOOL_NAME = "todo_write";

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  content: string;
  status: TodoStatus;
}

const STATUS_MARK: Record<TodoStatus, string> = {
  pending: "[ ]",
  in_progress: "[~]",
  completed: "[x]",
};

const VALID_STATUS = new Set<TodoStatus>(["pending", "in_progress", "completed"]);

export class TodoStore {
  private items: TodoItem[] = [];
  private listeners: ((items: TodoItem[]) => void)[] = [];

  set(items: TodoItem[]): void {
    this.items = items;
    for (const l of this.listeners) l(this.items);
  }

  get(): TodoItem[] {
    return [...this.items];
  }

  onChange(fn: (items: TodoItem[]) => void): void {
    this.listeners.push(fn);
  }

  render(): string {
    if (this.items.length === 0) return "(no todos)";
    const done = this.items.filter((t) => t.status === "completed").length;
    const lines = this.items.map((t) => `${STATUS_MARK[t.status]} ${t.content}`);
    return `Todos (${done}/${this.items.length} done):\n${lines.join("\n")}`;
  }
}

/** Coerce arbitrary tool args into a validated TodoItem[] (or throw a clear error). */
function parseTodos(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) throw new Error("'todos' must be an array");
  return raw.map((entry, i) => {
    if (!entry || typeof entry !== "object") throw new Error(`todos[${i}] must be an object`);
    const e = entry as Record<string, unknown>;
    const content = typeof e.content === "string" ? e.content.trim() : "";
    if (!content) throw new Error(`todos[${i}].content is required`);
    const status = (typeof e.status === "string" ? e.status : "pending") as TodoStatus;
    if (!VALID_STATUS.has(status)) throw new Error(`todos[${i}].status must be pending|in_progress|completed`);
    return { content, status };
  });
}

export interface TodoToolHandle {
  def: ToolDef;
  execute: (args: Record<string, unknown>) => string;
  store: TodoStore;
}

export function createTodoTool(store?: TodoStore): TodoToolHandle {
  const s = store ?? new TodoStore();
  const def: ToolDef = {
    type: "function",
    function: {
      name: TODO_TOOL_NAME,
      description:
        "Create and manage a structured todo list for the current task. Call this with the " +
        "COMPLETE list every time (it replaces the previous list). Use it to plan multi-step " +
        "work, mark exactly one item 'in_progress' as you work, and flip items to 'completed' " +
        "the moment they're done. Keeps you and the user aligned on progress.",
      parameters: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            description: "The full todo list (replaces any prior list).",
            items: {
              type: "object",
              properties: {
                content: { type: "string", description: "The task, in imperative form." },
                status: { type: "string", enum: ["pending", "in_progress", "completed"], description: "pending|in_progress|completed" },
              },
              required: ["content", "status"],
            },
          },
        },
        required: ["todos"],
      },
    },
  };

  const execute = (args: Record<string, unknown>): string => {
    let items: TodoItem[];
    try {
      items = parseTodos(args.todos);
    } catch (e) {
      return `ERROR: ${e instanceof Error ? e.message : String(e)}`;
    }
    s.set(items);
    return s.render();
  };

  return { def, execute, store: s };
}

/** Wrap a base executor so `todo_write` is handled locally; everything else passes through. */
export function createTodoAwareExecutor(
  handle: TodoToolHandle,
  baseExecute: (tc: ToolCall) => Promise<ChatMessage>
): (tc: ToolCall) => Promise<ChatMessage> {
  return async (tc: ToolCall): Promise<ChatMessage> => {
    if (tc.name !== TODO_TOOL_NAME) return baseExecute(tc);
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.arguments) as Record<string, unknown>;
    } catch {
      return { role: "tool", content: "ERROR: todo_write received malformed arguments.", toolCallId: tc.id, name: tc.name };
    }
    return { role: "tool", content: handle.execute(args), toolCallId: tc.id, name: tc.name };
  };
}
