import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ToolDef as AIToolDef } from "../ai/types.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger({ prefix: "mcp" });

/** Structural view of an MCP server entry (mirrors core/types McpServerConfig). */
export interface McpServerConfigLike {
  type?: "local" | "remote";
  command?: string[]; // ["npx","-y","@scope/server", ...]
  url?: string; // remote (Streamable HTTP) endpoint
  enabled?: boolean;
  env?: Record<string, string>;
}

interface DiscoveredTool {
  server: string;
  toolName: string;
  def: AIToolDef;
}

const PREFIX = "mcp__";

/** Namespaced tool name so MCP tools never collide with built-ins. */
export function mcpToolName(server: string, tool: string): string {
  return `${PREFIX}${server}__${tool}`;
}

/**
 * Connects to configured MCP servers (stdio or Streamable HTTP), discovers their
 * tools, and exposes them to the agent loop as namespaced function tools. Tool
 * calls named `mcp__<server>__<tool>` are dispatched back to the right server.
 */
export class MCPManager {
  private readonly clients = new Map<string, Client>();
  private tools: DiscoveredTool[] = [];

  async connect(servers: Record<string, McpServerConfigLike>): Promise<void> {
    for (const [name, cfg] of Object.entries(servers || {})) {
      if (cfg.enabled === false) continue;
      const transport = this.makeTransport(cfg);
      if (!transport) {
        log.warn(`MCP server "${name}" skipped: no command or url`);
        continue;
      }
      try {
        const client = new Client({ name: "sentinel-cli", version: "0.2.0" });
        await client.connect(transport);
        const { tools } = await client.listTools();
        for (const t of tools) {
          this.tools.push({
            server: name,
            toolName: t.name,
            def: {
              type: "function",
              function: {
                name: mcpToolName(name, t.name),
                description: t.description || `${name}: ${t.name}`,
                parameters: (t.inputSchema as AIToolDef["function"]["parameters"]) || {
                  type: "object",
                  properties: {},
                },
              },
            },
          });
        }
        this.clients.set(name, client);
        log.info(`MCP "${name}" connected (${tools.length} tools)`);
      } catch (e) {
        // Close the transport so a failed connection doesn't leak a child process.
        try {
          await transport.close();
        } catch {
          // ignore
        }
        log.warn(`MCP "${name}" failed to connect: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  private makeTransport(cfg: McpServerConfigLike): StdioClientTransport | StreamableHTTPClientTransport | null {
    if (cfg.command && cfg.command.length > 0) {
      return new StdioClientTransport({
        command: cfg.command[0],
        args: cfg.command.slice(1),
        // Discard the child server's stderr — otherwise its diagnostics (e.g.
        // "Starting default (STDIO) server…") leak onto whatever owns the
        // terminal/stdout (the TUI/GUI), corrupting the display.
        stderr: "ignore",
        ...(cfg.env ? { env: cfg.env } : {}),
      });
    }
    if (cfg.url) {
      return new StreamableHTTPClientTransport(new URL(cfg.url));
    }
    return null;
  }

  getToolDefs(): AIToolDef[] {
    return this.tools.map((t) => t.def);
  }

  has(name: string): boolean {
    return name.startsWith(PREFIX) && this.tools.some((t) => t.def.function.name === name);
  }

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const found = this.tools.find((t) => t.def.function.name === name);
    if (!found) return `ERROR: Unknown MCP tool: ${name}`;
    const client = this.clients.get(found.server);
    if (!client) return `ERROR: MCP server "${found.server}" not connected`;
    try {
      const result = await client.callTool({ name: found.toolName, arguments: args });
      return formatContent(result);
    } catch (e) {
      return `ERROR: MCP ${name} failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  list(): { server: string; tool: string; description: string }[] {
    return this.tools.map((t) => ({
      server: t.server,
      tool: t.toolName,
      description: t.def.function.description,
    }));
  }

  serverCount(): number {
    return this.clients.size;
  }

  async disconnect(): Promise<void> {
    for (const c of this.clients.values()) {
      try {
        await c.close();
      } catch {
        // best-effort shutdown
      }
    }
    this.clients.clear();
    this.tools = [];
  }
}

function formatContent(result: unknown): string {
  const content = (result as { content?: unknown })?.content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === "object" && (c as { type?: string }).type === "text"
        ? (c as { text: string }).text
        : JSON.stringify(c)))
      .join("\n");
  }
  return JSON.stringify(result);
}
