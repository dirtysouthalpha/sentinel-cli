/**
 * Fuzzy subsequence matcher (V13 groundwork — command palette / file finder).
 * Pure + dependency-free. Scores how well a query matches a target as an ordered
 * subsequence, rewarding consecutive runs, word-boundary/camelCase starts, and an
 * early first match. Returns matched character indices for highlighting.
 */

export interface FuzzyResult {
  score: number;
  /** indices in the target that were matched (for highlighting). */
  indices: number[];
}

const isBoundary = (prev: string | undefined, ch: string): boolean => {
  if (prev === undefined) return true;
  if (/[^A-Za-z0-9]/.test(prev)) return true; // after a separator
  if (/[a-z]/.test(prev) && /[A-Z]/.test(ch)) return true; // camelCase hump
  return false;
};

/** Match `query` against `target` (case-insensitive). Returns null if not a subsequence. */
export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  if (!query) return { score: 0, indices: [] };
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const indices: number[] = [];

  let qi = 0;
  let score = 0;
  let run = 0;
  let firstIndex = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      indices.push(ti);
      if (firstIndex < 0) firstIndex = ti;
      run += 1;
      score += 1 + run; // consecutive matches compound
      if (isBoundary(target[ti - 1], target[ti])) score += 3; // boundary bonus
      qi += 1;
    } else {
      run = 0;
    }
  }

  if (qi < q.length) return null; // query not fully consumed → no match

  // Reward early starts and exact-ish length; penalize how far the match sprawls.
  score += Math.max(0, 5 - firstIndex);
  score += q.length === t.length ? 5 : 0;
  return { score, indices };
}

export interface RankedItem<T> {
  item: T;
  score: number;
  indices: number[];
}

/** Filter + rank items by fuzzy match against a string key (default: the item itself). */
export function fuzzyFilter<T>(query: string, items: T[], key: (t: T) => string = (t) => String(t)): RankedItem<T>[] {
  const out: RankedItem<T>[] = [];
  for (const item of items) {
    const m = fuzzyMatch(query, key(item));
    if (m) out.push({ item, score: m.score, indices: m.indices });
  }
  // Higher score first; stable for ties via original order (Array.sort isn't stable
  // across all engines for large inputs, but Node's V8 sort is stable).
  return out.sort((a, b) => b.score - a.score);
}
