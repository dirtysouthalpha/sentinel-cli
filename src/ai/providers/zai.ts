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

const log = createLogger({ prefix: "zai" });

const ZAI_CODING_BASE = "https://api.z.ai/api/coding/paas/v4";
const ZAI_STANDARD_BASE = "https://api.z.ai/api/paas/v4";

export class ZAIProvider implements AIProvider {
  name = "zai";
  private apiKey: string;
  private baseURL: string;
  private defaultModel: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey || process.env.ZAI_API_KEY || process.env.ZHIPU_API_KEY || "";
    const useCoding = config.codingPlan !== false && this.apiKey;
    this.baseURL = config.baseURL || (useCoding ? ZAI_CODING_BASE : ZAI_STANDARD_BASE);
    this.defaultModel = config.defaultModel || "glm-4.6";
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    if (!this.apiKey) throw new Error("Z.ai API key not configured. Set ZAI_API_KEY or run /connect");

    const body = buildRequestBody(messages, options, this.defaultModel, false);

    const response = await fetch(`${this.baseURL}/chat/completions`, {
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
      throw new ProviderError(`Z.ai API error: ${response.status} - ${error}`, response.status, "zai");
    }

    return parseOpenAIResponse((await response.json()) as any);
  }

  async chatStream(
    messages: ChatMessage[],
    options?: ChatOptions,
    onChunk?: (chunk: StreamChunk) => void
  ): Promise<ChatResponse> {
    if (!this.apiKey) throw new Error("Z.ai API key not configured. Set ZAI_API_KEY or run /connect");

    const body = buildRequestBody(messages, options, this.defaultModel, true);

    const response = await fetch(`${this.baseURL}/chat/completions`, {
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
      throw new ProviderError(`Z.ai API error: ${response.status} - ${error}`, response.status, "zai");
    }

    return parseOpenAIStream(response, onChunk);
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }
}
