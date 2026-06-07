import {
  AIProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  StreamChunk,
  ToolCall,
  ProviderConfig,
} from "../types.js";
import { ProviderError } from "../errors.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger({ prefix: "anthropic" });

export class AnthropicProvider implements AIProvider {
  name = "anthropic";
  private apiKey: string;
  private baseURL: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || "";
    this.baseURL = config.baseURL || "https://api.anthropic.com";
  }

  private toAnthropicMessages(messages: ChatMessage[]): {
    system: string;
    messages: Array<{ role: string; content: string | unknown[] }>;
  } {
    let system = "";
    const result: Array<{ role: string; content: string | unknown[] }> = [];

    for (const m of messages) {
      if (m.role === "system") {
        system = m.content;
        continue;
      }
      if (m.role === "tool") {
        result.push({
          role: "user",
          content: `[Tool Result (${m.name})]: ${m.content}`,
        });
        continue;
      }
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        let content = m.content || "";
        for (const tc of m.toolCalls) {
          content += `\n[Tool Call: ${tc.name}(${tc.arguments})]`;
        }
        result.push({ role: "assistant", content });
        continue;
      }
      result.push({ role: m.role === "assistant" ? "assistant" : "user", content: m.content });
    }

    return { system, messages: result };
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    this.ensureClient();
    const { system, messages: chatMsgs } = this.toAnthropicMessages(messages);

    const body: Record<string, unknown> = {
      model: options?.model || "claude-sonnet-4-20250514",
      max_tokens: options?.maxTokens || 8192,
      temperature: options?.temperature ?? 0.7,
      messages: chatMsgs,
    };

    if (system || options?.systemPrompt) {
      body.system = options?.systemPrompt || system;
    }

    if (options?.tools && options.tools.length > 0) {
      body.tools = options.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }

    const response = await fetch(`${this.baseURL}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new ProviderError(`Anthropic API error: ${response.status} - ${error}`, response.status, "anthropic");
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string; name?: string; input?: unknown; id?: string }>;
      model: string;
      stop_reason?: string;
      usage: { input_tokens: number; output_tokens: number };
    };

    let textContent = "";
    const toolCalls: ToolCall[] = [];

    for (const block of data.content) {
      if (block.type === "text" && block.text) {
        textContent += block.text;
      } else if (block.type === "tool_use" && block.name) {
        toolCalls.push({
          id: block.id || `call_${toolCalls.length}`,
          name: block.name,
          arguments: JSON.stringify(block.input || {}),
        });
      }
    }

    return {
      content: textContent,
      model: data.model,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: data.stop_reason,
      usage: {
        promptTokens: data.usage?.input_tokens || 0,
        completionTokens: data.usage?.output_tokens || 0,
        totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      },
    };
  }

  async chatStream(
    messages: ChatMessage[],
    options?: ChatOptions,
    onChunk?: (chunk: StreamChunk) => void
  ): Promise<ChatResponse> {
    this.ensureClient();
    const { system, messages: chatMsgs } = this.toAnthropicMessages(messages);

    const body: Record<string, unknown> = {
      model: options?.model || "claude-sonnet-4-20250514",
      max_tokens: options?.maxTokens || 8192,
      temperature: options?.temperature ?? 0.7,
      messages: chatMsgs,
      stream: true,
    };

    if (system || options?.systemPrompt) {
      body.system = options?.systemPrompt || system;
    }

    if (options?.tools && options.tools.length > 0) {
      body.tools = options.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }

    const response = await fetch(`${this.baseURL}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new ProviderError(`Anthropic API error: ${response.status} - ${error}`, response.status, "anthropic");
    }

    const fullContent: string[] = [];
    let model = "";
    const toolCallMap = new Map<string, { name: string; args: string }>();
    let currentToolId = "";
    let usageData: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;

    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;

            try {
              const event = JSON.parse(data);
              if (event.type === "content_block_delta" && event.delta?.text) {
                fullContent.push(event.delta.text);
                onChunk?.({ content: event.delta.text, done: false });
              } else if (event.type === "message_start") {
                model = event.message?.model || "";
              } else if (event.type === "tool_use_start") {
                currentToolId = event.id || `call_${toolCallMap.size}`;
                toolCallMap.set(currentToolId, { name: event.name || "", args: "" });
              } else if (event.type === "input_json_delta" && currentToolId) {
                const tc = toolCallMap.get(currentToolId);
                if (tc && event.delta?.partial_json) tc.args += event.delta.partial_json;
              } else if (event.type === "message_delta" && event.usage) {
                usageData = {
                  promptTokens: event.usage.input_tokens || 0,
                  completionTokens: event.usage.output_tokens || 0,
                  totalTokens: (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0),
                };
              }
            } catch {
              // skip
            }
          }
        }
      }
    }

    onChunk?.({ content: "", done: true });

    const toolCalls = toolCallMap.size > 0
      ? Array.from(toolCallMap.entries()).map(([id, tc]) => ({ id, name: tc.name, arguments: tc.args }))
      : undefined;

    return {
      content: fullContent.join(""),
      model,
      toolCalls,
      usage: usageData,
    };
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  private ensureClient(): void {
    if (!this.apiKey) {
      throw new Error("Anthropic API key not configured. Set ANTHROPIC_API_KEY or run /connect");
    }
  }
}
