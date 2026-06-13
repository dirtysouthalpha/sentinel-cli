import { toolManager } from "./index.js";
import { ChatMessage, ToolCall, ToolDef as AIToolDef } from "../ai/types.js";
import { ToolDef } from "./types.js";
import { compressToolOutput } from "../ai/compression.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger({ prefix: "tool-exec" });

const TOOL_DEFINITIONS: Record<string, AIToolDef> = {
  file: {
    type: "function",
    function: {
      name: "file",
      description: "Read, write, and manage files. Actions: read, write, exists, delete, list, mkdir, edit, preview",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", description: "read|write|exists|delete|list|mkdir|edit|preview", enum: ["read", "write", "exists", "delete", "list", "mkdir", "edit", "preview"] },
          path: { type: "string", description: "File path relative to project root" },
          offset: { type: "number", description: "read: 1-based start line of the window (large files are capped; use this to page)" },
          limit: { type: "number", description: "read: max number of lines to return" },
          content: { type: "string", description: "Content to write (for write action)" },
          encoding: { type: "string", description: "File encoding" },
          replaceText: { type: "string", description: "New text to replace with (for edit/preview actions)" },
          anchorHash: { type: "string", description: "Hash of the section to edit (for edit/preview actions)" },
          lineStart: { type: "number", description: "Starting line number (1-indexed, for edit/preview actions)" },
          lineEnd: { type: "number", description: "Ending line number (for edit/preview actions)" },
          searchLines: { type: "array", description: "List of lines to find (for edit/preview actions)" },
          strictWhitespace: { type: "boolean", description: "Require exact whitespace match" },
        },
        required: ["action", "path"],
      },
    },
  },
  bash: {
    type: "function",
    function: {
      name: "bash",
      description: "Execute shell commands (PowerShell on Windows, bash on Unix)",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute" },
          timeout: { type: "number", description: "Timeout in ms (default 60000)" },
          cwd: { type: "string", description: "Working directory" },
        },
        required: ["command"],
      },
    },
  },
  search: {
    type: "function",
    function: {
      name: "search",
      description: "Search code using grep or glob patterns",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Search pattern (regex for grep, glob for glob)" },
          type: { type: "string", description: "grep|glob", enum: ["grep", "glob"] },
          include: { type: "string", description: "File pattern filter (e.g. *.ts)" },
          path: { type: "string", description: "Subdirectory to search in" },
        },
        required: ["pattern"],
      },
    },
  },
  git: {
    type: "function",
    function: {
      name: "git",
      description: "Git operations (status, log, diff, branch, etc.)",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", description: "Git command (status, log, diff, branch, add, commit, etc.)" },
          args: { type: "string", description: "Additional arguments" },
        },
        required: ["action"],
      },
    },
  },
  web: {
    type: "function",
    function: {
      name: "web",
      description: "Fetch content from URLs (docs, APIs, web pages)",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to fetch" },
          format: { type: "string", description: "Response format: text|json|html" },
        },
        required: ["url"],
      },
    },
  },
  patch: {
    type: "function",
    function: {
      name: "patch",
      description: "Apply smart patches to files (find and replace blocks)",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to project root" },
          oldText: { type: "string", description: "Text to find (exact match)" },
          newText: { type: "string", description: "Replacement text" },
          all: { type: "boolean", description: "Replace all occurrences" },
        },
        required: ["path", "oldText", "newText"],
      },
    },
  },
  browser: {
    type: "function",
    function: {
      name: "browser",
      description: "Headless browser automation with Puppeteer. Actions: new, navigate, click, type, screenshot, close, scrape, waitFor",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", description: "new|navigate|click|type|screenshot|close|scrape|waitFor", enum: ["new", "navigate", "click", "type", "screenshot", "close", "scrape", "waitFor"] },
          url: { type: "string", description: "URL to navigate to" },
          selector: { type: "string", description: "CSS selector for click/type/waitFor actions" },
          text: { type: "string", description: "Text to type" },
          filePath: { type: "string", description: "File path for screenshot" },
          wait: { type: "number", description: "Wait time in ms" },
          stealth: { type: "boolean", description: "Use stealth mode (default: true)" },
        },
        required: ["action"],
      },
    },
  },
  lsp: {
    type: "function",
    function: {
      name: "lsp",
      description: "Code intelligence via Language Server Protocol. Actions: diagnostics, definition, references, hover, symbols, rename, code_actions",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", description: "diagnostics|definition|references|hover|symbols|rename|code_actions", enum: ["diagnostics", "definition", "references", "hover", "symbols", "rename", "code_actions"] },
          file: { type: "string", description: "File path for the request" },
          line: { type: "number", description: "Line number (0-based)" },
          character: { type: "number", description: "Character offset (0-based)" },
          newName: { type: "string", description: "New name (for rename action)" },
          query: { type: "string", description: "Query string (for symbols action)" },
        },
        required: ["action"],
      },
    },
  },
};

export function getToolDefinitions(): AIToolDef[] {
  return Object.values(TOOL_DEFINITIONS);
}

export async function executeToolCall(toolCall: ToolCall): Promise<ChatMessage> {
  const { id, name, arguments: argsStr } = toolCall;

  log.info(`Executing tool: ${name}`);

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsStr);
  } catch {
    return {
      role: "tool",
      content: JSON.stringify({ error: `Invalid JSON arguments: ${argsStr}` }),
      toolCallId: id,
      name,
    };
  }

  try {
    if (!toolManager.has(name)) {
      return {
        role: "tool",
        content: JSON.stringify({ error: `Unknown tool: ${name}. Available: ${toolManager.getNames().join(", ")}` }),
        toolCallId: id,
        name,
      };
    }

    const result = await toolManager.execute(name, args);
    const rawOutput = result.success
      ? result.output
      : `ERROR: ${result.error || "Unknown error"}\n${result.output}`;

    let output = rawOutput;
    try {
      output = await compressToolOutput(rawOutput, name);
    } catch {
      // compression failed, use raw output
    }

    return {
      role: "tool",
      content: output.length > 50000 ? output.slice(0, 50000) + "\n... (truncated)" : output,
      toolCallId: id,
      name,
    };
  } catch (err) {
    return {
      role: "tool",
      content: JSON.stringify({ error: String(err) }),
      toolCallId: id,
      name,
    };
  }
}

export function parseToolCallsFromContent(content: string): ToolCall[] | null {
  const toolPattern = /```tool\s*\n([\s\S]*?)```/g;
  const calls: ToolCall[] = [];
  let match;

  while ((match = toolPattern.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      calls.push({
        id: parsed.id || `call_${calls.length}`,
        name: parsed.name,
        arguments: typeof parsed.arguments === "string" ? parsed.arguments : JSON.stringify(parsed.arguments),
      });
    } catch {
      // skip unparseable
    }
  }

  return calls.length > 0 ? calls : null;
}
