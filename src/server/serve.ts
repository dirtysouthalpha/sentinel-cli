import { randomBytes } from "crypto";
import type { AddressInfo } from "net";
import { WebSocketServer, WebSocket } from "ws";
import { getConfigManager } from "../core/config.js";
import { state } from "../core/state.js";
import { providerManager } from "../ai/provider.js";
import { RoutedProvider } from "../ai/routed-provider.js";
import { getToolDefinitions, executeToolCall } from "../tools/tool-executor.js";
import { AgentRunner } from "../core/agent-runner.js";
import { extractToolCalls } from "../core/tool-call-extractor.js";
import { buildSystemPrompt } from "../core/system-prompt.js";
import { PermissionEngine, PermissionMode, PermissionRequest } from "../core/permissions.js";
import { CheckpointManager } from "../core/checkpoints.js";
import { createGuardedExecutor } from "../core/guarded-executor.js";
import { createSubagentTool, createSubagentAwareExecutor } from "../core/subagent.js";
import { createTodoTool, createTodoAwareExecutor } from "../core/todos.js";
import { createHookAwareExecutor, defaultRunShell } from "../core/hooks.js";
import { MCPManager } from "../mcp/manager.js";
import { createMcpAwareExecutor } from "../mcp/mcp-executor.js";
import { expandMentions } from "../core/mentions.js";
import { recallRelevant, DEFAULT_RECALL_TOOL } from "../core/brain-recall.js";
import { sessionManager } from "../core/session-manager.js";
import { themeEngine } from "../tui/themes/engine.js";
import { commandRegistry } from "../commands/registry.js";
import { agentRegistry } from "../agents/registry.js";
import { resolveTemplate } from "../commands/loader.js";
import { ClientMessage, ServerMessage, StateSnapshot, ConfigView } from "./protocol.js";
import {
  setProviderConfig,
  removeProviderConfig,
  addCustomModel,
  removeCustomModel,
  getCustomModels,
  setMcpConfig,
  removeMcpConfig,
} from "./config-store.js";

const VERSION = "0.3.0";

const MODEL_CHOICES = [
  "zai/glm-4.6",
  "zai/glm-5.1",
  "anthropic/claude-sonnet",
  "anthropic/claude-haiku",
  "openai/gpt-4o",
  "ollama/llama3",
];

export interface ServeOptions {
  projectRoot: string;
  /** Print the {port,token} handshake to stdout (for a Tauri/sidecar host). Default true. */
  print?: boolean;
}

/**
 * Start the engine as a local WebSocket server. Providers/tools/registries must
 * already be initialized by the caller (cli.ts serve command). Prints a single
 * `{port, token, pid}` JSON line on stdout, then never writes to stdout again so
 * a GUI can drive the engine over the socket.
 */
export async function runServe(opts: ServeOptions): Promise<{ port: number; token: string }> {
  const projectRoot = opts.projectRoot;

  sessionManager.initialize(projectRoot);
  if (sessionManager.getSessionCount() === 0) sessionManager.createSession({ projectRoot });

  const mcp = new MCPManager();
  const config = getConfigManager(projectRoot).getAll();

  const token = randomBytes(24).toString("hex");
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });

  const ready = new Promise<{ port: number; token: string }>((resolve) => {
    wss.on("listening", () => {
      const addr = wss.address() as AddressInfo;
      if (opts.print !== false) {
        process.stdout.write(JSON.stringify({ port: addr.port, token, pid: process.pid }) + "\n");
      }
      // Connect MCP servers in the background so the handshake isn't blocked by a
      // slow `npx` server download; tools appear once discovery completes.
      void mcp.connect((config.mcp as Record<string, never>) || {}).catch(() => {});
      resolve({ port: addr.port, token });
    });
  });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.searchParams.get("token") !== token) {
      ws.close(1008, "bad token");
      return;
    }
    new Connection(ws, projectRoot, mcp).start();
  });

  const shutdown = async () => {
    try {
      await mcp.disconnect();
    } catch {
      /* ignore */
    }
    wss.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return ready;
}

/** One connected client (the GUI). Drives the engine and relays events. */
class Connection {
  private ac?: AbortController;
  private permResolver?: (allow: boolean) => void;
  private permissionMode: PermissionMode = "yolo";
  private busy = false;
  private cost = { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUSD: 0, requests: 0 };

  constructor(private ws: WebSocket, private projectRoot: string, private mcp: MCPManager) {}

