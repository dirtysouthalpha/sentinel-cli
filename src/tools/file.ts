import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, statSync } from "fs";
import { join, resolve, dirname, basename, sep } from "path";
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
  const root = resolve(projectRoot);
  const resolved = resolve(root, filePath);
  // Append the separator so a sibling dir sharing a name prefix (e.g.
  // `<root>-secrets`) is not treated as inside `<root>`. The root itself is allowed.
  if (resolved !== root && !resolved.startsWith(root + sep)) {
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

export function createFileTool(projectRoot: string): ToolDef {
  return {
    name: "file",
    description: "Read, write, and manage files",
    parameters: {
      action: { type: "string", description: "read|write|exists|delete|list|mkdir", required: true },
      path: { type: "string", description: "File path relative to project root", required: true },
      content: { type: "string", description: "Content to write (for write action)" },
      encoding: { type: "string", description: "File encoding", default: "utf-8" },
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
            const content = readFileSync(path, encoding);
            return { success: true, output: content };
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
            const searchLines = (args.searchLines as string[]) || [];
            const replaceText = args.replaceText as string;
            const anchorHash = args.anchorHash as string | undefined;
            const lineStart = (args.lineStart as number | undefined);
            const lineEnd = (args.lineEnd as number | undefined);

            let actualOldText: string;
            let searchResult: { found: boolean; matchLine?: number; matchStart?: number };

            if (lineStart !== undefined && lineEnd !== undefined) {
              const lines = content.split("\n");
              const selectedLines = lines.slice(lineStart - 1, lineEnd);
              actualOldText = selectedLines.join("\n");
              searchResult = { found: true, matchLine: lineStart };
            } else if (searchLines.length > 0) {
              actualOldText = searchLines.join("\n");
              searchResult = { found: true };
            } else if (anchorHash) {
              const lines = content.split("\n");
              const found = findHashedSection(lines, anchorHash);
              if (!found) {
                return { success: false, output: "", error: `Hash anchor ${anchorHash} not found in file` };
              }
              actualOldText = found.text;
              searchResult = { found: true, matchLine: found.startLine };
            } else {
              return { success: false, output: "", error: "Must provide one of: lineStart+lineEnd, searchLines, or anchorHash" };
            }

            if (!content.includes(actualOldText)) {
              const lines = content.split("\n");
              const firstLine = actualOldText.split("\n")[0];
              const trimmedMatch = firstLine?.trim();
              const candidates: number[] = [];

              for (let i = 0; i < lines.length; i++) {
                if (lines[i].trim() === trimmedMatch) {
                  candidates.push(i + 1);
                }
              }

              if (candidates.length > 0 && !args.strictWhitespace) {
                for (const candidate of candidates) {
                  const candidateText = lines.slice(candidate - 1, candidate - 1 + actualOldText.split("\n").length).join("\n");
                  if (lines[candidate - 1]?.trim() === trimmedMatch) {
                    const reconstructed = lines.slice(candidate - 1, candidate - 1 + actualOldText.split("\n").length)
                      .map((l, idx) => idx === 0 || idx === actualOldText.split("\n").length - 1 ? l : l.trim())
                      .join("\n");
                    if (content.includes(reconstructed)) {
                      return {
                        success: false,
                        output: "",
                        error: `Exact match not found. Line ${candidate} has similar content but whitespace differs.\nUse strictWhitespace: false or provide exact text with proper indentation.`,
                      };
                    }
                  }
                }
              }

              return { success: false, output: "", error: `Text not found in file. Check content and whitespace.` };
            }

            const newContent = content.replace(actualOldText, replaceText);
            writeFileSync(path, newContent, encoding);

            return {
              success: true,
              output: `Edited ${path} (${actualOldText.length} -> ${replaceText.length} bytes)`,
              data: {
                anchorHash,
                editedLines: searchResult.matchLine,
                bytesChanged: replaceText.length - actualOldText.length,
              },
            };
          }
          case "preview": {
            const content = readFileSync(path, encoding);
            const searchLines = (args.searchLines as string[]) || [];
            const replaceText = args.replaceText as string;
            const anchorHash = args.anchorHash as string | undefined;
            const lineStart = (args.lineStart as number | undefined);
            const lineEnd = (args.lineEnd as number | undefined);

            let actualOldText: string;

            if (lineStart !== undefined && lineEnd !== undefined) {
              const lines = content.split("\n");
              const selectedLines = lines.slice(lineStart - 1, lineEnd);
              actualOldText = selectedLines.join("\n");
            } else if (searchLines.length > 0) {
              actualOldText = searchLines.join("\n");
            } else if (anchorHash) {
              const lines = content.split("\n");
              const found = findHashedSection(lines, anchorHash);
              if (!found) {
                return { success: false, output: "", error: `Hash anchor ${anchorHash} not found in file` };
              }
              actualOldText = found.text;
            } else {
              return { success: false, output: "", error: "Must provide one of: lineStart+lineEnd, searchLines, or anchorHash" };
            }

            if (!content.includes(actualOldText)) {
              return { success: false, output: "", error: `Text not found in file. Check content and whitespace.` };
            }

            const newContent = content.replace(actualOldText, replaceText);
            const diffOutput = diff(actualOldText, replaceText);

            return {
              success: true,
              output: `Preview of changes to ${path}:\n${diffOutput}`,
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
