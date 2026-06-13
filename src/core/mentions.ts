import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { searchGrep } from "../tools/search.js";
import { runDiagnostics, formatDiagnostics } from "./diagnostics.js";

/**
 * Options for {@link expandMentions}. `fetchText` is injectable so tests (and
 * alternate transports) can avoid real network I/O.
 */
export interface ExpandMentionsOpts {
  /** Fetch the text body of a URL. Defaults to a plain `fetch` with a timeout. */
  fetchText?: (url: string) => Promise<string>;
  /** Per-mention byte cap before truncation. Defaults to ~8KB. */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 8 * 1024;
const HEADER = "\n\n--- Referenced context ---\n";

async function defaultFetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "SentinelCLI",
      Accept: "text/html,application/xhtml+xml,text/plain,application/json",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return await res.text();
}

/** Cap a string to `maxBytes` worth of characters, flagging truncation. */
function cap(text: string, maxBytes: number): { body: string; truncated: boolean } {
  if (text.length <= maxBytes) return { body: text, truncated: false };
  return { body: text.slice(0, maxBytes), truncated: true };
}

function isUrl(mention: string): boolean {
  return /^https?:\/\//i.test(mention);
}

/**
 * Extract unique @-mentions from `text`. Recognises `@<url>` (http/https) and
 * `@<path>` (relative or absolute file path). Trailing sentence punctuation is
 * stripped so "see @notes.md." mentions `notes.md`, not `notes.md.`.
 */
function extractMentions(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // Mentions are preceded by start-of-string or whitespace so we don't match
  // emails (foo@bar) or other mid-token "@".
  const re = /(?:^|\s)@(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    let token = match[1].replace(/[).,;:!?'"]+$/, "");
    if (!token) continue;
    if (!seen.has(token)) {
      seen.add(token);
      out.push(token);
    }
  }
  return out;
}

/**
 * Scan a user message for @-mentions and append the referenced content.
 *
 * Each mention is resolved to either a local file (read from disk, relative
 * paths resolved against `projectRoot`) or an http(s) URL (fetched). Content is
 * capped (~8KB each by default) with a truncation note; unreadable files and
 * failed fetches produce an inline error note instead of throwing. When no
 * mentions are present the original text is returned unchanged.
 *
 * Pure/async and dependency-injectable via `opts.fetchText` for testing.
 */
export async function expandMentions(
  text: string,
  projectRoot: string,
  opts: ExpandMentionsOpts = {}
): Promise<string> {
  if (!text) return text;
  const mentions = extractMentions(text);
  if (mentions.length === 0) return text;

  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const fetchText = opts.fetchText ?? defaultFetchText;

  const blocks: string[] = [];
  for (const mention of mentions) {
    if (isUrl(mention)) {
      try {
        const raw = await fetchText(mention);
        const { body, truncated } = cap(raw, maxBytes);
        blocks.push(
          `@${mention} (url):\n${body}${truncated ? "\n... (truncated)" : ""}`
        );
      } catch (err) {
        blocks.push(`@${mention} (url): [failed to fetch: ${String(err)}]`);
      }
    } else if (mention.startsWith("symbol:")) {
      // @symbol:name — search for the symbol in TS/JS files
      const symbolName = mention.slice("symbol:".length);
      if (!symbolName) {
        blocks.push(`@${mention}: [empty symbol name]`);
        continue;
      }
      try {
        // Reuse the hardened, cross-platform search (no shell injection, works
        // on Windows, skips noise dirs) instead of a raw interpolated grep.
        const result = await searchGrep(projectRoot, symbolName, undefined, 50);
        const lines = result.split("\n").slice(0, 500);
        const body =
          lines.length >= 500
            ? lines.join("\n") + "\n... (truncated at 500 lines)"
            : lines.join("\n");
        blocks.push(`@${mention} (symbol):\n${body}`);
      } catch {
        blocks.push(`@${mention} (symbol): [no matches found]`);
      }
    } else if (mention === "problems") {
      // @problems — type-check diagnostics via the shared, cross-platform runner
      // (handles the shell + --pretty false; no Unix-only `2>&1`).
      try {
        const r = await runDiagnostics(projectRoot);
        blocks.push(`@problems (diagnostics):\n${formatDiagnostics(r.diagnostics)}`);
      } catch (err) {
        blocks.push(`@problems (diagnostics): [failed to run: ${String(err)}]`);
      }
    } else {
      const path = isAbsolute(mention) ? mention : resolve(projectRoot, mention);
      try {
        const raw = await readFile(path, "utf8");
        const { body, truncated } = cap(raw, maxBytes);
        blocks.push(
          `@${mention} (file):\n${body}${truncated ? "\n... (truncated)" : ""}`
        );
      } catch {
        blocks.push(`@${mention} (file): [not found or unreadable]`);
      }
    }
  }

  return text + HEADER + blocks.join("\n\n");
}
