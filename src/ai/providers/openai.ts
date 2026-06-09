import {
  AIProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  StreamChunk,
  ProviderConfig,
} from "../types.js";
import { buildRequestBody, parseOpenAIResponse, parseOpenAIStream } from "./openai-compat.js";
import { ProviderError } from "../errors.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger({ prefix: "openai" });

export class OpenAIProvider implements AIProvider {
  name = "openai";
  private apiKey: string;
  private baseURL: string;
  private defaultModel: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || "";
    this.baseURL = config.baseURL || "https://api.openai.com";
    this.defaultModel = "gpt-4o";
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    this.ensureClient();
    const body = buildRequestBody(messages, options, this.defaultModel, false);

    const response = await fetch(`${this.baseURL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new ProviderError(`OpenAI API error: ${response.status} - ${error}`, response.status, "openai");
    }

    return parseOpenAIResponse((await response.json()) as any);
  }

  async chatStream(
    messages: ChatMessage[],
    options?: ChatOptions,
    onChunk?: (chunk: StreamChunk) => void
  ): Promise<ChatResponse> {
    this.ensureClient();
    const body = buildRequestBody(messages, options, this.defaultModel, true);

    const response = await fetch(`${this.baseURL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new ProviderError(`OpenAI API error: ${response.status} - ${error}`, response.status, "openai");
    }

    return parseOpenAIStream(response, onChunk);
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  private ensureClient(): void {
    if (!this.apiKey) {
      throw new Error("OpenAI API key not configured. Set OPENAI_API_KEY or run /connect");
    }
  }
}
