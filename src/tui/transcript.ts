/**
 * Pure helpers for bounding the chat transcript.
 *
 * The TUI keeps the whole transcript as one Blessed-tagged string and re-lays it
 * out on every paint. Left unbounded it grows forever, so a long session pays an
 * ever-increasing per-paint cost (and memory). `capTranscript` keeps only the
 * most recent lines, trimming on `\n` boundaries so a Blessed `{tag}` is never
 * split — every block the app pushes is tag-balanced per line.
 */

/** Marker prepended after trimming. Plain text only — contains no Blessed tags. */
export const TRIM_MARKER = "… earlier output trimmed …";

/**
 * Keep at most `maxLines` lines of `text`, dropping the oldest. When trimming
 * occurs, a single plain-text marker line is prepended so the user knows history
 * was elided. Returns `text` unchanged when it is already within the cap.
 *
 * Trimming happens only at newline boundaries, so partial Blessed tags are never
 * produced. `maxLines <= 0` is treated as 1 (marker + nothing useful is pointless,
 * so we keep at least the final line).
 */
export function capTranscript(text: string, maxLines: number): string {
  const cap = Math.max(1, Math.floor(maxLines));
  const lines = text.split("\n");
  if (lines.length <= cap) return text;
  const kept = lines.slice(lines.length - cap);
  return TRIM_MARKER + "\n" + kept.join("\n");
}
