/**
 * formatApprovalPrompt — pure helper for the diff-at-approval gate.
 *
 * When the permission engine returns "ask" for a file mutation, the caller
 * builds the approval prompt from this function so the user sees the actual
 * diff (LCS) instead of approving a blind filename. Joins the existing
 * renderWriteDiff with a file-path header and an approve/reject footer.
 *
 * Pure: no I/O, no permission engine dependency. Fully tested.
 */

import { renderWriteDiff } from "../tools/file.js";

/**
 * Build the diff string shown at the permission gate.
 *
 * @param prior     The file's current content (empty string for new files).
 * @param next      The proposed new content.
 * @param filePath  The file being edited (for the header).
 * @param maxLines  Cap on diff lines (default 40) to keep the prompt readable.
 * @returns         A multi-line string: header + diff + approve/reject footer.
 */
export function formatApprovalPrompt(
  prior: string,
  next: string,
  filePath: string,
  maxLines = 40
): string {
  const isNew = !prior;
  const diff = isNew ? `+ ${next.split("\n").slice(0, maxLines).join("\n+ ")}` : renderWriteDiff(prior, next, maxLines);
  const header = isNew ? `(new file) ${filePath}` : filePath;
  return `${header}\n${diff}\n— approve? (y/n)`;
}
