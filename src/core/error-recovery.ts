/**
 * Error-recovery nudge for the agent loop. When a tool returns an error, the
 * raw error text alone often makes the model either give up or blindly retry
 * the same thing. This wraps a failed tool result with a bounded self-reliance
 * instruction — the model already has web/search/create_skill tools, so the nudge
 * turns "this errored" into "research this, then try a fix," and the existing
 * maxRounds loop is the engine that carries it out.
 *
 * Pure + tested. The agent runner calls `wrapToolError` on failed results before
 * appending them to context.
 */

/**
 * The recovery instruction appended to a failed tool result. Single, constant,
 * and deliberately bounded: it tells the model to research + retry, not to spawn
 * unbounded work. Kept short so it doesn't bloat the prompt.
 */
const RECOVERY_NUDGE =
  "\n\n[This tool call failed. Don't stop: use `web`/`search` to look up the error, " +
  "apply the fix, and retry. If this is a recurring gap, capture the workaround with " +
  "`create_skill`. Only report failure to the user if research can't resolve it.]";

/**
 * Wrap a failed tool result with the recovery nudge. If the result didn't error
 * (no ERROR prefix / success true), it's returned unchanged. Pure.
 *
 * @param text     The tool result text (already redacted).
 * @param ok       Whether the tool succeeded.
 * @param maxChars Cap the error text length before the nudge so a huge stack
 *                 trace doesn't drown the instruction.
 */
export function wrapToolError(text: string, ok: boolean, maxChars = 4000): string {
  if (ok) return text;
  const trimmed = text.length > maxChars ? text.slice(0, maxChars) + "\n…[truncated]" : text;
  return trimmed + RECOVERY_NUDGE;
}
