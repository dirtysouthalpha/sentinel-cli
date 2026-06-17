/**
 * Markdown -> Blessed-tag renderer for the chat transcript.
 *
 * This is the Blessed (TUI) surface. Structural segmentation — fenced code
 * blocks, standalone diff runs, and prose — comes from the shared
 * `parseMarkdownBlocks` in `src/core/markdown.ts` so both the TUI and the GUI
 * agree on block boundaries. This file only handles the Blessed presentation:
 * framing code blocks (opencode-style), colorizing unified-diff lines, and
 * highlighting inline `code` spans in prose.
 *
 * No singletons: callers pass the `colors` map (e.g.
 * `themeEngine.getBlessedColors()`). Every piece of user/model content is
 * escaped so it can never inject Blessed tags — the only `{...}` tokens in the
 * output are ones this module emits.
 */
import { parseMarkdownBlocks } from "../core/markdown.js";

/**
 * Escape Blessed special chars so content cannot inject tags. Single-pass so a
 * `{` -> `{open}` substitution's own `}` is not re-escaped (the naive two-step
 * `.replace(/\{/).replace(/\}/)` corrupts it into `{open}{close}`).
 */
function esc(s: string): string {
  return s.replace(/[{}]/g, (m) => (m === "{" ? "{open}" : "{close}"));
}

/**
 * Render markdown-ish assistant text into Blessed-tagged output.
 *
 * @param text   Raw assistant text (may contain fences, diffs, inline code).
 * @param colors A color map like `themeEngine.getBlessedColors()`. Keys used:
 *               cyan, lime, error, textSecondary, textTertiary, textPrimary.
 * @returns      Blessed-tagged, fully-escaped string safe to push to the chat box.
 */
export function renderMarkdown(text: string, colors: Record<string, string>): string {
  if (text === "") return "";
  const col = (k: string): string => colors[k] ?? colors.textPrimary ?? "white";

  const header = (lang: string): string => {
    const label = lang ? esc(lang) : "code";
    return `{${col("textTertiary")}-fg}╭─ ${label}{/}`;
  };
  const footer = (): string => `{${col("textTertiary")}-fg}╰─{/}`;

  // Style a single line that lives inside a fenced code block.
  const renderCodeLine = (line: string): string => {
    const e = esc(line);
    if (line.startsWith("@@")) return `{${col("cyan")}-fg}${e}{/}`;
    if (line.startsWith("+")) return `{${col("lime")}-fg}${e}{/}`;
    if (line.startsWith("-")) return `{${col("error")}-fg}${e}{/}`;
    return `{${col("textSecondary")}-fg}${e}{/}`;
  };

  // Style a standalone (un-fenced) diff line (always add/del/hunk).
  const renderDiffLine = (line: string): string => {
    const e = esc(line);
    if (line.startsWith("+")) return `{${col("lime")}-fg}${e}{/}`;
    if (line.startsWith("-")) return `{${col("error")}-fg}${e}{/}`;
    return `{${col("cyan")}-fg}${e}{/}`; // hunk
  };

  // Style a prose line: escape, then highlight inline `code` spans.
  const renderProseLine = (line: string): string => {
    const e = esc(line);
    return e.replace(/`([^`]+)`/g, (_m, code: string) => `{${col("cyan")}-fg}${code}{/}`);
  };

  const out: string[] = [];

  for (const block of parseMarkdownBlocks(text)) {
    if (block.kind === "code") {
      out.push(header(block.lang));
      for (const line of block.lines) out.push(renderCodeLine(line));
      if (block.complete) out.push(footer());
    } else if (block.kind === "diff") {
      for (const line of block.lines) out.push(renderDiffLine(line));
    } else {
      for (const line of block.text.split("\n")) out.push(renderProseLine(line));
    }
  }

  return out.join("\n");
}
