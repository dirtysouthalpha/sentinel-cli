/**
 * Model context-window sizes (total tokens), used to size conversation
 * compaction. Matched by the longest key that is a substring of the model id,
 * mirroring pricing.ts. Values are deliberately CONSERVATIVE: under-estimating
 * a window just compacts a little early (safe); over-estimating risks an
 * overflow error mid-run (not safe). Unknown models fall back to DEFAULT.
 */

export const DEFAULT_CONTEXT_WINDOW = 128_000;

export const CONTEXT_WINDOWS: Record<string, number> = {
  "claude-opus": 200_000,
  "claude-sonnet": 200_000,
  "claude-haiku": 200_000,
  "gpt-4o": 128_000,
  "gpt-4.1": 1_000_000,
  "o1": 200_000,
  "gemini-1.5-pro": 1_000_000,
  "gemini-1.5-flash": 1_000_000,
  "gemini-2": 1_000_000,
  "glm-4.5": 128_000,
  "glm-4.6": 128_000,
  "glm-4": 128_000,
  "glm-5": 200_000,
};

/** Total context window for a model id (longest substring match). */
export function getContextWindow(model: string): number {
  if (!model) return DEFAULT_CONTEXT_WINDOW;
  const id = model.toLowerCase();
  let best: { key: string; size: number } | null = null;
  for (const [key, size] of Object.entries(CONTEXT_WINDOWS)) {
    if (id.includes(key) && (!best || key.length > best.key.length)) {
      best = { key, size };
    }
  }
  return best ? best.size : DEFAULT_CONTEXT_WINDOW;
}

/**
 * The token budget at which to start compacting: a fraction of the full window,
 * leaving headroom for the model's response and for estimate error.
 */
export function compactionBudget(model: string, fraction = 0.75): number {
  return Math.floor(getContextWindow(model) * fraction);
}
