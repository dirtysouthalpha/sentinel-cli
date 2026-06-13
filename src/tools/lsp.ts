import { ToolDef, ToolResult } from "./types.js";
import { LspManager } from "../core/lsp-manager.js";

let manager: LspManager | null = null;

function getManager(): LspManager {
  if (!manager) {
    manager = new LspManager();
  }
  return manager;
}

const DEFAULT_SERVERS: Record<string, { command: string[] }> = {
  typescript: { command: ["typescript-language-server", "--stdio"] },
  python: { command: ["pylsp"] },
};

export const lspToolDef: ToolDef = {
  name: "lsp",
  description: "Code intelligence via Language Server Protocol",
  parameters: {
    action: {
      type: "string",
      description: "LSP action to perform",
      required: true,
    },
    file: {
      type: "string",
      description: "File path for the request",
    },
    line: {
      type: "number",
      description: "Line number (0-based)",
    },
    character: {
      type: "number",
      description: "Character offset (0-based)",
    },
    newName: {
      type: "string",
      description: "New name for rename action",
    },
    query: {
      type: "string",
      description: "Query string for symbol search",
    },
  },
  execute: async (args): Promise<ToolResult> => {
    const result = await executeLsp(args, process.cwd());
    return { success: true, output: result };
  },
};

export async function executeLsp(
  args: Record<string, unknown>,
  _projectRoot: string
): Promise<string> {
  const mgr = getManager();
  const action = args.action as string;
  const file = args.file as string | undefined;
  const line = args.line as number | undefined;
  const character = args.character as number | undefined;
  const newName = args.newName as string | undefined;
  const query = args.query as string | undefined;

  // Auto-connect on first action
  if (!mgr["initialized"]) {
    await mgr.connect(DEFAULT_SERVERS);
  }

  try {
    let result: unknown;

    switch (action) {
      case "diagnostics":
        if (!file) throw new Error("file is required for diagnostics");
        result = await mgr.diagnostics(file);
        break;
      case "definition":
        if (!file || line == null || character == null)
          throw new Error("file, line, and character are required for definition");
        result = await mgr.definition(file, line, character);
        break;
      case "references":
        if (!file || line == null || character == null)
          throw new Error("file, line, and character are required for references");
        result = await mgr.references(file, line, character);
        break;
      case "hover":
        if (!file || line == null || character == null)
          throw new Error("file, line, and character are required for hover");
        result = await mgr.hover(file, line, character);
        break;
      case "symbols":
        if (!query) throw new Error("query is required for symbols");
        result = await mgr.symbols(query);
        break;
      case "rename":
        if (!file || line == null || character == null || !newName)
          throw new Error("file, line, character, and newName are required for rename");
        result = await mgr.rename(file, line, character, newName);
        break;
      case "code_actions":
        if (!file || line == null || character == null)
          throw new Error("file, line, and character are required for code_actions");
        result = await mgr.codeActions(file, line, character);
        break;
      default:
        throw new Error(
          `Unknown action "${action}". Use: diagnostics, definition, references, hover, symbols, rename, code_actions`
        );
    }

    return formatResult(action, result);
  } finally {
    await mgr.shutdown();
  }
}

function formatResult(action: string, result: unknown): string {
  if (result == null) return `No ${action} results.`;

  const data = result as Record<string, unknown>;

  if (Array.isArray(data.items)) {
    return data.items
      .map((item: Record<string, unknown>, i: number) => {
        const loc = item.location ?? item.targetRange;
        const name = item.name ?? item.message ?? "";
        return `${i + 1}. ${name}${loc ? ` — ${formatLocation(loc as Record<string, unknown>)}` : ""}`;
      })
      .join("\n");
  }

  if (data.contents) {
    const contents = data.contents as Record<string, unknown> | string;
    return typeof contents === "string" ? contents : String(contents.value ?? JSON.stringify(contents));
  }

  if (data.documentChanges || data.changes) {
    return `Rename applied: ${JSON.stringify(data.changes ?? data.documentChanges, null, 2)}`;
  }

  return JSON.stringify(result, null, 2);
}

function formatLocation(loc: Record<string, unknown>): string {
  const uri = loc.uri ?? "";
  const range = loc.range as Record<string, unknown> | undefined;
  if (!range) return String(uri);
  const start = (range as Record<string, unknown>).start as Record<string, unknown>;
  return `${String(uri).replace("file:///", "")}:${start?.line ?? 0}:${start?.character ?? 0}`;
}
