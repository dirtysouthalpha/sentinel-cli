import type { ConversationMessage } from "./context.js";

/**
 * Pure compaction strategy for the context window (Phase 2 / long-context item).
 *
 * The OLD compact() joined everything-but-the-last-6-messages into one big
 * "Earlier in this conversation: <blob>" string — crude, structureless, and it
 * could split an assistant→tool pair (which 400s on OpenAI). This module owns
 * the DECISION of what survives a compaction, as pure functions, so it's unit-
 * testable without a model. The ContextManager calls into here.
 *
 * Strategy:
 *   1. KEEP verbatim: the system prompt, and the most recent `keepRecent` turns.
 *   2. SUMMARIZE: the middle "archival" run, chunked by COHESION (a user turn +
 *      everything until the next user turn = one summary unit), so each summary
 *      is coherent. Never split an assistant→tool pair — tool messages stick to
 *      their preceding assistant turn.
 *   3. The caller supplies the `summarize(units)` function (the model call); if
 *      absent, units are concatenated plainly (the legacy behavior, for tests +
 *      offline use).
 *
 * Invariants a compaction must never violate (asserted here):
 *   - The first message (system) is preserved verbatim.
 *   - No tool-role message ends up first among the summarized unit's messages
 *     and none is orphaned from its assistant turn.
 */

/** A coherent chunk to summarize: a user turn + the assistant/tool turns that follow it. */
export interface SummaryUnit {
  /** Indices into the original message array (for debugging/traceability). */
  indices: number[];
  /** The messages in this unit. */
  messages: ConversationMessage[];
}

/** The compaction plan: what to keep verbatim, and what to summarize as units. */
export interface CompactionPlan {
  /** Messages kept as-is (system + recent), by index. */
  keepIndices: number[];
  /** Cohesive units to summarize, in order. */
  summarizeUnits: SummaryUnit[];
}

/**
 * Split the "archival" middle (everything between the system prompt and the
 * recent window) into cohesive summary units. Each unit starts at a user turn
 * and includes everything up to (but not including) the next user turn. Tool
 * messages always stay attached to their preceding assistant turn (so a unit
 * never begins with a tool message and a pair is never split).
 */
export function chunkSummaryUnits(archival: ConversationMessage[], startIndex: number): SummaryUnit[] {
  const units: SummaryUnit[] = [];
  let current: SummaryUnit | null = null;
  archival.forEach((msg, i) => {
    const absIdx = startIndex + i;
    const startsNewUnit = msg.role === "user" || (msg.role === "system" && current === null);
    if (startsNewUnit) {
      if (current) units.push(current);
      current = { indices: [absIdx], messages: [msg] };
    } else {
      // assistant / tool / orphan system → attach to the current unit so we
      // never split an assistant→tool pair and never start a unit with a tool.
      if (!current) current = { indices: [], messages: [] };
      current.indices.push(absIdx);
      current.messages.push(msg);
    }
  });
  if (current) units.push(current);
  return units;
}

/**
 * Build a compaction plan: keep system + the last `keepRecent` messages verbatim;
 * summarize the middle as cohesive units. Pure.
 *
 * @param messages   The full conversation (system first).
 * @param keepRecent How many trailing messages to keep verbatim. Default 6.
 */
export function planCompaction(messages: ConversationMessage[], keepRecent = 6): CompactionPlan {
  if (messages.length === 0) return { keepIndices: [], summarizeUnits: [] };
  // Always keep the system prompt (index 0 if it's a system message).
  const keepSet = new Set<number>();
  let firstNonSystem = 0;
  if (messages[0].role === "system") {
    keepSet.add(0);
    firstNonSystem = 1;
  }
  // Keep the most recent `keepRecent` messages, but never let the archival
  // window start mid-pair (a tool message with no preceding assistant).
  let archivalStart = firstNonSystem;
  let recentStart = Math.max(firstNonSystem, messages.length - keepRecent);
  // Walk the recent window's left edge back if it begins with tool messages —
  // those belong to the assistant turn just before them and must stay attached.
  while (recentStart > firstNonSystem && messages[recentStart].role === "tool") {
    recentStart -= 1;
  }
  for (let i = recentStart; i < messages.length; i++) keepSet.add(i);
  archivalStart = firstNonSystem;
  const archival = messages.slice(archivalStart, recentStart);
  const units = chunkSummaryUnits(archival, archivalStart);
  return { keepIndices: [...keepSet].sort((a, b) => a - b), summarizeUnits: units };
}

/**
 * Flatten a summary unit to the text the summarizer will condense. Joins
 * messages with role tags so the summary model sees who said what.
 */
export function unitToText(unit: SummaryUnit): string {
  return unit.messages
    .map((m) => {
      const name = (m.metadata as { name?: string } | undefined)?.name;
      const who = m.role === "tool" ? `tool(${name ?? "?"})` : m.role;
      return `[${who}] ${m.content}`;
    })
    .join("\n");
}

/** True if applying this plan would never split an assistant→tool pair or
 *  orphan a tool message. Used as a self-check in tests + at apply time. */
export function planIsSafe(messages: ConversationMessage[], plan: CompactionPlan): boolean {
  const kept = new Set(plan.keepIndices);
  // No tool message may be kept while its immediately-preceding assistant is
  // summarized away (that would leave an orphan tool result).
  for (const idx of plan.keepIndices) {
    if (messages[idx].role === "tool" && idx > 0 && !kept.has(idx - 1) && messages[idx - 1].role === "assistant") {
      return false;
    }
  }
  // No summary unit may START with a tool message.
  for (const unit of plan.summarizeUnits) {
    if (unit.messages.length && unit.messages[0].role === "tool") return false;
  }
  return true;
}
