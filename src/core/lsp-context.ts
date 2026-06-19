/**
 * LSP → context formatter — pure layer.
 *
 * Turns raw LSP spec objects (Location, Diagnostic) into the short, human-
 * readable strings the agent and the user see. Pure: no I/O, no manager
 * dependency. The manager hands results here; this shapes them for display.
 *
 * Convention: LSP line/character are 0-based; we display 1-based (like every
 * editor), so a definition at LSP line 41 char 9 shows as path:42:10.
 */

import type { LSPLocation, LSPDiagnostic } from "./lsp-client.js";

/** Decode a file:// URI to a filesystem path. */
export function uriToPath(uri: string): string {
  if (!uri.startsWith("file://")) return uri;
  return decodeURI(uri.slice("file://".length).replace(/%23/g, "#"));
}

/** Best-effort relative path for display; falls back to the full path. */
export function displayPath(absPath: string): string {
  const cwd = process.cwd();
  if (absPath.startsWith(cwd + "/")) return absPath.slice(cwd.length + 1);
  return absPath;
}

/** Map an LSP severity int to a lowercase label. Defaults to "error". */
export function severityLabel(severity: number | undefined): string {
  switch (severity) {
    case 1:
      return "error";
    case 2:
      return "warning";
    case 3:
      return "info";
    case 4:
      return "hint";
    default:
      return "error";
  }
}

/** Format a single Location as path:line:col (1-based). */
export function formatLocation(loc: LSPLocation): string {
  const path = displayPath(uriToPath(loc.uri));
  return `${path}:${loc.range.start.line + 1}:${loc.range.start.character + 1}`;
}

/** Cap for the references list — beyond this, truncate with a note. */
export const REF_CAP = 20;

/** Format a definition result. */
export function formatDefinition(loc: LSPLocation | null): string {
  if (!loc) return "no definition found";
  return `defined at ${formatLocation(loc)}`;
}

/**
 * Format a references list: dedupe by path:line:col, cap at REF_CAP, note
 * truncation. Empty → "no references found".
 */
export function formatReferences(locs: LSPLocation[]): string {
  if (locs.length === 0) return "no references found";

  const seen = new Set<string>();
  const deduped: LSPLocation[] = [];
  for (const loc of locs) {
    const key = formatLocation(loc);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(loc);
  }

  const total = deduped.length;
  const capped = deduped.slice(0, REF_CAP);
  const lines = capped.map((loc) => `  - ${formatLocation(loc)}`);

  if (total > REF_CAP) {
    lines.push(`  ... (${REF_CAP} of ${total} references)`);
  }
  return lines.join("\n");
}

/** Format a diagnostics list. Empty → "no diagnostics". */
export function formatDiagnostics(diags: LSPDiagnostic[]): string {
  if (diags.length === 0) return "no diagnostics";
  return diags
    .map((d) => {
      const sev = severityLabel(d.severity);
      // Diagnostics don't carry a uri (they're published per-file); show the
      // 1-based line and the message. Caller knows which file was queried.
      const line = d.range.start.line + 1;
      const col = d.range.start.character + 1;
      return `⚠ ${sev} ${line}:${col} — ${d.message}`;
    })
    .join("\n");
}
