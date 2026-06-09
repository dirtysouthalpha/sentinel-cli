import {
  AIProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  StreamChunk,
  ToolCall,
  ProviderConfig,
  contentToText,
} from "../types.js";
import { ProviderError } from "../errors.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger({ prefix: "anthropic" });

/**
 * Attach the system prompt as a cacheable content block. Render order is
 * tools -> system -> messages, so a `cache_control` breakpoint on the system
 * block caches the (stable) tools + system prefix — the largest repeated chunk
 * an agent re-sends every turn. Prompt caching is GA on anthropic-version
 * 2023-06-01 (no beta header). Prefixes under the model's minimum (~1-4K tokens)
 * silently won't cache, which is harmless. Unknown extra fields are ignored by
 * OpenAI-shaped compatible endpoints, so this is safe behind a custom baseURL.
 */
function applySystemWithCache(body: Record<string, unknown>, systemText: string): void {
  if (!systemText) return;
  body.system = [
    { type: "text", text: systemText, cache_control: { type: "ephemeral" } },
  ];
}

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
        // Concatenate (don't overwrite) so a context-compaction summary that
        // arrives as a later system message can't clobber the real system
        // prompt — the Anthropic API takes a single `system`, last-writer-wins.
        const text = contentToText(m.content);
        system = system ? `${system}\n\n${text}` : text;
        continue;
      }
      if (m.role === "tool") {
        result.push({
          role: "user",
          content: `[Tool Result (${m.name})]: ${contentToText(m.content)}`,
        });
        continue;
      }
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        let content = contentToText(m.content) || "";
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
      model: options?.model || "claude-sonnet-4-6",
      max_tokens: options?.maxTokens || 8192,
      temperature: options?.temperature ?? 0.7,
      messages: chatMsgs,
    };

    applySystemWithCache(body, options?.systemPrompt || system);

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
      signal: options?.signal,
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
      model: options?.model || "claude-sonnet-4-6",
      max_tokens: options?.maxTokens || 8192,
      temperature: options?.temperature ?? 0.7,
      messages: chatMsgs,
      stream: true,
    };

    applySystemWithCache(body, options?.systemPrompt || system);

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
      signal: options?.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new ProviderError(`Anthropic API error: ${response.status} - ${error}`, response.status, "anthropic");
    }

    const fullContent: string[] = [];
    let model = "";
    // Tool-use blocks keyed by their streaming content-block index. Anthropic
    // (and z.ai's Anthropic-compatible API) stream a tool call as a
    // content_block_start of type "tool_use" followed by input_json_delta
    // chunks on the same index -- NOT tool_use_start / input_json_delta
    // top-level events.
    const toolBlocks = new Map<number, { id: string; name: string; args: string }>();
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
              if (event.type === "message_start") {
                model = event.message?.model || "";
              } else if (event.type === "content_block_start") {
                const cb = event.content_block;
                if (cb?.type === "tool_use") {
                  toolBlocks.set(event.index, {
                    id: cb.id || `call_${toolBlocks.size}`,
                    name: cb.name || "",
                    args: "",
                  });
                }
              } else if (event.type === "content_block_delta") {
                const delta = event.delta;
                if (delta?.type === "input_json_delta") {
                  const tb = toolBlocks.get(event.index);
                  if (tb) tb.args += delta.partial_json || "";
                } else if (delta?.text) {
                  fullContent.push(delta.text);
                  onChunk?.({ content: delta.text, done: false });
                }
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

    const toolCalls = toolBlocks.size > 0
      ? Array.from(toolBlocks.values())
          .filter((tb) => tb.name)
          .map((tb) => ({ id: tb.id, name: tb.name, arguments: tb.args || "{}" }))
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
