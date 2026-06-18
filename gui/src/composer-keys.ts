/**
 * Pure global keymap for the GUI (E1). Decodes a KeyboardEvent-shaped object
 * into an action string (or null) — unit-testable without a DOM, and the single
 * source of truth the document keydown listener consults. Matches the shortcuts
 * Claude Code / opencode users expect.
 */
export type KeyAction = "palette" | "search" | "focusComposer" | "cheatsheet";

export function resolveKey(e: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
}): KeyAction | null {
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key;
  if (mod && k.toLowerCase() === "k") return "palette";
  if (mod && k.toLowerCase() === "f") return "search";
  if (mod && k.toLowerCase() === "l") return "focusComposer";
  // ? is shift+/ — only when no cmd/ctrl (so it doesn't fight Cmd+?).
  if (!mod && e.shiftKey && k === "?") return "cheatsheet";
  return null;
}
