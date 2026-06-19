/**
 * classifyTurn — pure turn classification for the multi-model router.
 *
 * Inspects the messages + whether tools are in scope to decide which taskKind
 * the router should match against. This is the missing input that left the
 * router running single-model: RoutedProvider.resolveChain now calls this to
 * fill in taskKind/requiresVision before consulting the rule engine.
 *
 * Pure: no I/O, no provider access. Deterministic. Fully tested.
 */

import type { ChatMessage } from "./types.js";
import type { TaskKind } from "./router.js";

export interface TurnClassification {
  taskKind: TaskKind;
  requiresVision: boolean;
}

/** Heuristic keywords that signal a planning turn (→ plan role / strong model). */
const PLAN_KEYWORDS = ["plan", "architect", "design", "strategy", "roadmap"];

/** Keywords that signal a search/retrieval turn (→ search role). */
const SEARCH_KEYWORDS = ["find", "search", "where is", "grep", "list all", "show me all"];

/** Keywords that need the strong model even without tools in scope. */
const CODE_KEYWORDS = ["fix", "debug", "refactor", "implement", "build", "rewrite", "migrate"];

/** Extract the latest user message's text content (handles ContentPart[]). */
function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      const text = msg.content
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join(" ");
      return text;
    }
    return "";
  }
  return "";
}

/** Does any message carry an image_url content part? */
function hasImage(messages: ChatMessage[]): boolean {
  return messages.some(
    (msg) =>
      Array.isArray(msg.content) &&
      msg.content.some((p): p is { type: "image_url" } => p.type === "image_url")
  );
}

/** Lowercased substring check on a text blob. */
function matchesAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

/**
 * Classify a turn for routing. Decision tree:
 * 1. Vision (any image) → requiresVision=true (router picks a vision-capable target).
 * 2. Explicit code verbs (fix/debug/refactor/...) → taskKind=code (strong model).
 * 3. Planning verbs → taskKind=plan.
 * 4. Search verbs + tools → taskKind=search.
 * 5. Tools in scope + a non-trivial request → taskKind=code.
 * 6. Otherwise (chat, short replies, no tools) → taskKind=chat (cheap model).
 */
export function classifyTurn(
  messages: ChatMessage[],
  hasTools: boolean
): TurnClassification {
  const requiresVision = hasImage(messages);
  const text = lastUserText(messages);
  const trimmed = text.trim();
  const isShortReply = trimmed.length > 0 && trimmed.length <= 12 && !trimmed.includes("\n");

  // Vision is orthogonal to taskKind — it's a capability requirement.
  // Code verbs need the strong model even without tools this turn.
  if (matchesAny(trimmed, CODE_KEYWORDS)) {
    return { taskKind: "code", requiresVision };
  }
  if (matchesAny(trimmed, PLAN_KEYWORDS)) {
    return { taskKind: "plan", requiresVision };
  }
  if (hasTools && matchesAny(trimmed, SEARCH_KEYWORDS)) {
    return { taskKind: "search", requiresVision };
  }
  // Short follow-ups (yes/no/thanks) on a tool turn → cheap chat model.
  if (isShortReply) {
    return { taskKind: "chat", requiresVision };
  }
  // A real request with tools → code. No tools → chat (cheap).
  return { taskKind: hasTools ? "code" : "chat", requiresVision };
}
