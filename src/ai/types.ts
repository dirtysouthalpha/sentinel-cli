export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
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
  description: string;
  enum?: string[];
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
