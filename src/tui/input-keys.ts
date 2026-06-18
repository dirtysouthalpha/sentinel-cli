/**
 * Readline-style word-motion and kill-line editing primitives — pure functions
 * over a (line, cursor) pair. Extracted from input.ts so they're unit-testable
 * without a TTY and reusable across key bindings (Alt+B/F, Ctrl+Arrow word-jump,
 * Ctrl+W, Alt+D, Ctrl+K/U). A "word" here is a maximal run of non-whitespace;
 * boundaries are whitespace. Matches the common terminal behavior users expect
 * from shells/editors.
 */

/** A line edit result: the new line + the new cursor offset. */
export interface LineEdit {
  line: string;
  cursor: number;
}

const isWs = (ch: string | undefined): boolean => ch === " " || ch === "\t";

/** Move cursor to the start of the word before `cursor`. Clamps at 0. */
export function wordBack(line: string, cursor: number): number {
  let i = cursor;
  while (i > 0 && isWs(line[i - 1])) i--; // skip trailing whitespace
  while (i > 0 && !isWs(line[i - 1])) i--; // skip the word
  return i;
}

/** Move cursor to the start of the word after `cursor`, or EOL if none. */
export function wordForward(line: string, cursor: number): number {
  let i = cursor;
  const n = line.length;
  while (i < n && !isWs(line[i])) i++; // skip the current word
  while (i < n && isWs(line[i])) i++; // skip following whitespace
  return i;
}

/** Delete from cursor to end of line. */
export function killToEnd(line: string, cursor: number): LineEdit {
  return { line: line.slice(0, cursor), cursor };
}

/** Delete from beginning of line to cursor, keeping the tail. */
export function killToStart(line: string, cursor: number): LineEdit {
  return { line: line.slice(cursor), cursor: 0 };
}

/** Delete the word (and any trailing whitespace gap) before the cursor. */
export function killWordBack(line: string, cursor: number): LineEdit {
  const i = wordBack(line, cursor);
  return { line: line.slice(0, i) + line.slice(cursor), cursor: i };
}

/** Delete from the cursor through the next word and its trailing whitespace. */
export function killWordForward(line: string, cursor: number): LineEdit {
  const i = wordForward(line, cursor);
  return { line: line.slice(0, cursor) + line.slice(i), cursor };
}
