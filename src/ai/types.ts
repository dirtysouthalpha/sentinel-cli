/**
 * A single piece of message content. Plain string content stays valid everywhere;
 * an array of ContentPart enables OpenAI-style multimodal (text + image) messages.
 */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[];
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

/**
 * Flatten message content to plain text. A string passes through unchanged; a
 * ContentPart[] is reduced to its concatenated text parts (images are dropped).
 * Used by legacy code paths that only understand string content.
 */
export function contentToText(content: string | ContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatResponse {
  content: string;
  model: string;
  toolCalls?: ToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason?: string;
}

export interface StreamChunk {
  content: string;
  done: boolean;
  toolCalls?: Partial<ToolCall>[];
}

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, ToolParameterSchema>;
      required?: string[];
    };
  };
}

export interface ToolParameterSchema {
  type: string;
  description?: string;
  enum?: string[];
  /** For type: "array" — the schema of each element. */
  items?: ToolParameterSchema;
  /** For type: "object" — nested property schemas. */
  properties?: Record<string, ToolParameterSchema>;
  required?: string[];
}

export interface AIProvider {
  name: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  chatStream(
    messages: ChatMessage[],
    options?: ChatOptions,
    onChunk?: (chunk: StreamChunk) => void
  ): Promise<ChatResponse>;
  isAvailable(): boolean;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  stopSequences?: string[];
  tools?: ToolDef[];
}

export interface ProviderConfig {
  apiKey?: string;
  baseURL?: string;
  models?: Record<string, ModelConfig>;
  codingPlan?: boolean;
  defaultModel?: string;
  [key: string]: unknown;
}

export interface ModelConfig {
  name: string;
  maxTokens?: number;
  supportsStreaming?: boolean;
  supportsTools?: boolean;
}
