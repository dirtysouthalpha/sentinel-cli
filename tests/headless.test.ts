import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHeadless } from "../src/core/headless.js";
import { CustomProvider } from "../src/ai/providers/custom.js";
import { contextManager } from "../src/ai/context.js";
import { EXIT_CODES } from "../src/core/exit-codes.js";

function sse(lines: string[]): Response {
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(lines.join("\n") + "\n"));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}
const d = (o: object) => `data: ${JSON.stringify(o)}`;

/** A round that streams one tool call (assembled from deltas, like real SSE). */
function toolCallRound(id: string, name: string, args: object): Response {
  return sse([
    d({ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: "" } }] } }] }),
    d({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] } }] }),
    d({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
    "data: [DONE]",
  ]);
}

/** A round that streams plain text and ends the loop. */
function textRound(text: string): Response {
  return sse([d({ choices: [{ delta: { content: text } }] }), "data: [DONE]"]);
}

const mockProvider = () =>
  new CustomProvider("test", { baseURL: "http://mock", apiKey: "k", defaultModel: "m" } as never);

/**
 * V7 headless/CI: the extracted runner behind `sentinel run` / `sentinel -p`,
 * exercised end-to-end with only the network mocked — real provider SSE parse,
 * real executor stack (permissions → checkpoints → hooks), real file tool.
 */
