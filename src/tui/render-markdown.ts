/**
 * Pure markdown -> Blessed-tag renderer for the chat transcript.
 *
 * Frames fenced code blocks (opencode-style), colorizes unified-diff lines,
 * highlights inline `code` spans, and passes prose through untouched (but
 * always escaped for Blessed). No singletons: callers pass the `colors` map
 * (e.g. `themeEngine.getBlessedColors()`).
 *
 * Every piece of user/model content is escaped so it can never inject Blessed
 * tags. The only `{...}` tokens in the output are ones this module emits.
 */

/**
 * Escape Blessed special chars so content cannot inject tags. Single-pass so a
 * `{` -> `{open}` substitution's own `}` is not re-escaped (the naive two-step
 * `.replace(/\{/).replace(/\}/)` corrupts it into `{open{close}`).
 */
function esc(s: string): string {
  return s.replace(/[{}]/g, (m) => (m === "{" ? "{open}" : "{close}"));
}

type DiffKind = "add" | "del" | "hunk" | null;

/** Classify a line as a unified-diff marker line. */
function diffKind(line: string): DiffKind {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return null;
}

/** True if the (already trim-started) line opens/closes a fenced block. */
function isFence(trimmed: string): boolean {
  return trimmed.startsWith("```") || trimmed.startsWith("~~~");
}

/** Extract the language tag following the opening fence. */
function fenceLang(trimmed: string): string {
  return trimmed.replace(/^[`~]+/, "").trim();
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
  const col = (k: string): string => colors[k] ?? colors.textPrimary ?? "white";

  const header = (lang: string): string => {
    const label = lang ? esc(lang) : "code";
    return `{${col("textTertiary")}-fg}╭─ ${label}{/}`;
  };
  const footer = (): string => `{${col("textTertiary")}-fg}╰─{/}`;

  // Style a single line that lives inside a fenced code block.
  const renderCodeLine = (line: string): string => {
    const e = esc(line);
    switch (diffKind(line)) {
      case "add":
        return `{${col("lime")}-fg}${e}{/}`;
      case "del":
        return `{${col("error")}-fg}${e}{/}`;
      case "hunk":
        return `{${col("cyan")}-fg}${e}{/}`;
      default:
        return `{${col("textSecondary")}-fg}${e}{/}`;
    }
  };

  // Style a standalone (un-fenced) diff line.
  const renderDiffLine = (line: string): string => {
    const e = esc(line);
    switch (diffKind(line)) {
      case "add":
        return `{${col("lime")}-fg}${e}{/}`;
      case "del":
        return `{${col("error")}-fg}${e}{/}`;
      default:
        return `{${col("cyan")}-fg}${e}{/}`; // hunk
    }
  };

  // Style a prose line: escape, then highlight inline `code` spans.
  const renderProseLine = (line: string): string => {
    const e = esc(line);
    return e.replace(/`([^`]+)`/g, (_m, code: string) => `{${col("cyan")}-fg}${code}{/}`);
  };

  if (text === "") return "";

  const lines = text.split("\n");
  const out: string[] = [];
  let inCode = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (isFence(trimmed)) {
      if (inCode) {
        out.push(footer());
        inCode = false;
      } else {
        out.push(header(fenceLang(trimmed)));
        inCode = true;
      }
      i++;
      continue;
    }

    if (inCode) {
      out.push(renderCodeLine(line));
      i++;
      continue;
    }

    // Outside a code block: detect a *run* of diff lines. We only colorize a
    // run when it clearly looks like a diff (contains an @@ hunk, or mixes
    // additions and deletions) so plain markdown bullets ("- item") stay prose.
    if (diffKind(line) !== null) {
      let j = i;
      while (
        j < lines.length &&
        !isFence(lines[j].trimStart()) &&
        diffKind(lines[j]) !== null
      ) {
        j++;
      }
      const run = lines.slice(i, j);
      const hasHunk = run.some((l) => diffKind(l) === "hunk");
      const hasAdd = run.some((l) => diffKind(l) === "add");
      const hasDel = run.some((l) => diffKind(l) === "del");
      if (hasHunk || (hasAdd && hasDel)) {
        for (const l of run) out.push(renderDiffLine(l));
      } else {
        for (const l of run) out.push(renderProseLine(l));
      }
      i = j;
      continue;
    }

    out.push(renderProseLine(line));
    i++;
  }

  // Robustness: an unterminated fence simply leaves `inCode` true; we never
  // throw and all remaining lines were rendered as code above.

  return out.join("\n");
}
