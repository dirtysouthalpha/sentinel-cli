/**
 * Pure, side-effect-free input logic for the TUI's raw-stdin line editor.
 *
 * TUIApp owns the terminal state (the blessed widgets, the live buffer/cursor)
 * and all rendering; this module owns the *decisions* — how a keypress or escape
 * sequence transforms a `{buffer, cursor}`, what a CSI sequence means, how Tab
 * completion resolves, and how Up/Down walk the history. Keeping these as pure
 * functions makes the historically-quirky input path unit-testable.
 */

// Re-export the word-motion/kill-line primitives so callers can import every
// editing decision from one module (`input.ts`).
export {
  wordBack,
  wordForward,
  killToEnd,
  killToStart,
  killWordBack,
  killWordForward,
  type LineEdit,
} from "./input-keys.js";

/** A text buffer with a caret position within it. */
export interface LineState {
  buffer: string;
  cursor: number;
}

/** Clamp a caret into the valid range [0, buffer.length]. */
export function clampCursor(buffer: string, cursor: number): number {
  return Math.max(0, Math.min(cursor, buffer.length));
}

/** Insert `text` at the caret, advancing the caret past it. */
export function insertText(s: LineState, text: string): LineState {
  const cur = clampCursor(s.buffer, s.cursor);
  return {
    buffer: s.buffer.slice(0, cur) + text + s.buffer.slice(cur),
    cursor: cur + text.length,
  };
}

/** Delete the character before the caret (Backspace). No-op at column 0. */
export function backspace(s: LineState): LineState {
  if (s.cursor <= 0) return { buffer: s.buffer, cursor: 0 };
  return {
    buffer: s.buffer.slice(0, s.cursor - 1) + s.buffer.slice(s.cursor),
    cursor: s.cursor - 1,
  };
}

/** Delete the character at the caret (Delete / `3~`). No-op at end of line. */
export function deleteForward(s: LineState): LineState {
  if (s.cursor >= s.buffer.length) return s;
  return {
    buffer: s.buffer.slice(0, s.cursor) + s.buffer.slice(s.cursor + 1),
    cursor: s.cursor,
  };
}

export function moveLeft(s: LineState): LineState {
  return { buffer: s.buffer, cursor: Math.max(0, s.cursor - 1) };
}
export function moveRight(s: LineState): LineState {
  return { buffer: s.buffer, cursor: Math.min(s.buffer.length, s.cursor + 1) };
}
export function moveHome(s: LineState): LineState {
  return { buffer: s.buffer, cursor: 0 };
}
export function moveEnd(s: LineState): LineState {
  return { buffer: s.buffer, cursor: s.buffer.length };
}

/** A semantic action decoded from a CSI/SS3 escape-sequence body. */
export type CsiAction =
  | "up"
  | "down"
  | "left"
  | "right"
  | "wordLeft"
  | "wordRight"
  | "home"
  | "end"
  | "delete"
  | "pageUp"
  | "pageDown"
  | "none";

/**
 * Decode a CSI/SS3 sequence body (params + final byte) into an action, e.g.
 * "A" -> up, "1;5C" -> right (or wordRight when the `;5` Ctrl-modifier param is
 * present), "3~" -> delete, "1~"/"7~" -> home, "4~"/"8~" -> end.
 */
export function parseCsi(seq: string): CsiAction {
  const final = seq.slice(-1);
  const hasCtrlMod = /;5/.test(seq); // Ctrl+arrow sends params like "1;5C"
  switch (final) {
    case "A":
      return "up";
    case "B":
      return "down";
    case "C":
      return hasCtrlMod ? "wordRight" : "right";
    case "D":
      return hasCtrlMod ? "wordLeft" : "left";
    case "H":
      return "home";
    case "F":
      return "end";
    case "~":
      if (seq.startsWith("1") || seq.startsWith("7")) return "home";
      if (seq.startsWith("4") || seq.startsWith("8")) return "end";
      if (seq.startsWith("3")) return "delete";
      if (seq.startsWith("5")) return "pageUp";
      if (seq.startsWith("6")) return "pageDown";
      return "none";
    default:
      return "none";
  }
}

/** Result of Tab-completing the leading /command token. */
export type CompleteResult =
  | { kind: "none" }
  | { kind: "single"; line: string; cursor: number }
  | { kind: "multi"; line: string | null; cursor: number; candidates: string[] };

/**
 * Shell-style completion of the leading `/command` word. `names` are command
 * names without their leading slash. A single match fills the line; multiple
 * matches extend to the longest common prefix (when longer than the typed
 * partial) and report the candidates.
 */
export function completeCommand(buffer: string, names: string[]): CompleteResult {
  if (!buffer.startsWith("/") || buffer.includes(" ")) return { kind: "none" };
  const partial = buffer.slice(1).toLowerCase();
  const matches = names.filter((n) => n.toLowerCase().startsWith(partial));
  if (matches.length === 0) return { kind: "none" };
  if (matches.length === 1) {
    return { kind: "single", line: `/${matches[0]} `, cursor: matches[0].length + 2 };
  }
  // Longest common prefix (case-insensitive compare, original casing preserved).
  const lcp = matches.reduce((a, b) => {
    let i = 0;
    while (i < a.length && i < b.length && a[i].toLowerCase() === b[i].toLowerCase()) i++;
    return a.slice(0, i);
  });
  if (lcp.length > partial.length) {
    return { kind: "multi", line: `/${lcp}`, cursor: lcp.length + 1, candidates: matches };
  }
  return { kind: "multi", line: null, cursor: 0, candidates: matches };
}

/** Snapshot of input-history navigation state. */
export interface HistoryState {
  history: string[];
  /** -1 = editing a fresh line (not browsing history). */
  index: number;
  /** The in-progress line stashed when history browsing began. */
  draft: string;
  /** The current buffer contents. */
  buffer: string;
}

/** The next history position and the line to show for it. */
export interface HistoryStep {
  index: number;
  draft: string;
  /** New buffer contents; the caret goes to its end. */
  line: string;
}

/**
 * Step through input history (dir -1 = older, +1 = newer). Returns null when
 * there is nothing to do (empty history, or already on the fresh line going
 * newer). Mirrors the original recallHistory state machine exactly.
 */
export function stepHistory(s: HistoryState, dir: number): HistoryStep | null {
  if (s.history.length === 0) return null;
  let index = s.index;
  let draft = s.draft;
  if (index === -1) {
    if (dir > 0) return null; // already on the fresh line
    draft = s.buffer;
    index = s.history.length - 1;
  } else {
    index += dir;
  }
  let line: string;
  if (index >= s.history.length) {
    index = -1;
    line = draft;
  } else if (index < 0) {
    index = 0;
    line = s.history[0];
  } else {
    line = s.history[index];
  }
  return { index, draft, line };
}
