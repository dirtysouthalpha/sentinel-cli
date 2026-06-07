import { AIProvider, ChatMessage, ChatOptions } from "../ai/types.js";

export interface SuggestedCommand {
  /** The single shell command to run, or "" if none could be produced. */
  command: string;
  /** A short explanation of what the command does (or the raw model output on parse failure). */
  explanation: string;
}

export interface SuggestCommandOptions {
  /** Override the target platform. Defaults to process.platform. */
  platform?: NodeJS.Platform;
  /** Override the model to use for the provider call. */
  model?: string;
  /** Extra ChatOptions forwarded to provider.chat (model/temperature merged). */
  chatOptions?: ChatOptions;
}

/**
 * Translate a natural-language request into ONE shell command for the current OS.
 *
 * Provider-agnostic and pure: it only touches the supplied {@link AIProvider} and
 * `opts` — no singletons, no global state. PowerShell is targeted on win32, bash
 * elsewhere. The model is instructed to emit ONLY a JSON object
 * `{"command": "...", "explanation": "..."}`; the response is parsed robustly
 * (```json fences stripped, then JSON.parse) and on any failure the raw text is
 * returned as the explanation with an empty command.
 */
export async function suggestCommand(
  provider: AIProvider,
  nl: string,
  opts: SuggestCommandOptions = {}
): Promise<SuggestedCommand> {
  const platform = opts.platform ?? process.platform;
  const isWindows = platform === "win32";
  const shell = isWindows ? "PowerShell" : "bash";

  const systemPrompt =
    `You translate a natural-language request into exactly ONE ${shell} command ` +
    `for ${isWindows ? "Windows (PowerShell)" : "a POSIX shell (bash)"}.\n` +
    `Respond with ONLY a single JSON object and nothing else — no prose, no markdown, ` +
    `no code fences. The object must have exactly two string fields:\n` +
    `{"command": "<the command>", "explanation": "<one short sentence>"}\n` +
    `The command must be a single line that can be pasted and run as-is. ` +
    `Do not include a shell prompt, leading "$", or surrounding quotes. ` +
    `If the request cannot be satisfied with one command, set "command" to "" ` +
    `and explain why in "explanation".`;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: nl },
  ];

  const chatOptions: ChatOptions = {
    temperature: 0,
    ...opts.chatOptions,
  };
  if (opts.model) chatOptions.model = opts.model;
  chatOptions.systemPrompt = systemPrompt;

  const response = await provider.chat(messages, chatOptions);
  return parseSuggestion(response.content ?? "");
}

/** Parse the model's raw text into a SuggestedCommand, tolerating fences and prose. */
function parseSuggestion(raw: string): SuggestedCommand {
  const text = (raw ?? "").trim();
  if (!text) return { command: "", explanation: "" };

  const candidate = extractJsonCandidate(text);

  try {
    const obj = JSON.parse(candidate) as Record<string, unknown>;
    const command = typeof obj.command === "string" ? obj.command.trim() : "";
    const explanation =
      typeof obj.explanation === "string" ? obj.explanation.trim() : "";
    return { command, explanation };
  } catch {
    return { command: "", explanation: text };
  }
}

/**
 * Strip ```json / ``` fences and isolate the first {...} block if surrounded by prose.
 */
function extractJsonCandidate(text: string): string {
  let s = text.trim();

  // Strip a leading ```json / ``` fence and its trailing ``` if present.
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i;
  const m = s.match(fence);
  if (m) s = m[1].trim();

  // If there's still surrounding prose, grab the first balanced-ish {...} span.
  if (!s.startsWith("{")) {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      s = s.slice(start, end + 1).trim();
    }
  }

  return s;
}
