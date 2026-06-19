/**
 * Build the model-driven summarizer used by AgentRunner's overflow recovery.
 *
 * The runner calls `summarize(unitTexts)` with the text of each archival
 * conversation unit; this fn runs a single non-streaming provider.chat to
 * condense them into one summary, which replaces the units in context.
 *
 * Kept tiny and dependency-light: it's a function of (provider, model), so
 * every call site (TUI, headless CLI) builds the same summarizer with zero
 * duplicated logic. Falls back to the lossy concat inside the context manager
 * if the call rejects (see compactWithSummarizer).
 */

import type { AIProvider } from "../ai/types.js";

/** Build a summarize fn bound to a provider + model. */
export function makeCompactionSummarizer(
  provider: AIProvider,
  model?: string
): (unitTexts: string[]) => Promise<string> {
  return async (unitTexts: string[]): Promise<string> => {
    const joined = unitTexts
      .map((t, i) => `--- Unit ${i + 1} ---\n${t}`)
      .join("\n\n");

    const resp = await provider.chat(
      [
        {
          role: "system",
          content:
            "You are a conversation summarizer. Condense the following conversation units into a single " +
            "dense summary that preserves: decisions made, files touched, commands run and their outcomes, " +
            "open questions, and the current task state. Drop pleasantries and redundancy. Be terse.",
        },
        {
          role: "user",
          content: `Summarize these conversation turns:\n\n${joined}`,
        },
      ],
      { model, temperature: 0, maxTokens: 1024 }
    );

    return resp.content?.trim() || "(summary unavailable)";
  };
}
