/**
 * Pure transcript-search state machine — no TTY dependency, fully testable.
 *
 * Used by the TUI's Ctrl+F search overlay: `findAll` computes match offsets in
 * the transcript string (case-insensitive), `next`/`prev` walk them with
 * wraparound, and `indexOneBased`/`count` drive the "3/12" status display.
 * Keeping this pure means the search UI's logic is unit-tested without a
 * blessed screen.
 */
export class SearchSession {
  query = "";
  private matches: number[] = [];
  private idx = -1;

  /** Recompute matches against `text`. Returns the offsets. Empty query → []. */
  findAll(text: string): number[] {
    if (!this.query) {
      this.matches = [];
      this.idx = -1;
      return [];
    }
    const q = this.query.toLowerCase();
    const haystack = text.toLowerCase();
    const out: number[] = [];
    let from = 0;
    while (from <= haystack.length) {
      const i = haystack.indexOf(q, from);
      if (i < 0) break;
      out.push(i);
      from = i + 1; // allow overlapping matches (e.g. "aa" in "aaaa")
    }
    this.matches = out;
    this.idx = out.length ? 0 : -1;
    return out;
  }

  /** Set matches directly (for tests / precomputed offsets). */
  setMatches(m: number[]): void {
    this.matches = m;
    this.idx = m.length ? 0 : -1;
  }

  /** Current match offset, or null if none. */
  current(): number | null {
    return this.idx < 0 ? null : this.matches[this.idx];
  }

  /** Total match count. */
  count(): number {
    return this.matches.length;
  }

  /** 1-based index of the current match for display ("3/12"). 0 if none. */
  indexOneBased(): number {
    return this.idx < 0 ? 0 : this.idx + 1;
  }

  /** Advance to the next match (wraps). Returns its offset, or null. */
  next(): number | null {
    if (!this.matches.length) return null;
    this.idx = (this.idx + 1) % this.matches.length;
    return this.current();
  }

  /** Step to the previous match (wraps). Returns its offset, or null. */
  prev(): number | null {
    if (!this.matches.length) return null;
    this.idx = (this.idx - 1 + this.matches.length) % this.matches.length;
    return this.current();
  }

  reset(): void {
    this.matches = [];
    this.idx = -1;
    this.query = "";
  }
}
