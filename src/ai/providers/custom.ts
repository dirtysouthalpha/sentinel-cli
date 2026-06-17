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

const log = createLogger({ prefix: "custom" });

export class CustomProvider implements AIProvider {
  name: string;
  private apiKey: string;
  private baseURL: string;
  private defaultModel: string;

  constructor(name: string, config: ProviderConfig) {
    this.name = name;
    this.apiKey = config.apiKey || "";
    this.baseURL = config.baseURL || "http://localhost:11434";
    this.defaultModel = config.defaultModel || "default";
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const body = buildRequestBody(messages, options, this.defaultModel, false);

    const url = this.baseURL.endsWith("/v1") || this.baseURL.endsWith("/v1/")
      ? `${this.baseURL.replace(/\/+$/, "")}/chat/completions`
      : `${this.baseURL}/v1/chat/completions`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new ProviderError(`Custom provider (${this.name}) error: ${response.status} - ${error}`, response.status, this.name);
    }

    return parseOpenAIResponse((await response.json()) as any);
  }

  async chatStream(
    messages: ChatMessage[],
    options?: ChatOptions,
    onChunk?: (chunk: StreamChunk) => void
  ): Promise<ChatResponse> {
    const body = buildRequestBody(messages, options, this.defaultModel, true);

    const url = this.baseURL.endsWith("/v1") || this.baseURL.endsWith("/v1/")
      ? `${this.baseURL.replace(/\/+$/, "")}/chat/completions`
      : `${this.baseURL}/v1/chat/completions`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new ProviderError(`Custom provider (${this.name}) error: ${response.status} - ${error}`, response.status, this.name);
    }

    return parseOpenAIStream(response, onChunk);
  }

  isAvailable(): boolean {
    return !!this.baseURL;
  }
}
