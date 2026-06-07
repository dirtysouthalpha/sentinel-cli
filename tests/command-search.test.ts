import { describe, it, expect } from "vitest";
import { suggestCommand } from "../src/core/command-search.js";
import {
  AIProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  StreamChunk,
} from "../src/ai/types.js";

// Fake provider that returns a fixed ChatResponse from chat(); mirrors the
// FakeProvider pattern in tests/agent-runner.test.ts.
class FakeProvider implements AIProvider {
  name = "fake";
  lastMessages: ChatMessage[] = [];
  lastOptions?: ChatOptions;

  constructor(private content: string) {}

  async chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<ChatResponse> {
    this.lastMessages = messages;
    this.lastOptions = options;
    return { content: this.content, model: "fake-model" };
  }

  async chatStream(
    _messages: ChatMessage[],
    _options?: ChatOptions,
    onChunk?: (chunk: StreamChunk) => void
  ): Promise<ChatResponse> {
    if (onChunk) onChunk({ content: "", done: true });
    return { content: this.content, model: "fake-model" };
  }

  isAvailable(): boolean {
    return true;
  }
}

describe("suggestCommand", () => {
  it("parses plain JSON output", async () => {
    const provider = new FakeProvider(
      '{"command": "Get-ChildItem", "explanation": "Lists files in the current directory."}'
    );
    const result = await suggestCommand(provider, "list files", {
      platform: "win32",
    });
    expect(result.command).toBe("Get-ChildItem");
    expect(result.explanation).toBe("Lists files in the current directory.");
  });

  it("parses fenced JSON output (```json ... ```)", async () => {
    const provider = new FakeProvider(
      '```json\n{"command": "ls -la", "explanation": "Lists files including hidden ones."}\n```'
    );
    const result = await suggestCommand(provider, "list all files", {
      platform: "linux",
    });
    expect(result.command).toBe("ls -la");
    expect(result.explanation).toBe("Lists files including hidden ones.");
  });

  it("parses JSON wrapped in prose", async () => {
    const provider = new FakeProvider(
      'Sure! Here you go: {"command": "pwd", "explanation": "Prints the working directory."} Hope that helps.'
    );
    const result = await suggestCommand(provider, "where am i", {
      platform: "linux",
    });
    expect(result.command).toBe("pwd");
    expect(result.explanation).toBe("Prints the working directory.");
  });

  it("returns empty command with raw output on malformed JSON", async () => {
    const raw = "I cannot help with that, sorry.";
    const provider = new FakeProvider(raw);
    const result = await suggestCommand(provider, "do something", {
      platform: "linux",
    });
    expect(result.command).toBe("");
    expect(result.explanation).toBe(raw);
  });

  it("targets PowerShell on win32 in the system prompt", async () => {
    const provider = new FakeProvider('{"command": "ls", "explanation": "x"}');
    await suggestCommand(provider, "list", { platform: "win32" });
    const sys = provider.lastMessages.find((m) => m.role === "system");
    expect(sys?.content).toContain("PowerShell");
  });

  it("targets bash on non-win32 in the system prompt", async () => {
    const provider = new FakeProvider('{"command": "ls", "explanation": "x"}');
    await suggestCommand(provider, "list", { platform: "linux" });
    const sys = provider.lastMessages.find((m) => m.role === "system");
    expect(sys?.content).toContain("bash");
  });

  it("forwards the model option to provider.chat", async () => {
    const provider = new FakeProvider('{"command": "ls", "explanation": "x"}');
    await suggestCommand(provider, "list", {
      platform: "linux",
      model: "glm-4.6",
    });
    expect(provider.lastOptions?.model).toBe("glm-4.6");
  });
});
