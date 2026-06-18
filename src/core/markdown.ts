/**
 * Shared markdown block parser — the single source of truth for segmenting
 * model output into structural blocks. Both the TUI (Blessed) and the GUI (HTML)
 * renderers consume the block list produced here.
 *
 * The parser classifies lines into three block kinds, using the exact heuristics
 * the original TUI renderer relied on (so behavior is preserved):
 *
 *   - **code**   fenced code blocks (` ``` ` / ` ~~~ `), carrying language + diff coloring
 *   - **diff**   standalone unified-diff runs (a hunk, or mixed +/- lines)
 *   - **prose**  everything else — free-form markdown the renderers format as they wish
 *
 * The parser never throws: an unterminated fence simply yields an incomplete code
 * block (no closing marker). It performs no escaping — that is each renderer's job,
 * so output is safe for its target surface (Blessed tags vs. HTML).
 */

export type DiffLineKind = "add" | "del" | "hunk" | "ctx";

export type MarkdownBlock =
  | { kind: "code"; lang: string; lines: string[]; complete: boolean }
  | { kind: "diff"; lines: string[] }
  | { kind: "prose"; text: string }
  // New block kinds (additive — see parseMarkdownBlocks):
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: "hr" }
  | { kind: "table"; rows: string[][]; header: string[]; align: ("left" | "center" | "right")[] }
  | { kind: "tasklist"; items: { checked: boolean; text: string }[] }
  | { kind: "list"; items: string[] };

/** Classify a line as a unified-diff marker line, or null if it isn't one. */
export function diffKind(line: string): DiffLineKind | null {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return null;
}

/** ATX heading match → { level, text }, else null. */
function matchHeading(trimmed: string): { level: number; text: string } | null {
  const m = trimmed.match(/^(#{1,6})\s+(.*)$/);
  if (!m) return null;
  return { level: m[1].length, text: m[2].replace(/\s*#+\s*$/, "").trim() };
}

/** Thematic break: 3+ of -, *, or _ with optional spaces, alone on the line. */
function isThematicBreak(trimmed: string): boolean {
  return /^( {0,3})(-{3,}|\*{3,}|_{3,})[ \t]*$/.test(trimmed);
}

/** GFM table separator row: | --- | :--: | -: | etc. Returns alignments or null. */
function tableSepAlign(trimmed: string): ("left" | "center" | "right")[] | null {
  const cells = trimmed.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  if (cells.length === 0) return null;
  const aligns: ("left" | "center" | "right")[] = [];
  for (const c of cells) {
    if (!/^[ ]*:?-{2,}:?[ ]*$/.test(c)) return null;
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    aligns.push(left && right ? "center" : right ? "right" : "left");
  }
  return aligns;
}

/** Split a GFM table row into trimmed cells. */
function tableRow(trimmed: string): string[] {
  return trimmed.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
}

/** True if the (already trim-started) line opens/closes a fenced block. */
export function isFence(trimmed: string): boolean {
  return trimmed.startsWith("```") || trimmed.startsWith("~~~");
}

/** Extract the language tag following the opening fence. */
export function fenceLang(trimmed: string): string {
  return trimmed.replace(/^[`~]+/, "").trim();
}

/**
 * Parse model markdown into structural blocks. Pure & deterministic.
 *
 * @param text Raw assistant text (may contain fences, diffs, inline markdown).
 * @returns    Ordered list of blocks.
 */
export function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  if (text === "") return [];

  const lines = text.split("\n");
  const blocks: MarkdownBlock[] = [];
  let prose: string[] = [];

  const flushProse = (): void => {
    if (prose.length) {
      blocks.push({ kind: "prose", text: prose.join("\n") });
      prose = [];
    }
  };

  let i = 0;
  let inCode = false;
  let codeLang = "";
  let codeLines: string[] = [];

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // --- fenced code blocks -------------------------------------------------
    if (isFence(trimmed)) {
      if (inCode) {
        flushProse();
        blocks.push({ kind: "code", lang: codeLang, lines: codeLines, complete: true });
        inCode = false;
        codeLines = [];
        codeLang = "";
      } else {
        flushProse();
        inCode = true;
        codeLang = fenceLang(trimmed);
        codeLines = [];
      }
      i++;
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      i++;
      continue;
    }

    // --- ATX headings -------------------------------------------------------
    const heading = matchHeading(trimmed);
    if (heading) {
      flushProse();
      blocks.push({
        kind: "heading",
        level: Math.min(6, heading.level) as 1 | 2 | 3 | 4 | 5 | 6,
        text: heading.text,
      });
      i++;
      continue;
    }

    // --- thematic break (hr) ------------------------------------------------
    if (isThematicBreak(trimmed)) {
      flushProse();
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }

    // --- GFM table (header + separator + rows) ------------------------------
    if (trimmed.startsWith("|") && i + 1 < lines.length) {
      const align = tableSepAlign(lines[i + 1].trim());
      if (align) {
        const header = tableRow(trimmed);
        let j = i + 2;
        const rows: string[][] = [];
        while (j < lines.length && lines[j].trim().startsWith("|")) {
          rows.push(tableRow(lines[j].trim()));
          j++;
        }
        flushProse();
        blocks.push({ kind: "table", header, align, rows });
        i = j;
        continue;
      }
    }

    // --- GFM task list (- [ ] / - [x]) -------------------------------------
    const taskItem = trimmed.match(/^[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (taskItem) {
      const items: { checked: boolean; text: string }[] = [];
      let j = i;
      while (j < lines.length) {
        const tm = lines[j].trim().match(/^[-*+]\s+\[([ xX])\]\s+(.*)$/);
        if (!tm) break;
        items.push({ checked: tm[1].toLowerCase() === "x", text: tm[2] });
        j++;
      }
      flushProse();
      blocks.push({ kind: "tasklist", items });
      i = j;
      continue;
    }

    // --- standalone diff runs (only when it clearly looks like a diff) ------
    if (diffKind(line) !== null) {
      let j = i;
      while (j < lines.length && !isFence(lines[j].trimStart()) && diffKind(lines[j]) !== null) {
        j++;
      }
      const run = lines.slice(i, j);
      const hasHunk = run.some((l) => diffKind(l) === "hunk");
      const hasAdd = run.some((l) => diffKind(l) === "add");
      const hasDel = run.some((l) => diffKind(l) === "del");
      if (hasHunk || (hasAdd && hasDel)) {
        flushProse();
        blocks.push({ kind: "diff", lines: run });
      } else {
        // Not really a diff — keep it as prose (e.g. a lone "- item" bullet).
        prose.push(...run);
      }
      i = j;
      continue;
    }

    // --- ordinary prose -----------------------------------------------------
    prose.push(line);
    i++;
  }

  // Close a still-open fence: render what we collected as code (no footer).
  if (inCode) {
    flushProse();
    blocks.push({ kind: "code", lang: codeLang, lines: codeLines, complete: false });
  } else {
    flushProse();
  }

  return blocks;
}
