// UNTESTED in R1 — no Gemini key available; verify against the live API before relying on it.
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

const log = createLogger({ prefix: "gemini" });

// Gemini request/response shapes (subset we care about).
interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: string;
  parts: GeminiPart[];
}

interface GeminiCandidate {
  content?: GeminiContent;
  finishReason?: string;
}

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
  modelVersion?: string;
}

export class GeminiProvider implements AIProvider {
  name = "gemini";
  private apiKey: string;
  private baseURL: string;
  private defaultModel: string;

  constructor(config: ProviderConfig) {
    this.apiKey =
      config.apiKey ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      "";
    this.baseURL =
      config.baseURL || "https://generativelanguage.googleapis.com/v1beta";
    this.defaultModel = config.defaultModel || "gemini-2.0-flash";
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  // TODO: replace inline type with a shared ProviderCapabilities type once it
  // exists in ../types.ts.
  getCapabilities(): {
    supportsStreaming: boolean;
    supportsTools: boolean;
    supportsStreamingToolCalls: boolean;
    supportsVision: boolean;
    maxContextTokens: number;
    toolArgsFormat: "object" | "string";
    systemPromptLocation: "systemInstruction" | "message";
  } {
    return {
      supportsStreaming: true,
      supportsTools: true,
      supportsStreamingToolCalls: false,
      supportsVision: true,
      maxContextTokens: 1000000,
      toolArgsFormat: "object",
      systemPromptLocation: "systemInstruction",
    };
  }

  private ensureClient(): void {
    if (!this.apiKey) {
      throw new Error(
        "Gemini API key not configured. Set GEMINI_API_KEY (or GOOGLE_API_KEY) or run /connect"
      );
    }
  }

  /**
   * Translate internal ChatMessage[] into Gemini's generateContent format.
   * System messages become a top-level systemInstruction; user/assistant
   * messages become contents with roles "user"/"model"; tool calls become
   * functionCall parts; tool results become functionResponse parts.
   */
  private toGeminiRequest(
    messages: ChatMessage[],
    options?: ChatOptions
  ): {
    systemInstruction?: { parts: Array<{ text: string }> };
    contents: GeminiContent[];
    tools?: Array<{ functionDeclarations: unknown[] }>;
    generationConfig: Record<string, unknown>;
  } {
    const systemTexts: string[] = [];
    if (options?.systemPrompt) {
      systemTexts.push(options.systemPrompt);
    }

    const contents: GeminiContent[] = [];

    for (const m of messages) {
      if (m.role === "system") {
        const sys = contentToText(m.content);
        if (sys) systemTexts.push(sys);
        continue;
      }

      if (m.role === "tool") {
        // Tool results map back to a functionResponse part. Gemini has no call
        // ids, so we correlate by NAME.
        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: m.name || "",
                response: { result: m.content },
              },
            },
          ],
        });
        continue;
      }

      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        const parts: GeminiPart[] = [];
        const assistantText = contentToText(m.content);
        if (assistantText) parts.push({ text: assistantText });
        for (const tc of m.toolCalls) {
          let args: Record<string, unknown> = {};
          try {
            args = tc.arguments ? JSON.parse(tc.arguments) : {};
          } catch {
            log.warn(`Failed to parse tool call arguments for ${tc.name}`);
          }
          parts.push({ functionCall: { name: tc.name, args } });
        }
        contents.push({ role: "model", parts });
        continue;
      }

      contents.push({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: contentToText(m.content) }],
      });
    }

    const generationConfig: Record<string, unknown> = {
      temperature: options?.temperature ?? 0.7,
    };
    if (options?.maxTokens) generationConfig.maxOutputTokens = options.maxTokens;
    if (options?.stopSequences) generationConfig.stopSequences = options.stopSequences;

    const request: {
      systemInstruction?: { parts: Array<{ text: string }> };
      contents: GeminiContent[];
      tools?: Array<{ functionDeclarations: unknown[] }>;
      generationConfig: Record<string, unknown>;
    } = {
      contents,
      generationConfig,
    };

    if (systemTexts.length > 0) {
      request.systemInstruction = {
        parts: [{ text: systemTexts.join("\n\n") }],
      };
    }

    if (options?.tools && options.tools.length > 0) {
      request.tools = [
        {
          functionDeclarations: options.tools.map((t) => ({
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
          })),
        },
      ];
    }

    return request;
  }

  private parseCandidate(
    data: GeminiResponse,
    model: string
  ): ChatResponse {
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    let textContent = "";
    const toolCalls: ToolCall[] = [];

    for (const part of parts) {
      if (typeof part.text === "string") {
        textContent += part.text;
      } else if (part.functionCall) {
        const index = toolCalls.length;
        toolCalls.push({
          // Gemini has no call ids — synthesize a stable one.
          id: `call_${part.functionCall.name}${index}`,
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {}),
        });
      }
    }

    return {
      content: textContent,
      model: data.modelVersion || model,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: candidate?.finishReason,
      usage: data.usageMetadata
        ? {
            promptTokens: data.usageMetadata.promptTokenCount || 0,
            completionTokens: data.usageMetadata.candidatesTokenCount || 0,
            totalTokens: data.usageMetadata.totalTokenCount || 0,
          }
        : undefined,
    };
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    this.ensureClient();
    const model = options?.model || this.defaultModel;
    const body = this.toGeminiRequest(messages, options);

    const url = `${this.baseURL}/models/${model}:generateContent?key=${this.apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new ProviderError(`Gemini API error: ${response.status} - ${error}`, response.status, "gemini");
    }

    const data = (await response.json()) as GeminiResponse;
    return this.parseCandidate(data, model);
  }

  async chatStream(
    messages: ChatMessage[],
    options?: ChatOptions,
    onChunk?: (chunk: StreamChunk) => void
  ): Promise<ChatResponse> {
    this.ensureClient();
    const model = options?.model || this.defaultModel;
    const body = this.toGeminiRequest(messages, options);

    const url = `${this.baseURL}/models/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new ProviderError(`Gemini API error: ${response.status} - ${error}`, response.status, "gemini");
    }

    const fullContent: string[] = [];
    const toolCalls: ToolCall[] = [];
    let finishReason = "";
    let modelVersion = "";
    let usageData:
      | { promptTokens: number; completionTokens: number; totalTokens: number }
      | undefined;

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
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data || data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data) as GeminiResponse;
            if (parsed.modelVersion) modelVersion = parsed.modelVersion;

            const candidate = parsed.candidates?.[0];
            const parts = candidate?.content?.parts || [];
            for (const part of parts) {
              if (typeof part.text === "string") {
                fullContent.push(part.text);
                onChunk?.({ content: part.text, done: false });
              } else if (part.functionCall) {
                // Streaming tool calls are not deltas in Gemini — each appears
                // whole. Assemble them as they arrive.
                const index = toolCalls.length;
                toolCalls.push({
                  id: `call_${part.functionCall.name}${index}`,
                  name: part.functionCall.name,
                  arguments: JSON.stringify(part.functionCall.args || {}),
                });
              }
            }

            if (candidate?.finishReason) finishReason = candidate.finishReason;
            if (parsed.usageMetadata) {
              usageData = {
                promptTokens: parsed.usageMetadata.promptTokenCount || 0,
                completionTokens: parsed.usageMetadata.candidatesTokenCount || 0,
                totalTokens: parsed.usageMetadata.totalTokenCount || 0,
              };
            }
          } catch {
            // skip malformed/partial SSE lines
          }
        }
      }
    }

    onChunk?.({ content: "", done: true });

    return {
      content: fullContent.join(""),
      model: modelVersion || model,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason,
      usage: usageData,
    };
  }
}
