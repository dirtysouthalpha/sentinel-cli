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

  // Style a prose line: escape, then highlight inline `code` spans, **bold**,
  // *italic*, and render [text](url) as "text (url)" since terminals can't click.
  const renderProseLine = (line: string): string => {
    let e = esc(line);
    // inline code (do first so the other passes don't touch its content)
    e = e.replace(/`([^`]+)`/g, (_m, code: string) => `{${col("cyan")}-fg}${code}{/}`);
    // bold
    e = e.replace(/\*\*([^*]+)\*\*/g, (_m, t: string) => `{bold}${t}{/}`);
    // italic (single * or _ around non-space text)
    e = e.replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1{italic}$2{/}");
    e = e.replace(/(^|[^\w])_([^_\s][^_]*?)_/g, "$1{italic}$2{/}");
    // links -> "text (url)"
    e = e.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t: string, u: string) => `${t} (${u})`);
    return e;
  };

  // Style a bullet/ordered list line. Preserves the marker; just escapes.
  const renderListItem = (item: string): string => `  {${col("textTertiary")}-fg}•{/} ${esc(item)}`;

  const out: string[] = [];

  for (const block of parseMarkdownBlocks(text)) {
    if (block.kind === "code") {
      out.push(header(block.lang));
      for (const line of block.lines) out.push(renderCodeLine(line));
      if (block.complete) out.push(footer());
    } else if (block.kind === "diff") {
      for (const line of block.lines) out.push(renderDiffLine(line));
    } else if (block.kind === "heading") {
      const hashes = "#".repeat(block.level);
      out.push(`{bold}{${col("accent") || col("cyan")}-fg}${hashes} ${esc(block.text)}{/}`);
    } else if (block.kind === "hr") {
      out.push(`{${col("textTertiary")}-fg}${"─".repeat(40)}{/}`);
    } else if (block.kind === "table") {
      // Simple aligned grid: header bold, a separator of dashes, then rows.
      const widths = block.header.map((h, c) =>
        Math.max(h.length, ...block.rows.map((r) => (r[c] ?? "").length))
      );
      const pad = (cells: string[]): string =>
        cells.map((c, i) => (c ?? "").padEnd(widths[i] ?? 0)).join(" │ ");
      out.push(`{bold}${esc(pad(block.header))}{/}`);
      out.push(`{${col("textTertiary")}-fg}${widths.map((w) => "─".repeat(w)).join("─┼─")}{/}`);
      for (const row of block.rows) out.push(esc(pad(row)));
    } else if (block.kind === "tasklist") {
      for (const item of block.items) {
        const box = item.checked ? `{${col("lime")}-fg}[x]{/}` : `{${col("textTertiary")}-fg}[ ]{/}`;
        out.push(`  ${box} ${esc(item.text)}`);
      }
    } else if (block.kind === "list") {
      for (const item of block.items) out.push(renderListItem(item));
    } else {
      for (const line of block.text.split("\n")) out.push(renderProseLine(line));
    }
  }

  return out.join("\n");
}
