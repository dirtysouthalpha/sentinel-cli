import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { toolManager } from "../tools/index.js";
import { getToolDefinitions } from "../tools/tool-executor.js";
import { setLogLevel } from "../utils/logger.js";

/**
 * Run Sentinel itself as an MCP server over stdio, exposing its built-in tools
 * (file, bash, search, git, web, patch, browser) to any MCP client — Claude
 * Desktop, another agent, or another Sentinel. The inverse of the MCP client.
 *
 * A client configures it like any stdio server:
 *   { "command": ["sentinel", "mcp-serve", "--project", "/path/to/repo"] }
 */
export async function runMcpServer(projectRoot: string): Promise<void> {
  // CRITICAL: stdout is the JSON-RPC channel. The logger's info/debug use
  // console.log (stdout) and would corrupt the protocol — drop to "warn" so only
  // warn/error remain (those go to stderr, which the host captures safely).
  setLogLevel("warn");
  toolManager.initialize(projectRoot);

  const server = new Server(
    { name: "sentinel", version: "0.2.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getToolDefinitions().map((d) => ({
      name: d.function.name,
      description: d.function.description,
      inputSchema: d.function.parameters as Record<string, unknown>,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments || {}) as Record<string, unknown>;

    if (!toolManager.has(name)) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}. Available: ${toolManager.getNames().join(", ")}` }],
        isError: true,
      };
    }

    try {
      const result = await toolManager.execute(name, args);
      const text = result.success ? result.output : `ERROR: ${result.error || "failed"}\n${result.output}`;
      return {
        content: [{ type: "text", text: (text || "").slice(0, 100000) }],
        isError: !result.success,
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `ERROR: ${e instanceof Error ? e.message : String(e)}` }],
        isError: true,
      };
    }
  });

  await server.connect(new StdioServerTransport());
  // The transport keeps the process alive until stdin closes.
}
