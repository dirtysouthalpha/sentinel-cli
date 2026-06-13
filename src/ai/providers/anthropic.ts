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
        system = contentToText(m.content);
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
      model: options?.model || "claude-sonnet-4-6",
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

    // 2 retries with 5s / 10s backoff for transient 429s (Claude Max quota windows)
    const RETRY_DELAYS = [5000, 10000];
    const MAX_RETRIES = RETRY_DELAYS.length;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
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
      const err = new ProviderError(`Anthropic API error: ${response.status} - ${error}`, response.status, "anthropic");
      if (response.status === 429 && attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }
      throw err;
    }

    try {
    const fullContent: string[] = [];
    let model = "";
    // Keyed by the content-block index, which start/delta/stop events all carry.
    const toolCallMap = new Map<number, { id: string; name: string; args: string }>();
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
              if (event.type === "error") {
                const status = event.error?.type === "rate_limit_error" ? 429 : 500;
                throw new ProviderError(
                  `Anthropic error: ${event.error?.type} - ${event.error?.message}`,
                  status,
                  "anthropic"
                );
              } else if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
                const text = event.delta.text || "";
                if (text) { fullContent.push(text); onChunk?.({ content: text, done: false }); }
              } else if (event.type === "content_block_delta" && event.delta?.text) {
                // Fallback for any variant that puts text directly on the delta.
                fullContent.push(event.delta.text);
                onChunk?.({ content: event.delta.text, done: false });
              } else if (event.type === "message_start") {
                model = event.message?.model || "";
              } else if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
                // Anthropic announces a tool call here (id + name), then streams
                // its JSON arguments as input_json_delta events at the same index.
                const idx = event.index ?? 0;
                toolCallMap.set(idx, {
                  id: event.content_block.id || `call_${idx}`,
                  name: event.content_block.name || "",
                  args: "",
                });
              } else if (event.type === "content_block_delta" && event.delta?.type === "input_json_delta") {
                const idx = event.index ?? 0;
                const tc = toolCallMap.get(idx);
                if (tc && event.delta.partial_json) tc.args += event.delta.partial_json;
              } else if (event.type === "message_delta" && event.usage) {
                usageData = {
                  promptTokens: event.usage.input_tokens || 0,
                  completionTokens: event.usage.output_tokens || 0,
                  totalTokens: (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0),
                };
              }
            } catch (e) {
              if (e instanceof ProviderError) throw e;
              // skip malformed SSE events
            }
          } else {
            // Raw JSON error line terminated by a newline (proxy passthrough)
            const trimmed = line.trim();
            if (trimmed.startsWith("{")) {
              try {
                const errObj = JSON.parse(trimmed);
                if (errObj.type === "error") {
                  const status = errObj.error?.type === "rate_limit_error" ? 429 : 500;
                  throw new ProviderError(
                    `Anthropic error: ${errObj.error?.type} - ${errObj.error?.message}`,
                    status,
                    "anthropic"
                  );
                }
              } catch (e) {
                if (e instanceof ProviderError) throw e;
              }
            }
          }
        }

        // buffer.pop() keeps content without a trailing newline — check it for a bare
        // JSON error object (proxy sends the error body without a trailing \n, so it
        // never appears as a complete "line" above and would block the next read forever)
        const bufTrimmed = buffer.trim();
        if (bufTrimmed.startsWith("{") && bufTrimmed.endsWith("}")) {
          let parsed: unknown;
          try { parsed = JSON.parse(bufTrimmed); } catch { /* not complete JSON yet */ }
          if (parsed && typeof parsed === "object") {
            const errObj = parsed as Record<string, unknown>;
            if (errObj.type === "error") {
              void reader.cancel(); // close the connection before throwing
              const err = errObj.error as Record<string, unknown> | undefined;
              const status = err?.type === "rate_limit_error" ? 429 : 500;
              throw new ProviderError(
                `Anthropic error: ${err?.type} - ${err?.message}`,
                status,
                "anthropic"
              );
            }
          }
        }
      }
    }

    onChunk?.({ content: "", done: true });

    const toolCalls = toolCallMap.size > 0
      ? Array.from(toolCallMap.values())
          .filter((tc) => tc.name)
          .map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.args || "{}" }))
      : undefined;

    return {
      content: fullContent.join(""),
      model,
      toolCalls,
      usage: usageData,
    };
    } catch (e) {
      // Retry on 429 (Claude Max quota windows); propagate everything else
      if (e instanceof ProviderError && e.status === 429 && attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }
      throw e;
    }
    } // end retry loop
    throw new ProviderError("Rate limit exceeded after retries", 429, "anthropic");
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
