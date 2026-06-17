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
  | { kind: "prose"; text: string };

/** Classify a line as a unified-diff marker line, or null if it isn't one. */
export function diffKind(line: string): DiffLineKind | null {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return null;
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