  start(): void {
    this.ws.on("message", (data) => void this.onMessage(data.toString()));
    this.ws.on("close", () => this.ac?.abort());
    this.send({ type: "hello", version: VERSION, state: this.snapshot() });
  }

  private send(msg: ServerMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private cm() {
    return sessionManager.getActiveSession()!.contextManager;
  }

  private async onMessage(raw: string): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case "send":
        await this.handleSend(msg.text);
        break;
      case "cancel":
        this.ac?.abort();
        break;
      case "permission": {
        const r = this.permResolver;
        this.permResolver = undefined;
        r?.(msg.allow);
        break;
      }
      case "command":
        await this.handleCommand(msg.name, msg.args || []);
        break;
      case "setModel":
        state.set("currentModel", msg.model);
        this.touchSession((id) => sessionManager.updateSessionModel(id, msg.model));
        this.pushState();
        break;
      case "setAgent":
        state.set("currentAgent", msg.agent);
        this.touchSession((id) => sessionManager.updateSessionAgent(id, msg.agent));
        this.pushState();
        break;
      case "setTheme":
        if (themeEngine.setTheme(msg.theme)) state.set("currentTheme", msg.theme);
        this.pushState();
        break;
      case "setPermissionMode":
        this.permissionMode = msg.mode;
        this.pushState();
        break;
      case "session":
        this.handleSession(msg);
        break;
      case "checkpoints":
        this.handleCheckpoints(msg.action);
        break;
      case "compact":
        this.cm().compact();
        this.send({ type: "system", text: "Context compacted." });
        break;
      case "clear":
        this.cm().clear();
        this.send({ type: "system", text: "Conversation cleared." });
        break;
      case "getState":
        this.pushState();
        break;
      case "getConfig":
        this.pushConfig();
        break;
      case "setProvider": {
        const patch: Record<string, unknown> = {};
        if (msg.apiKey !== undefined) patch.apiKey = msg.apiKey;
        if (msg.baseURL !== undefined) patch.baseURL = msg.baseURL;
        if (msg.defaultModel !== undefined) patch.defaultModel = msg.defaultModel;
        setProviderConfig(msg.name, patch);
        this.reloadProviders();
        this.pushConfig();
        this.pushState();
        break;
      }
      case "removeProvider":
        removeProviderConfig(msg.name);
        this.reloadProviders();
        this.pushConfig();
        this.pushState();
        break;
      case "addModel":
        addCustomModel(msg.model);
        this.pushConfig();
        this.pushState();
        break;
      case "removeModel":
        removeCustomModel(msg.model);
        this.pushConfig();
        this.pushState();
        break;
      case "addMcp":
        setMcpConfig(msg.name, {
          type: msg.url ? "remote" : "local",
          command: msg.command,
          url: msg.url,
          enabled: msg.enabled !== false,
        });
        await this.reloadMcp();
        this.pushConfig();
        this.pushState();
        break;
      case "removeMcp":
        removeMcpConfig(msg.name);
        await this.reloadMcp();
        this.pushConfig();
        this.pushState();
        break;
      case "toggleMcp": {
        const mcpCfg = ((getConfigManager().getAll().mcp as Record<string, never>) || {})[msg.name] as Record<string, unknown> | undefined;
        setMcpConfig(msg.name, { ...(mcpCfg || {}), enabled: msg.enabled });
        await this.reloadMcp();
        this.pushConfig();
        this.pushState();
        break;
      }
    }
  }

  private reloadProviders(): void {
    const cfg = getConfigManager(this.projectRoot).load();
    providerManager.initializeFromConfig(cfg.provider as never);
  }

  private async reloadMcp(): Promise<void> {
    const cfg = getConfigManager(this.projectRoot).load();
    try {
      await this.mcp.disconnect();
      await this.mcp.connect((cfg.mcp as Record<string, never>) || {});
    } catch {
      /* non-fatal */
    }
  }

  private pushConfig(): void {
    this.send({ type: "config", config: this.configView() });
  }

  private configView(): ConfigView {
    const cfg = getConfigManager(this.projectRoot).getAll();
    const provCfg = (cfg.provider as Record<string, Record<string, unknown>>) || {};
    const builtins = ["anthropic", "openai", "zai", "gemini", "ollama"];
    const names = [...new Set([...builtins, ...Object.keys(provCfg)])];
    const available = providerManager.getAvailableProviderNames();
    const providers = names.map((name) => {
      const pc = provCfg[name] || {};
      return {
        name,
        hasKey: !!pc.apiKey || available.includes(name),
        baseURL: pc.baseURL as string | undefined,
        defaultModel: pc.defaultModel as string | undefined,
        builtin: builtins.includes(name),
        available: available.includes(name),
      };
    });
    const models = [...MODEL_CHOICES, ...getCustomModels()].filter((v, i, a) => a.indexOf(v) === i);
    const mcpCfg = (cfg.mcp as unknown as Record<string, Record<string, unknown>>) || {};
    const connected = new Set(this.mcp.list().map((t) => t.server));
    const mcp = Object.entries(mcpCfg).map(([name, e]) => ({
      name,
      command: e.command as string[] | undefined,
      url: e.url as string | undefined,
      enabled: e.enabled !== false,
      connected: connected.has(name),
    }));
    return { providers, models, mcp };
  }

  private async handleSend(text: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.send({ type: "busy", busy: true });
    this.send({ type: "user", text });

    const cm = this.cm();
    const [providerName, ...mp] = state.get("currentModel").split("/");
    let modelName: string | undefined = mp.join("/") || undefined;

    try {
      const config = getConfigManager().getAll();
      const agent = state.get("currentAgent");

      let provider;
      if (config.router) {
        provider = new RoutedProvider(config.router, agent);
        modelName = undefined;
      } else {
        const p = providerManager.getProvider(providerName);
        if (!p) throw new Error(`No provider "${providerName}". Configure a provider.`);
        if (!p.isAvailable()) throw new Error(`No API key for "${providerName}".`);
        provider = p;
      }

      cm.setSystemPrompt(buildSystemPrompt(agent, this.projectRoot));

      const engine = new PermissionEngine(this.permissionMode, config.permissions as never, this.projectRoot);
      const checkpoints = new CheckpointManager(this.projectRoot);
      const mcpAware = createMcpAwareExecutor(this.mcp, executeToolCall);
      const execute = createGuardedExecutor({
        engine,
        checkpoints,
        baseExecute: mcpAware,
        ask: (req: PermissionRequest, reason: string) =>
          new Promise<boolean>((resolve) => {
            this.permResolver = resolve;
            this.send({ type: "permission_request", tool: req.tool, action: req.action, path: req.path, reason });
          }),
      });

      // V1: subagent delegation (child reuses the guard, omits the subagent tool).
      const childToolDefs = [...getToolDefinitions(), ...this.mcp.getToolDefs()];
      const subagentTool = createSubagentTool({
        provider,
        toolDefs: childToolDefs,
        executeTool: execute,
        extractToolCalls,
        model: modelName,
        systemPrompt: buildSystemPrompt(agent, this.projectRoot),
      });
      const subagentExecute = createSubagentAwareExecutor(subagentTool, execute);
      // V1: todo tracker — push the board to the GUI whenever it changes.
      const todoTool = createTodoTool();
      todoTool.store.onChange((items) => this.send({ type: "todos", items }));
      const parentExecute = createTodoAwareExecutor(todoTool, subagentExecute);

      // V7: user-defined shell hooks around every tool call (outermost layer).
      const topExecute = config.hooks
        ? createHookAwareExecutor(config.hooks, parentExecute, defaultRunShell)
        : parentExecute;

      const runner = new AgentRunner(
        {
          provider,
          context: cm,
          toolDefs: [...childToolDefs, subagentTool.def, todoTool.def],
          executeTool: topExecute,
          extractToolCalls,
        },
        { model: modelName, maxRounds: agent === "gsd" ? 30 : 15, largeContextWarnAt: 50 }
      );

      this.ac = new AbortController();
      runner.on("roundStart", (round) => this.send({ type: "round_start", round }));
      runner.on("token", (t) => this.send({ type: "token", text: t }));
      runner.on("streamEnd", () => this.send({ type: "stream_end" }));
      runner.on("usage", (u) => {
        this.applyCost(u);
        this.send({ type: "usage", ...u, estimatedCostUSD: this.cost.estimatedCostUSD });
      });
      runner.on("toolStart", (name, args) => {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(args) as Record<string, unknown>;
        } catch {
          /* leave empty */
        }
        this.send({ type: "tool_start", tool: name, name, args: parsed, argsRaw: args });
      });
      runner.on("toolResult", (name, ok, firstLine, full) =>
        this.send({ type: "tool_result", name, ok, firstLine, full })
      );
      runner.on("roundEnd", (round, willContinue) => this.send({ type: "round_end", round, willContinue }));
      runner.on("contextLarge", () =>
        this.send({ type: "system", text: "Context is getting large — compact to save tokens." })
      );
      runner.on("runError", (e) => this.send({ type: "error", message: e instanceof Error ? e.message : String(e) }));

      let outbound = await expandMentions(text, this.projectRoot);
      if (this.mcp.has(DEFAULT_RECALL_TOOL)) {
        try {
          outbound += await recallRelevant(mcpAware, text);
        } catch {
          // best-effort
        }
      }
      const result = await runner.run(outbound, this.ac.signal);
      this.send({ type: "done", stopReason: result.stopReason, rounds: result.rounds });
      this.touchSession((id) => sessionManager.markDirty(id));
    } catch (err) {
      this.send({ type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      this.ac = undefined;
      this.busy = false;
      this.send({ type: "busy", busy: false });
      this.pushState();
    }
  }

  private async handleCommand(name: string, args: string[]): Promise<void> {
    const cmd = commandRegistry.get(name);
    if (cmd) {
      await this.handleSend(resolveTemplate(cmd.template, args));
      return;
    }
    this.send({ type: "system", text: `Unknown command: /${name}` });
  }

  private handleSession(msg: Extract<ClientMessage, { type: "session" }>): void {
    switch (msg.action) {
      case "new":
        sessionManager.createSession({ projectRoot: this.projectRoot });
        break;
      case "switch":
        if (msg.id) sessionManager.setActiveSession(msg.id);
        break;
      case "close":
        if (msg.id) sessionManager.closeSession(msg.id);
        break;
      case "rename":
        if (msg.id && msg.title) sessionManager.renameSession(msg.id, msg.title);
        break;
    }
    this.pushState();
  }

  private handleCheckpoints(action: "list" | "undo"): void {
    const cm = new CheckpointManager(this.projectRoot);
    if (action === "undo") {
      const cp = cm.undoLast();
      this.send({ type: "system", text: cp ? `Undid ${cp.tool} change to ${cp.path}` : "Nothing to undo." });
    }
    this.send({
      type: "checkpoints",
      items: cm.list().map((c) => ({ id: c.id, tool: c.tool, path: c.path, existed: c.existed, timestamp: c.timestamp })),
    });
  }

  private applyCost(u: { promptTokens: number; completionTokens: number; totalTokens: number }): void {
    this.cost.promptTokens += u.promptTokens;
    this.cost.completionTokens += u.completionTokens;
    this.cost.totalTokens += u.totalTokens;
    this.cost.requests += 1;
    this.cost.estimatedCostUSD += (u.promptTokens / 1_000_000) * 3 + (u.completionTokens / 1_000_000) * 15;
    const id = sessionManager.getActiveSessionId();
    if (id) sessionManager.updateSessionCost(id, u.totalTokens, (u.promptTokens / 1_000_000) * 3 + (u.completionTokens / 1_000_000) * 15);
  }

  private touchSession(fn: (id: string) => void): void {
    const id = sessionManager.getActiveSessionId();
    if (id) fn(id);
  }

  private pushState(): void {
    this.send({ type: "state", state: this.snapshot() });
  }

  private snapshot(): StateSnapshot {
    const available = providerManager.getAvailableProviderNames();
    const activeId = sessionManager.getActiveSessionId();
    return {
      model: state.get("currentModel"),
      agent: state.get("currentAgent"),
      theme: themeEngine.getTheme().name,
      permissionMode: this.permissionMode,
      themes: themeEngine.getAllThemes().map((t) => ({ name: t.name, display: t.display })),
      models: [...MODEL_CHOICES, ...getCustomModels()].filter((v, i, a) => a.indexOf(v) === i),
      agents: agentRegistry.getAll().map((a) => a.name),
      sessions: sessionManager.getAllSessions().map((s) => ({ id: s.id, title: s.title, active: s.id === activeId })),
      mcpTools: this.mcp.list().map((t) => ({ server: t.server, tool: t.tool, full: `mcp__${t.server}__${t.tool}` })),
      cost: { ...this.cost },
      providers: providerManager.getAllProviderNames().map((n) => ({ name: n, available: available.includes(n) })),
    };
  }
}
