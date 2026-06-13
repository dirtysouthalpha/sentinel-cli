import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, statSync } from "fs";
import { join, resolve, dirname, basename } from "path";
import { createHash } from "crypto";
import { ToolDef, ToolResult } from "./types.js";
import { replaceLineBlock } from "./edit-match.js";

function diff(oldText: string, newText: string): string {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const maxLines = Math.max(oldLines.length, newLines.length);
  let output = "";
  for (let i = 0; i < maxLines; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine === newLine) {
      output += `  ${oldLine}\n`;
    } else {
      if (oldLine !== undefined) output += `- ${oldLine}\n`;
      if (newLine !== undefined) output += `+ ${newLine}\n`;
    }
  }
  return output;
}

function ensureWithinProject(filePath: string, projectRoot: string): string {
  const resolved = resolve(projectRoot, filePath);
  if (!resolved.startsWith(resolve(projectRoot))) {
    throw new Error(`Path traversal detected: ${filePath}`);
  }
  return resolved;
}

function computeHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

interface HashedSection {
  startLine: number;
  endLine: number;
  text: string;
  hash: string;
}

function findHashedSection(lines: string[], anchorHash: string): HashedSection | null {
  for (let i = 0; i < lines.length; i++) {
    const windowSize = 5;
    const end = Math.min(i + windowSize, lines.length);
    const windowText = lines.slice(i, end).join("\n");
    const hash = computeHash(windowText);
    if (hash === anchorHash) {
      return { startLine: i + 1, endLine: end, text: windowText, hash };
    }
  }
  return null;
}

/**
 * How an edit locates the text to change:
 *  - `range`  — an explicit line span (from lineStart/lineEnd or an anchorHash).
 *               We splice exactly those lines; no content search, so identical
 *               text elsewhere in the file can never be hit by mistake.
 *  - `search` — find `oldText` by content (from searchLines). Subject to the
 *               uniqueness guard and whitespace-tolerant fallback below.
 */
type EditTarget =
  | { kind: "range"; startIdx: number; endIdx: number; line: number; oldText: string }
  | { kind: "search"; oldText: string };

function resolveTarget(
  content: string,
  args: Record<string, unknown>
): { ok: true; target: EditTarget } | { ok: false; error: string } {
  const searchLines = (args.searchLines as string[]) || [];
  const anchorHash = args.anchorHash as string | undefined;
  const lineStart = args.lineStart as number | undefined;
  const lineEnd = args.lineEnd as number | undefined;
  const lines = content.split("\n");

  if (lineStart !== undefined && lineEnd !== undefined) {
    if (lineStart < 1 || lineEnd > lines.length || lineStart > lineEnd) {
      return { ok: false, error: `Invalid line range ${lineStart}-${lineEnd} for a ${lines.length}-line file` };
    }
    const oldText = lines.slice(lineStart - 1, lineEnd).join("\n");
    return { ok: true, target: { kind: "range", startIdx: lineStart - 1, endIdx: lineEnd, line: lineStart, oldText } };
  }
  if (searchLines.length > 0) {
    return { ok: true, target: { kind: "search", oldText: searchLines.join("\n") } };
  }
  if (anchorHash) {
    const found = findHashedSection(lines, anchorHash);
    if (!found) return { ok: false, error: `Hash anchor ${anchorHash} not found in file` };
    return { ok: true, target: { kind: "range", startIdx: found.startLine - 1, endIdx: found.endLine, line: found.startLine, oldText: found.text } };
  }
  return { ok: false, error: "Must provide one of: lineStart+lineEnd, searchLines, or anchorHash" };
}

/**
 * Resolve a `search` target to concrete new file content, applying the
 * uniqueness guard and a whitespace-tolerant fallback. Returns the rewritten
 * content plus the matched old text (for diffs), or a descriptive error the
 * model can act on.
 */
/** Compute the edited content for any target, or a descriptive error. */
function computeEdit(
  content: string,
  args: Record<string, unknown>,
  replaceText: string,
  strictWhitespace: boolean
): { ok: true; newContent: string; oldText: string; line: number } | { ok: false; error: string } {
  const resolved = resolveTarget(content, args);
  if (!resolved.ok) return resolved;
  const target = resolved.target;

  if (target.kind === "range") {
    // Splice the exact line span — never a content search.
    const lines = content.split("\n");
    const newContent = [
      ...lines.slice(0, target.startIdx),
      ...replaceText.split("\n"),
      ...lines.slice(target.endIdx),
    ].join("\n");
    return { ok: true, newContent, oldText: target.oldText, line: target.line };
  }

  return replaceLineBlock(content, target.oldText, replaceText, strictWhitespace);
}

