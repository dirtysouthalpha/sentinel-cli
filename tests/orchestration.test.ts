import { describe, it, expect } from "vitest";
import { PermissionEngine } from "../src/core/permissions.js";
import { createGuardedExecutor } from "../src/core/guarded-executor.js";
import { createSubagentTool, createSubagentAwareExecutor } from "../src/core/subagent.js";
import { createTodoTool, createTodoAwareExecutor } from "../src/core/todos.js";
import {
  AIProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  StreamChunk,
  ToolCall,
} from "../src/ai/types.js";

/**
 * Integration test for the V1 parent executor chain assembled exactly as the
 * real entry points build it:
 *   todoAware -> subagentAware -> guarded(base)
 * under a given permission mode. This is the wiring per-unit tests don't cover.
 */

class FakeProvider implements AIProvider {
  name = "fake";
  calls = 0;
  constructor(private script: ChatResponse[]) {}
  async chat(): Promise<ChatResponse> {
    throw new Error("unused");
  }
  async chatStream(_m: ChatMessage[], _o?: ChatOptions, onChunk?: (c: StreamChunk) => void): Promise<ChatResponse> {
    const r = this.script[Math.min(this.calls, this.script.length - 1)];
    this.calls += 1;
    if (onChunk) onChunk({ content: "", done: true });
    return r;
  }
  isAvailable(): boolean {
    return true;
  }
}

const tc = (name: string, args: Record<string, unknown>, id = `id_${name}`): ToolCall => ({
  id,
  name,
  arguments: JSON.stringify(args),
});

function buildParentExecutor(mode: "yolo" | "plan", baseProvider: AIProvider) {
  const ROOT = process.cwd();
  const engine = new PermissionEngine(mode, {}, ROOT);
  // Base executor stands in for the real tool runner.
  const base = async (call: ToolCall): Promise<ChatMessage> => ({
    role: "tool",
    content: `ran:${call.name}`,
    name: call.name,
    toolCallId: call.id,
  });
  const guarded = createGuardedExecutor({ engine, ask: async () => false, baseExecute: base });
  const subagentTool = createSubagentTool({
    provider: baseProvider,
    toolDefs: [],
    executeTool: guarded,
    extractToolCalls: () => null,
  });
  const subagentExecute = createSubagentAwareExecutor(subagentTool, guarded);
  const todoTool = createTodoTool();
  const parentExecute = createTodoAwareExecutor(todoTool, subagentExecute);
  return { parentExecute, todoTool, subagentTool };
}

describe("orchestration wiring", () => {
  it("routes todo_write, subagent, and normal tools correctly (yolo)", async () => {
    // subagent's child immediately answers (no tools)
    const provider = new FakeProvider([{ content: "subagent result", model: "m" }]);
    const { parentExecute, todoTool } = buildParentExecutor("yolo", provider);

    const todoRes = await parentExecute(tc("todo_write", { todos: [{ content: "step 1", status: "in_progress" }] }));
    expect(todoRes.content).toContain("[~] step 1");
    expect(todoTool.store.get()).toHaveLength(1);

    const subRes = await parentExecute(tc("subagent", { task: "do research" }));
    expect(subRes.content).toBe("subagent result");

    const bashRes = await parentExecute(tc("bash", { command: "ls" }));
    expect(bashRes.content).toBe("ran:bash"); // passed through guard (yolo) to base
  });

  it("plan mode denies a passthrough mutation but todo/subagent still work", async () => {
    const provider = new FakeProvider([{ content: "plan-time research done", model: "m" }]);
    const { parentExecute } = buildParentExecutor("plan", provider);

    // bash is denied by the guard in plan mode
    const bashRes = await parentExecute(tc("bash", { command: "rm -rf x" }));
    expect(bashRes.content).toMatch(/Permission denied/);
    expect(bashRes.content).toMatch(/plan mode is read-only/);

    // todo_write is intercepted before the guard, so planning the work still works
    const todoRes = await parentExecute(tc("todo_write", { todos: [{ content: "plan it", status: "pending" }] }));
    expect(todoRes.content).toContain("[ ] plan it");
  });
});
