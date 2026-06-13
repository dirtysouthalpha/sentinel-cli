import {
  ChatMessage,
  ChatOptions,
  ChatResponse,
  StreamChunk,
  ToolCall,
} from "../types.js";

export function toOpenAIMessages(messages: ChatMessage[]): unknown[] {
  const result: unknown[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      result.push({
        role: "tool",
        content: m.content,
        tool_call_id: m.toolCallId,
      });
    } else if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      result.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });
    } else {
      result.push({ role: m.role, content: m.content });
    }
  }
  return result;
}

export function buildRequestBody(
  messages: ChatMessage[],
  options: ChatOptions | undefined,
  defaultModel: string,
  stream: boolean
): Record<string, unknown> {
  const allMessages = [...messages];
  if (options?.systemPrompt) {
    allMessages.unshift({ role: "system", content: options.systemPrompt });
  }

  const body: Record<string, unknown> = {
    model: options?.model || defaultModel,
    max_tokens: options?.maxTokens || 8192,
    temperature: options?.temperature ?? 0.6,
    messages: toOpenAIMessages(allMessages),
    stream,
  };

  if (options?.tools && options.tools.length > 0) {
    body.tools = options.tools.map((t) => ({ type: "function", function: t.function }));
  }

  if (options?.stopSequences) {
    body.stop = options.stopSequences;
  }

  return body;
}

interface OpenAIChoice {
  message?: {
    content?: string;
    tool_calls?: Array<{
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
  finish_reason?: string;
}

interface OpenAIResponse {
  choices: OpenAIChoice[];
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export function parseOpenAIResponse(data: OpenAIResponse): ChatResponse {
  const choice = data.choices?.[0];
  const msg = choice?.message;

  // Guard against malformed tool calls (missing function/name) from quirky
  // providers — a single bad entry must not throw and kill the whole response.
  const toolCalls: ToolCall[] | undefined = msg?.tool_calls
    ?.map((tc, i) => ({
      id: tc.id || `call_${i}`,
      name: tc.function?.name || "",
      arguments: tc.function?.arguments ?? "",
    }))
    .filter((tc) => tc.name);

  return {
    content: msg?.content || "",
    model: data.model,
    toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    finishReason: choice?.finish_reason,
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens || 0,
          completionTokens: data.usage.completion_tokens || 0,
          totalTokens: data.usage.total_tokens || 0,
        }
      : undefined,
  };
}

export async function parseOpenAIStream(
  response: Response,
  onChunk?: (chunk: StreamChunk) => void
): Promise<ChatResponse> {
  const fullContent: string[] = [];
  const toolCallMap = new Map<number, { id: string; name: string; args: string }>();
  let model = "";
  let usageData: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
  let finishReason = "";

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
        // The space after "data:" is optional in SSE; some OpenAI-compatible
        // endpoints emit "data:{...}". Handle both, or content is silently lost.
        const trimmed = line.trimStart();
        if (trimmed.startsWith("data:")) {
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.content) {
              fullContent.push(delta.content);
              onChunk?.({ content: delta.content, done: false });
            }
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!toolCallMap.has(idx)) {
                  toolCallMap.set(idx, {
                    id: tc.id || `call_${idx}`,
                    name: tc.function?.name || "",
                    args: "",
                  });
                }
                const existing = toolCallMap.get(idx)!;
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.name = tc.function.name;
                if (tc.function?.arguments) existing.args += tc.function.arguments;
              }
            }
            if (parsed.model) model = parsed.model;
            if (parsed.choices?.[0]?.finish_reason) finishReason = parsed.choices[0].finish_reason;
            if (parsed.usage) {
              usageData = {
                promptTokens: parsed.usage.prompt_tokens || 0,
                completionTokens: parsed.usage.completion_tokens || 0,
                totalTokens: parsed.usage.total_tokens || 0,
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
    ? Array.from(toolCallMap.values()).map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.args,
      }))
    : undefined;

  return {
    content: fullContent.join(""),
    model,
    toolCalls,
    finishReason,
    usage: usageData,
  };
}