export function createFileTool(projectRoot: string): ToolDef {
  return {
    name: "file",
    description: "Read, write, and manage files",
    parameters: {
      action: { type: "string", description: "read|write|exists|delete|list|mkdir|edit|preview", required: true },
      path: { type: "string", description: "File path relative to project root", required: true },
      content: { type: "string", description: "Content to write (for write action)" },
      encoding: { type: "string", description: "File encoding", default: "utf-8" },
      offset: { type: "number", description: "read: 1-based start line of the window" },
      limit: { type: "number", description: "read: max number of lines to return" },
    },
    execute: async (args): Promise<ToolResult> => {
      try {
        const action = args.action as string;
        const path = ensureWithinProject(args.path as string, projectRoot);
        const encoding = (args.encoding as BufferEncoding) || "utf-8";

        switch (action) {
          case "read": {
            if (!existsSync(path)) {
              return { success: false, output: "", error: `File not found: ${path}` };
            }
            const raw = readFileSync(path, encoding);

            // Binary guard: NUL bytes almost never occur in text. Refuse rather
            // than dumping mojibake into the model's context.
            if (/\u0000/.test(raw.slice(0, 8000))) {
              const bytes = statSync(path).size;
              return {
                success: false,
                output: "",
                error: `Binary file (${bytes} bytes) — not shown as text. Use bash/git if you need to inspect it.`,
              };
            }

            const offset = args.offset as number | undefined; // 1-based start line
            const limit = args.limit as number | undefined;   // max lines to return
            const lines = raw.split("\n");
            const total = lines.length;
            const DEFAULT_MAX_LINES = 2000;
            const MAX_CHARS = 100_000; // ~28k tokens; also catches minified one-liners

            let start = 0;
            let end = total;
            let windowed = false;

            if (offset !== undefined || limit !== undefined) {
              start = Math.min(Math.max(0, (offset ?? 1) - 1), total);
              end = Math.min(total, start + (limit ?? DEFAULT_MAX_LINES));
              windowed = true;
            } else if (total > DEFAULT_MAX_LINES) {
              // Guard against context blowout from reading a huge file whole.
              end = DEFAULT_MAX_LINES;
              windowed = true;
            }

            let slice = lines.slice(start, end).join("\n");

            // Character cap: line-windowing can't bound a minified single line.
            let charCapped = false;
            if (slice.length > MAX_CHARS) {
              slice = slice.slice(0, MAX_CHARS);
              charCapped = true;
            }

            if (!windowed && !charCapped) {
              return { success: true, output: slice };
            }
            const notes: string[] = [];
            if (windowed) notes.push(`showing lines ${start + 1}-${end} of ${total}`);
            if (charCapped) notes.push(`truncated to ${MAX_CHARS} chars (long/minified content)`);
            return {
              success: true,
              output: slice + `\n\n[${notes.join("; ")}. Use action:read with offset/limit to read other parts.]`,
              data: { totalLines: total, start: start + 1, end, charCapped },
            };
          }
          case "write": {
            const content = args.content as string;
            const dir = dirname(path);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            writeFileSync(path, content, encoding);
            return { success: true, output: `Written ${content.length} bytes to ${path}` };
          }
          case "exists": {
            return { success: true, output: existsSync(path) ? "true" : "false", data: existsSync(path) };
          }
          case "delete": {
            if (!existsSync(path)) {
              return { success: false, output: "", error: `File not found: ${path}` };
            }
            unlinkSync(path);
            return { success: true, output: `Deleted: ${path}` };
          }
          case "list": {
            if (!existsSync(path)) {
              return { success: false, output: "", error: `Directory not found: ${path}` };
            }
            const entries = readdirSync(path).map((name) => {
              const fullPath = join(path, name);
              const isDir = statSync(fullPath).isDirectory();
              return `${isDir ? "DIR " : "FILE"} ${name}`;
            });
            return { success: true, output: entries.join("\n") };
          }
          case "mkdir": {
            mkdirSync(path, { recursive: true });
            return { success: true, output: `Created directory: ${path}` };
          }
          case "edit": {
            const content = readFileSync(path, encoding);
            const replaceText = args.replaceText as string;
            const strictWhitespace = !!args.strictWhitespace;

            const result = computeEdit(content, args, replaceText, strictWhitespace);
            if (!result.ok) {
              return { success: false, output: "", error: result.error };
            }

            writeFileSync(path, result.newContent, encoding);
            return {
              success: true,
              output: `Edited ${path} at line ${result.line} (${result.oldText.length} -> ${replaceText.length} bytes)`,
              data: {
                anchorHash: args.anchorHash as string | undefined,
                editedLines: result.line,
                bytesChanged: replaceText.length - result.oldText.length,
              },
            };
          }
          case "preview": {
            const content = readFileSync(path, encoding);
            const replaceText = args.replaceText as string;
            const strictWhitespace = !!args.strictWhitespace;

            const result = computeEdit(content, args, replaceText, strictWhitespace);
            if (!result.ok) {
              return { success: false, output: "", error: result.error };
            }

            const diffOutput = diff(result.oldText, replaceText);
            return {
              success: true,
              output: `Preview of changes to ${path} (line ${result.line}):\n${diffOutput}`,
              data: { isPreview: true },
            };
          }
          default:
            return { success: false, output: "", error: `Unknown action: ${action}` };
        }
      } catch (err) {
        return { success: false, output: "", error: String(err) };
      }
    },
  };
}
