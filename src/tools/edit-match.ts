/**
 * Shared line-aligned block matcher used by the `file` edit/preview actions and
 * the `patch` tool's fallback. Matching is done on whole lines (not raw
 * substrings) so a search for `foo();` matches a line, never a fragment inside
 * `  foo();`. Both an exact pass and a whitespace-tolerant pass require a UNIQUE
 * match before any text is changed, so an ambiguous edit can never silently hit
 * the wrong copy.
 */

export type LineEditResult =
  | { ok: true; newContent: string; oldText: string; line: number }
  | { ok: false; error: string };

function findBlocks(
  fileLines: string[],
  searchBlock: string[],
  eq: (a: string, b: string) => boolean
): number[] {
  const starts: number[] = [];
  for (let i = 0; i + searchBlock.length <= fileLines.length; i++) {
    let hit = true;
    for (let j = 0; j < searchBlock.length; j++) {
      if (!eq(fileLines[i + j], searchBlock[j])) { hit = false; break; }
    }
    if (hit) starts.push(i);
  }
  return starts;
}

/**
 * Replace a block of whole lines (`oldText`) with `replaceText` in `content`.
 * Exact line match first (must be unique); then, unless `strictWhitespace`, a
 * whitespace-tolerant fallback that ignores each line's leading/trailing
 * whitespace (handles indentation drift, trailing spaces, CRLF).
 */
export function replaceLineBlock(
  content: string,
  oldText: string,
  replaceText: string,
  strictWhitespace = false
): LineEditResult {
  const fileLines = content.split("\n");
  const searchBlock = oldText.split("\n");

  const splice = (start: number): LineEditResult => {
    const matchedOld = fileLines.slice(start, start + searchBlock.length).join("\n");
    const newContent = [
      ...fileLines.slice(0, start),
      ...replaceText.split("\n"),
      ...fileLines.slice(start + searchBlock.length),
    ].join("\n");
    return { ok: true, newContent, oldText: matchedOld, line: start + 1 };
  };

  // 1) Exact line match — require uniqueness, or the wrong copy could be edited.
  const exact = findBlocks(fileLines, searchBlock, (a, b) => a === b);
  if (exact.length === 1) return splice(exact[0]);
  if (exact.length > 1) {
    return {
      ok: false,
      error: `Ambiguous edit: the search text appears ${exact.length} times. Include more surrounding lines so it uniquely identifies one location.`,
    };
  }

  if (strictWhitespace) {
    return { ok: false, error: "Exact text not found (strictWhitespace is on). Check the content and whitespace." };
  }

  // 2) Whitespace-tolerant fallback (still requires a unique match).
  const norm = (s: string) => s.replace(/^\s+/, "").replace(/\s+$/, "");
  const tolerant = findBlocks(fileLines, searchBlock, (a, b) => norm(a) === norm(b));
  if (tolerant.length === 0) {
    return { ok: false, error: "Text not found in file. Check the content and surrounding lines." };
  }
  if (tolerant.length > 1) {
    return {
      ok: false,
      error: `Ambiguous edit: ${tolerant.length} whitespace-insensitive matches. Include more surrounding lines to disambiguate.`,
    };
  }
  return splice(tolerant[0]);
}