describe("headless runner (runHeadless)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sentinel-headless-"));
    contextManager.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("runs an agentic task: tool executes on disk, NDJSON events stream, exit 0", async () => {
    writeFileSync(join(dir, "a.ts"), "const x = 1;\n", "utf8");

    const editArgs = {
      action: "edit",
      path: "a.ts",
      searchLines: ["const x = 1;"],
      replaceText: "const x = 2;",
    };
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (++n === 1 ? toolCallRound("c1", "file", editArgs) : textRound("done"))));

    const lines: string[] = [];
    const outcome = await runHeadless({
      task: "change x to 2",
      projectRoot: dir,
      provider: mockProvider(),
      modelName: "m",
      agent: "code",
      json: true,
      connectMcp: false,
      installRoot: process.cwd(),
      emitLine: (l) => lines.push(l),
      writeStdout: () => {},
      writeStderr: () => {},
    });

    expect(readFileSync(join(dir, "a.ts"), "utf8")).toBe("const x = 2;\n");
    expect(outcome.exitCode).toBe(EXIT_CODES.SUCCESS);
    expect(outcome.stopReason).toBe("no_tool_calls");
    expect(outcome.finalContent).toBe("done");

    const events = lines.map((l) => JSON.parse(l) as { type: string; name?: string });
    const types = events.map((e) => e.type);
    expect(types).toContain("round_start");
    expect(types).toContain("tool_start");
    expect(types).toContain("tool_result");
    expect(types).toContain("round_end");
    expect(types[types.length - 1]).toBe("done");
    expect(events.find((e) => e.type === "tool_start")?.name).toBe("file");
    expect(events.find((e) => e.type === "tool_result")?.name).toBe("file");
  });

  it("--quiet emits exactly one final done event", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (++n === 1 ? textRound("hello") : textRound("hello"))));

    const lines: string[] = [];
    const outcome = await runHeadless({
      task: "say hi",
      projectRoot: dir,
      provider: mockProvider(),
      modelName: "m",
      agent: "code",
      json: true,
      quiet: true,
      connectMcp: false,
      installRoot: process.cwd(),
      emitLine: (l) => lines.push(l),
      writeStdout: () => {},
      writeStderr: () => {},
    });

    expect(lines).toHaveLength(1);
    const done = JSON.parse(lines[0]) as { type: string; result: string };
    expect(done.type).toBe("done");
    expect(done.result).toBe("hello");
    expect(outcome.exitCode).toBe(EXIT_CODES.SUCCESS);
  });

  it("an unavailable provider is a CONFIG_ERROR (exit 2), not an agent failure", async () => {
    const outcome = await runHeadless({
      task: "anything",
      projectRoot: dir,
      model: "ghostprovider/some-model",
      agent: "code",
      connectMcp: false,
      installRoot: process.cwd(),
      emitLine: () => {},
      writeStdout: () => {},
      writeStderr: () => {},
    });

    expect(outcome.stopReason).toBe("config_error");
    expect(outcome.exitCode).toBe(EXIT_CODES.CONFIG_ERROR);
    expect(outcome.configError).toMatch(/ghostprovider/);
  });

  it("hitting --max-steps exits MAX_ROUNDS (3)", async () => {
    // Model always demands another (harmless, fast) file read → never finishes.
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => toolCallRound(`c${++n}`, "file", { action: "read", path: "a.ts" })));

    const outcome = await runHeadless({
      task: "loop forever",
      projectRoot: dir,
      provider: mockProvider(),
      modelName: "m",
      agent: "code",
      maxSteps: 2,
      connectMcp: false,
      installRoot: process.cwd(),
      emitLine: () => {},
      writeStdout: () => {},
      writeStderr: () => {},
    });

    expect(outcome.stopReason).toBe("max_rounds");
    expect(outcome.exitCode).toBe(EXIT_CODES.MAX_ROUNDS);
    expect(outcome.rounds).toBe(2);
  });

  it("a failing BLOCKING preToolUse hook denies the tool and the agent sees why", async () => {
    // Wire a blocking gate through the project's sentinel.json — the real
    // config path — with a shell seam that reports failure for that command.
    writeFileSync(
      join(dir, "sentinel.json"),
      JSON.stringify({
        hooks: { preToolUse: [{ match: "file", command: "npm test", blocking: true }] },
      }),
      "utf8"
    );

    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ++n === 1 ? toolCallRound("c1", "file", { action: "read", path: "a.ts" }) : textRound("gave up")
      )
    );

    const shellCalls: string[] = [];
    const runShell = async (cmd: string) => {
      shellCalls.push(cmd);
      throw new Error("exit 1"); // the gate fails: tests red
    };

    const lines: string[] = [];
    const outcome = await runHeadless({
      task: "read the file",
      projectRoot: dir,
      provider: mockProvider(),
      modelName: "m",
      agent: "code",
      json: true,
      connectMcp: false,
      installRoot: process.cwd(),
      emitLine: (l) => lines.push(l),
      writeStdout: () => {},
      writeStderr: () => {},
      runShell,
    });

    expect(shellCalls).toEqual(["npm test"]);
    const toolResult = lines
      .map((l) => JSON.parse(l) as { type: string; ok?: boolean; full?: string })
      .find((e) => e.type === "tool_result");
    expect(toolResult?.ok).toBe(false);
    expect(toolResult?.full).toMatch(/blocked by a blocking preToolUse hook/);
    // The run itself still completes cleanly (exit 0): the gate denied the
    // tool, the agent adapted. Exit 4 is reserved for onStop gates.
    expect(outcome.exitCode).toBe(EXIT_CODES.SUCCESS);
  });

  it("a failing BLOCKING onStop hook escalates the exit code to HOOK_BLOCKED (4)", async () => {
    writeFileSync(
      join(dir, "sentinel.json"),
      JSON.stringify({ hooks: { onStop: [{ command: "final-gate", blocking: true }] } }),
      "utf8"
    );

    vi.stubGlobal("fetch", vi.fn(async () => textRound("done")));

    const outcome = await runHeadless({
      task: "say done",
      projectRoot: dir,
      provider: mockProvider(),
      modelName: "m",
      agent: "code",
      connectMcp: false,
      installRoot: process.cwd(),
      emitLine: () => {},
      writeStdout: () => {},
      writeStderr: () => {},
      runShell: async () => {
        throw new Error("exit 1");
      },
    });

    expect(outcome.stopReason).toBe("no_tool_calls");
    expect(outcome.exitCode).toBe(EXIT_CODES.HOOK_BLOCKED);
  });
});
