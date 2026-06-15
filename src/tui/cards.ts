/**
 * Pure helpers for drawing fully-bordered "message cards" in the chat transcript.
 *
 * Blessed re-wraps any line wider than the box, which would break a right-hand
 * border `│`. So we never rely on Blessed to wrap card bodies: we measure the
 * *visible* width (ignoring Blessed `{tag}` markup) and pre-wrap the content to
 * the card's inner width ourselves, padding each line so the right border always
 * lands in the same column.
 *
 * The tag vocabulary inside card bodies is small and balanced per source line
 * (`{color-fg}…{/}` from render-markdown, plus the `{open}`/`{close}` escapes
 * that stand in for literal braces). We flatten a line into visible "cells" that
 * each remember the tag stack active at that point, wrap the cells, then re-emit
 * minimal tags per output line so every wrapped line is independently balanced.
 */

/** Escape tokens that render as a single visible char (not zero-width control). */
const ESCAPE_TAGS = new Set(["{open}", "{close}"]);

interface Cell {
  ch: string; // the visible piece ("a", "{open}", …) — always 1 column wide
  tags: string[]; // tag stack active when this cell is emitted
}

interface Token {
  tag: boolean; // true = zero-width control tag; false = a visible cell
  s: string;
}

/** Split a (possibly tagged) line into control-tag and visible tokens. */
function tokenize(line: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === "{") {
      const end = line.indexOf("}", i);
      if (end !== -1) {
        const s = line.slice(i, end + 1);
        // {open}/{close} are visible (literal braces); other {…} are control.
        toks.push({ tag: !ESCAPE_TAGS.has(s), s });
        i = end + 1;
        continue;
      }
    }
    toks.push({ tag: false, s: line[i] });
    i += 1;
  }
  return toks;
}

/** Visible column count of a tagged string (control tags count as zero). */
export function visibleLength(s: string): number {
  return tokenize(s).reduce((n, t) => n + (t.tag ? 0 : 1), 0);
}

/** Flatten a line to cells, snapshotting the open-tag stack at each visible char. */
function toCells(line: string): Cell[] {
  const cells: Cell[] = [];
  const stack: string[] = [];
  for (const t of tokenize(line)) {
    if (t.tag) {
      if (t.s === "{/}") stack.pop();
      else stack.push(t.s);
    } else {
      cells.push({ ch: t.s, tags: stack.slice() });
    }
  }
  return cells;
}

/** Greedy word-wrap a cell run to `width` columns (hard-break over-long words). */
function wrapCells(cells: Cell[], width: number): Cell[][] {
  const w = Math.max(1, width);
  const lines: Cell[][] = [];
  let cur: Cell[] = [];
  let lastBreak = -1; // index of a space in `cur` we can wrap at

  for (const cell of cells) {
    if (cur.length === w) {
      // Line is full and we still have a cell to place — wrap now.
      if (cell.ch === " ") {
        // The overflow is the separating space: drop it, start fresh.
        lines.push(cur);
        cur = [];
        lastBreak = -1;
        continue;
      }
      if (lastBreak >= 0) {
        const rest = cur.slice(lastBreak + 1); // carry the partial word over
        lines.push(cur.slice(0, lastBreak));
        cur = rest;
      } else {
        lines.push(cur); // no space to break on → hard break
        cur = [];
      }
      lastBreak = -1;
      for (let k = 0; k < cur.length; k++) if (cur[k].ch === " ") lastBreak = k;
    }
    cur.push(cell);
    if (cell.ch === " ") lastBreak = cur.length - 1;
  }
  lines.push(cur);
  return lines;
}

/** Re-emit a cell line as a balanced, minimally-tagged Blessed string. */
function renderCells(cells: Cell[]): string {
  let s = "";
  let active: string[] = [];
  for (const cell of cells) {
    let common = 0;
    while (
      common < active.length &&
      common < cell.tags.length &&
      active[common] === cell.tags[common]
    )
      common++;
    for (let k = active.length; k > common; k--) s += "{/}"; // close stale tags
    for (let k = common; k < cell.tags.length; k++) s += cell.tags[k]; // open new
    active = cell.tags;
    s += cell.ch;
  }
  for (let k = active.length; k > 0; k--) s += "{/}"; // balance at line end
  return s;
}

/**
 * Word-wrap tagged text to `width` visible columns. Hard newlines in the input
 * are preserved (and blank lines kept). Each returned line is tag-balanced.
 */
export function wrapTagged(text: string, width: number): string[] {
  return text.split("\n").flatMap((line) => wrapCells(toCells(line), width).map(renderCells));
}

export interface CardOptions {
  label: string; // role label shown in the header (plain text)
  body: string; // tagged body content (already markdown-rendered / escaped)
  width: number; // outer card width in columns
  labelColor: string; // theme color key resolved by the caller (e.g. "cyan")
  borderColor: string;
  indent?: string; // left margin prepended to every line (default 2 spaces)
}

/**
 * Render a rounded, fully-bordered message card. The body is wrapped to the
 * card's inner width and every line padded so the right border aligns.
 */
export function renderCard(opts: CardOptions): string {
  const indent = opts.indent ?? "  ";
  const width = Math.max(opts.label.length + 6, opts.width);
  const inner = width - 4; // "│ " + content + " │"
  const b = (s: string): string => `{${opts.borderColor}-fg}${s}{/}`;

  const dashFill = Math.max(0, width - 5 - opts.label.length);
  const top =
    indent +
    b("╭─ ") +
    `{${opts.labelColor}-fg}${opts.label}{/}` +
    b(" " + "─".repeat(dashFill) + "╮");
  const bottom = indent + b("╰" + "─".repeat(width - 2) + "╯");

  const lines = wrapTagged(opts.body, inner);
  const out = [top];
  for (const ln of lines) {
    const pad = " ".repeat(Math.max(0, inner - visibleLength(ln)));
    out.push(`${indent}${b("│")} ${ln}${pad} ${b("│")}`);
  }
  out.push(bottom);
  return out.join("\n");
}
