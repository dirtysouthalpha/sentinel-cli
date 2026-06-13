import type { AIProvider, ChatMessage } from "../ai/types.js";

export type EvalResult = "complete" | "stuck" | "continue";

export interface EvaluationOutcome {
  result: EvalResult;
  assessment: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

const EVAL_PROMPT =
  "Review the tool results in the conversation above. Assess:\n" +
  "1. Did the tools succeed?\n" +
  "2. Is the original task complete?\n" +
  "3. What should happen next?\n\n" +
  "If the task is fully complete with no remaining work, respond with exactly: TASK_COMPLETE\n" +
  "If you are stuck or looping without progress, respond with exactly: TASK_STUCK\n" +
  "Otherwise respond with one sentence describing the next step.";

export async function evaluateRound(
  messages: ChatMessage[],
  provider: AIProvider,
  model?: string
): Promise<EvaluationOutcome> {
  try {
    const response = await provider.chatStream(
      [...messages, { role: "user" as const, content: EVAL_PROMPT }],
      { model, temperature: 0.3, maxTokens: 100 }
    );

    const content = (response.content || "").trim();

    if (content.includes("TASK_COMPLETE")) {
      return { result: "complete", assessment: content, usage: response.usage };
    }
    if (content.includes("TASK_STUCK")) {
      return { result: "stuck", assessment: content, usage: response.usage };
    }
    return { result: "continue", assessment: content, usage: response.usage };
  } catch {
    return { result: "continue", assessment: "evaluation failed" };
  }
}
