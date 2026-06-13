import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, statSync } from "fs";
import { join, resolve, dirname, basename } from "path";
import { createHash } from "crypto";
import { ToolDef, ToolResult } from "./types.js";

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
function findBlocks(
  fileLines: string[],
  searchBlock: string[],
  eq: (a: string, b: string) => boolean
): number[] {
  const starts: number[] = [];
  for (let i = 0; i + searchBlock.length <= fileLines.length; i++) {
    let hit = true;
    for (let j = 0; j < searchBlock.length; j++) {
      if (!eq(fileLines[i + j], searchBlock[j])) { hit = false; break; }
    }
    if (hit) starts.push(i);
  }
  return starts;
}

function applySearch(
  content: string,
  oldText: string,
  replaceText: string,
  strictWhitespace: boolean
): { ok: true; newContent: string; oldText: string; line: number } | { ok: false; error: string } {
  // Line-aligned block matching (not raw substring) so a search for `foo();`
  // matches a whole line, never a fragment inside `  foo();` or `if(foo());`.
  const fileLines = content.split("\n");
  const searchBlock = oldText.split("\n");

  const splice = (start: number) => {
    const matchedOld = fileLines.slice(start, start + searchBlock.length).join("\n");
    const newContent = [
      ...fileLines.slice(0, start),
      ...replaceText.split("\n"),
      ...fileLines.slice(start + searchBlock.length),
    ].join("\n");
    return { ok: true as const, newContent, oldText: matchedOld, line: start + 1 };
  };

  // 1) Exact line match — require uniqueness, or the wrong copy could be edited.
  const exact = findBlocks(fileLines, searchBlock, (a, b) => a === b);
  if (exact.length === 1) return splice(exact[0]);
  if (exact.length > 1) {
    return {
      ok: false,
      error: `Ambiguous edit: the search text appears ${exact.length} times. Include more surrounding lines so it uniquely identifies one location.`,
    };
  }

  if (strictWhitespace) {
    return { ok: false, error: "Exact text not found (strictWhitespace is on). Check the content and whitespace." };
  }

  // 2) Whitespace-tolerant fallback: compare lines ignoring leading/trailing
  //    whitespace (handles indentation drift, trailing spaces, CRLF). Still
  //    requires a unique match before touching the file.
  const norm = (s: string) => s.replace(/^\s+/, "").replace(/\s+$/, "");
  const tolerant = findBlocks(fileLines, searchBlock, (a, b) => norm(a) === norm(b));
  if (tolerant.length === 0) {
    return { ok: false, error: "Text not found in file. Check the content and surrounding lines." };
  }
  if (tolerant.length > 1) {
    return {
      ok: false,
      error: `Ambiguous edit: ${tolerant.length} whitespace-insensitive matches. Include more surrounding lines to disambiguate.`,
    };
  }
  return splice(tolerant[0]);
}

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

  return applySearch(content, target.oldText, replaceText, strictWhitespace);
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
            const offset = args.offset as number | undefined; // 1-based start line
            const limit = args.limit as number | undefined;   // max lines to return
            const lines = raw.split("\n");
            const total = lines.length;
            const DEFAULT_MAX_LINES = 2000;

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

            const slice = lines.slice(start, end).join("\n");
            if (!windowed) {
              return { success: true, output: slice };
            }
            return {
              success: true,
              output:
                slice +
                `\n\n[showing lines ${start + 1}-${end} of ${total}. ` +
                `Use action:read with offset/limit to read other parts.]`,
              data: { totalLines: total, start: start + 1, end },
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
