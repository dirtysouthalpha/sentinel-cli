/**
 * Pure block-list diff for the GUI's incremental renderChat (Phase C1).
 *
 * The old renderChat did `chat.innerHTML = ""` and re-appended every block on
 * every non-token event, re-firing the CSS rise-animation across the whole
 * transcript (flicker/jank). diffBlocks finds the longest common PREFIX of two
 * block arrays and returns what to append + where to start replacing, so
 * renderChat can patch the DOM instead of rebuilding it.
 *
 * Identity is by reference equality. The GUI keeps `blocks` as the source of
 * truth and slices it; appending a new block object is a new reference, so the
 * prefix check naturally keeps unchanged history intact. An edit/regenerate
 * (replace-the-tail) breaks the chain at the edited index, exactly as wanted.
 *
 * Pure + dependency-free → unit-testable without a DOM.
 */
export interface RenderDiff {
  /** Index in `next` from which blocks differ (and must be appended). 0..next.length. */
  replaceFrom: number;
  /** The blocks to append (next[replaceFrom..]). */
  append: unknown[];
}

export function diffBlocks(prev: unknown[], next: unknown[]): RenderDiff {
  const n = Math.min(prev.length, next.length);
  let i = 0;
  while (i < n && prev[i] === next[i]) i++;
  return { replaceFrom: i, append: next.slice(i) };
}
