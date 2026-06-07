import { describe, it, expect } from "vitest";
import { createTodoTool, createTodoAwareExecutor, TodoStore, TODO_TOOL_NAME } from "../src/core/todos.js";
import { ChatMessage, ToolCall } from "../src/ai/types.js";

const tc = (name: string, args: Record<string, unknown>, id = "id1"): ToolCall => ({
  id,
  name,
  arguments: JSON.stringify(args),
});

describe("todos", () => {
  it("replaces the whole list and renders progress", () => {
    const { execute, store } = createTodoTool();
    const out = execute({
      todos: [
        { content: "Read the file", status: "completed" },
        { content: "Write the fix", status: "in_progress" },
        { content: "Run tests", status: "pending" },
      ],
    });
    expect(out).toContain("1/3 done");
    expect(out).toContain("[x] Read the file");
    expect(out).toContain("[~] Write the fix");
    expect(out).toContain("[ ] Run tests");
    expect(store.get()).toHaveLength(3);

    // a second write fully replaces the prior list
    execute({ todos: [{ content: "Only task", status: "pending" }] });
    expect(store.get()).toEqual([{ content: "Only task", status: "pending" }]);
  });

  it("notifies subscribers on change", () => {
    const store = new TodoStore();
    let seen: number | null = null;
    store.onChange((items) => {
      seen = items.length;
    });
    const { execute } = createTodoTool(store);
    execute({ todos: [{ content: "a", status: "pending" }, { content: "b", status: "pending" }] });
    expect(seen).toBe(2);
  });

  it("validates input", () => {
    const { execute } = createTodoTool();
    expect(execute({ todos: "nope" as unknown as [] })).toMatch(/must be an array/);
    expect(execute({ todos: [{ status: "pending" }] })).toMatch(/content is required/);
    expect(execute({ todos: [{ content: "x", status: "bogus" }] })).toMatch(/status must be/);
  });

  it("aware executor intercepts only todo_write", async () => {
    const handle = createTodoTool();
    let baseCalls = 0;
    const base = async (call: ToolCall): Promise<ChatMessage> => {
      baseCalls += 1;
      return { role: "tool", content: `base:${call.name}`, name: call.name, toolCallId: call.id };
    };
    const exec = createTodoAwareExecutor(handle, base);

    const pass = await exec(tc("bash", { command: "ls" }));
    expect(pass.content).toBe("base:bash");
    expect(baseCalls).toBe(1);

    const todo = await exec(tc(TODO_TOOL_NAME, { todos: [{ content: "task", status: "pending" }] }));
    expect(todo.content).toContain("[ ] task");
    expect(baseCalls).toBe(1); // not delegated to base
  });
});
