import { randomBytes } from "crypto";
import type { AddressInfo } from "net";
import { WebSocketServer, WebSocket } from "ws";
import { getConfigManager } from "../core/config.js";
import { state } from "../core/state.js";
import { estimateCostUSD } from "../core/pricing.js";
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
import { colorsToCSS } from "../tui/themes/types.js";
import { globProject } from "../core/project-files.js";
import { detectNeeds, getProvider } from "../core/onboarding.js";
import { getSecretStore } from "../core/secrets/store.js";
import { providerKeyName } from "../core/secrets/resolver.js";
import { commandRegistry } from "../commands/registry.js";
import { agentRegistry } from "../agents/registry.js";
import { resolveTemplate } from "../commands/loader.js";
import { refineGoal } from "../core/refine-goal.js";
import { formatApprovalPrompt } from "../core/approval-diff.js";
import { attachmentFromDataUrl } from "../core/attachments.js";
import { ClientMessage, ClientAttachment, ServerMessage, StateSnapshot, ConfigView } from "./protocol.js";
import {
  setProviderConfig,
  removeProviderConfig,
  addCustomModel,
  removeCustomModel,
  getCustomModels,
  setMcpConfig,
  removeMcpConfig,
} from "./config-store.js";

const VERSION = "1.2.0";

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
 * Accept loopback http(s) origins and Tauri's custom schemes; reject everything
 * else so a malicious local web page can't open a WebSocket to the engine even
 * if it recovers the token. Browsers always send Origin on ws://; non-browser
 * clients (the Tauri shell, CLI drivers) typically omit it and are allowed by
 * the caller's `origin &&` guard. Exported for tests.
 */
export function isAllowedOrigin(origin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  // Node keeps the brackets in hostname for IPv6 literals (e.g. "[::1]");
  // strip them for comparison.
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "127.0.0.1" || host === "localhost" || host === "::1") return true;
  // Tauri renders the webview under a custom scheme (tauri://localhost or
  // https://tauri.localhost on Windows).
  if (parsed.protocol === "tauri:") return true;
  if (host === "tauri.localhost") return true;
  return false;
}

/**
 * Start the engine as a local WebSocket server. Providers/tools/registries must
 * already be initialized by the caller (cli.ts serve command). Prints a single
 * `{port, token, pid}` JSON line on stdout, then never writes to stdout again so
 * a GUI can drive the engine over the socket.
 */
export async function runServe(opts: ServeOptions): Promise<{ port: number; token: string; close: () => Promise<void> }> {
  const projectRoot = opts.projectRoot;

  sessionManager.initialize(projectRoot);
  if (sessionManager.getSessionCount() === 0) sessionManager.createSession({ projectRoot });

  const mcp = new MCPManager();
  const config = getConfigManager(projectRoot).getAll();

  const token = randomBytes(24).toString("hex");
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });

  // Graceful teardown handle (used by tests and embedders); the CLI ignores it
  // and relies on the SIGINT/SIGTERM handlers below.
  const close = async (): Promise<void> => {
    try {
      await mcp.disconnect();
    } catch {
      /* ignore */
    }
    for (const client of wss.clients) {
      try {
        client.terminate();
      } catch {
        /* ignore */
      }
    }
    await new Promise<void>((res) => wss.close(() => res()));
  };

  const ready = new Promise<{ port: number; token: string; close: () => Promise<void> }>((resolve) => {
    wss.on("listening", () => {
      const addr = wss.address() as AddressInfo;
      if (opts.print !== false) {
        process.stdout.write(JSON.stringify({ port: addr.port, token, pid: process.pid }) + "\n");
      }
      // Connect MCP servers in the background so the handshake isn't blocked by a
      // slow `npx` server download; tools appear once discovery completes.
      void mcp.connect((config.mcp as Record<string, never>) || {}).catch(() => {});
      resolve({ port: addr.port, token, close });
    });
  });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.searchParams.get("token") !== token) {
      ws.close(1008, "bad token");
      return;
    }
    // Origin allow-list: the engine listens on 127.0.0.1 only, but a malicious
    // local web page could still try a cross-site WS handshake (browsers send
    // Origin on ws://). Accept loopback / Tauri origins and clients that send
    // no Origin (non-browser tools); reject anything else so a web page can't
    // drive the engine even if it somehow learns the token.
    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin)) {
      ws.close(1008, "bad origin");
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
        await this.handleSend(msg.text, msg.attachments);
        break;
      case "edit":
        await this.handleEdit(msg.text, msg.truncateIndex);
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
        // Replay the active session's full conversation so a reconnecting GUI
        // rebuilds its message blocks instead of blanking. The data is already
        // in ContextManager + persisted by the session manager; it just wasn't
        // on the wire before.
        this.pushHistory();
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
      case "listFiles": {
        // D2: glob the project for @-mention autocomplete. Cap results + skip
        // noise dirs (node_modules, .git) so the popup stays useful.
        this.send({ type: "files", items: globProject(this.projectRoot, msg.query) });
        break;
      }
      case "configure": {
        // Onboarding wizard result: persist the provider (key to the keyring,
        // never plaintext) + chosen model, reload, and re-push state so
        // needsOnboarding flips false and the wizard closes.
        await this.applyOnboarding(msg.providerId, msg.model, msg.apiKey, msg.baseURL);
        this.pushState();
        this.send({ type: "system", text: `✓ Configured ${msg.providerId} → ${msg.model}. You're ready to go.` });
        break;
      }
    }
  }

  private reloadProviders(): void {
    const cfg = getConfigManager(this.projectRoot).load();
    providerManager.initializeFromConfig(cfg.provider as never);
  }

  /**
   * Apply an onboarding wizard result: store the API key in the platform secret
   * store (falling back to plaintext only if no store is available), write the
   * provider + chosen model into config, and reload providers so the next
   * message works. The OAuth router path skips the key and just sets the baseURL.
   */
  private async applyOnboarding(
    providerId: string,
    model: string,
    apiKey: string | undefined,
    baseURL: string | undefined
  ): Promise<void> {
    const provider = getProvider(providerId);
    // Store the key to the keyring when one is required + provided.
    let storedKey: string | undefined;
    if (!provider?.noKey && apiKey?.trim()) {
      try {
        const store = await getSecretStore();
        const ok = await store.set(providerKeyName(providerId), apiKey.trim());
        storedKey = ok ? `keyring://${providerId}` : apiKey.trim();
      } catch {
        storedKey = apiKey.trim(); // last resort: plaintext (engine still reads it)
      }
    }
    // Map the onboarding provider id to the config provider key.
    // claude-router configures the anthropic provider with the router baseURL.
    const configKey = providerId === "claude-router" ? "anthropic" : providerId;
    setProviderConfig(configKey, {
      ...(storedKey ? { apiKey: storedKey } : {}),
      ...(baseURL ? { baseURL } : {}),
    });
    // Set the chosen model as the default + small model (if it matches the provider).
    const cfg = getConfigManager(this.projectRoot);
    const all = cfg.load();
    all.model = model;
    const small = provider?.models.find((m) => m !== model);
    if (small) all.small_model = small;
    cfg.save();
    state.set("currentModel", model);
    this.reloadProviders();
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
    const provCfg = cfg.provider as unknown as Record<string, Record<string, unknown>>;
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

  /**
   * Edit/regenerate: drop everything from the conversation at/after
   * `truncateIndex` (mirroring the GUI's block list), then run `text` as if it
   * were a fresh send. Used for both "edit a user turn and re-run" and
   * "regenerate the last assistant response" (same primitive).
   */
  private async handleEdit(text: string, truncateIndex: number): Promise<void> {
    if (this.busy) return;
    const cm = this.cm();
    const dropped = cm.truncateToCount(truncateIndex);
    // Tell the GUI to discard blocks at/after this index so its view matches.
    this.send({ type: "system", text: dropped > 0 ? `Edited conversation (${dropped} message${dropped === 1 ? "" : "s"} dropped).` : "Regenerating." });
    await this.handleSend(text);
  }

  private async handleSend(text: string, attachments?: ClientAttachment[]): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.send({ type: "busy", busy: true });
    // Snapshot context length BEFORE this turn is added, so the GUI can map a
    // user block → the context index to truncate to for edit/regenerate.
    this.send({ type: "user", text, contextCount: this.cm().getMessages().length });

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
            // v2.5 wiring: include a diff preview for file mutations so the
            // GUI shows actual code changes, not just a filename.
            let diff: string | undefined;
            if (req.proposedContent && req.path) {
              try {
                const { readFileSync } = require("node:fs");
                const { resolve: resolvePath } = require("node:path");
                let prior = "";
                try { prior = readFileSync(resolvePath(this.projectRoot, req.path), "utf-8"); } catch { /* new file */ }
                diff = formatApprovalPrompt(prior, req.proposedContent, req.path);
              } catch { /* best-effort */ }
            }
            this.send({ type: "permission_request", tool: req.tool, action: req.action, path: req.path, reason, diff });
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
        { model: modelName, maxRounds: agent === "gsd" ? 30 : 15, maxContextTokens: 84000 }
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
      runner.on("contextLarge", () => {
        cm.compact();
      });
      runner.on("runError", (e) => this.send({ type: "error", message: e instanceof Error ? e.message : String(e) }));

      let outbound = await expandMentions(text, this.projectRoot);
      if (this.mcp.has(DEFAULT_RECALL_TOOL)) {
        try {
          outbound += await recallRelevant(mcpAware, text);
        } catch {
          // best-effort
        }
      }
      // Convert wire attachments → engine Attachments for multimodal send.
      const visionAttachments = (attachments ?? [])
        .map((a) => {
          try {
            return attachmentFromDataUrl(a.dataUrl, { name: a.name });
          } catch (err) {
            this.send({ type: "system", text: `Skipped attachment: ${err instanceof Error ? err.message : String(err)}` });
            return null;
          }
        })
        .filter((a): a is NonNullable<typeof a> => a !== null);
      const result = await runner.run(outbound, this.ac.signal, visionAttachments);
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
      // Refine casual goal input for the automation loop (pure, model-independent).
      // Fires for both /automationloop and its /loop alias.
      let sendArgs = args;
      if ((cmd.name === "automationloop" || cmd.name === "loop") && args.length > 0) {
        const { refined } = refineGoal(args.join(" "));
        sendArgs = [refined];
      }
      await this.handleSend(resolveTemplate(cmd.template, sendArgs));
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
    // Real per-model pricing instead of a hardcoded $3/$15 (wrong for glm/gpt-mini/ollama).
    const turnCost = estimateCostUSD(state.get("currentModel") || "", u.promptTokens, u.completionTokens);
    this.cost.estimatedCostUSD += turnCost;
    const id = sessionManager.getActiveSessionId();
    if (id) sessionManager.updateSessionCost(id, u, turnCost);
  }

  private touchSession(fn: (id: string) => void): void {
    const id = sessionManager.getActiveSessionId();
    if (id) fn(id);
  }

  private pushState(): void {
    this.send({ type: "state", state: this.snapshot() });
  }

  /**
   * Replay the active session's conversation as a single `history` frame. Maps
   * ContextManager messages to HistoryMessage, dropping the system prompt (the
   * GUI doesn't render it as a turn) and trimming tool content to a sane size.
   */
  private pushHistory(): void {
    const session = sessionManager.getActiveSession();
    if (!session) {
      this.send({ type: "history", messages: [] });
      return;
    }
    const messages = session.contextManager.getMessages();
    const history = messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        const out: { role: "user" | "assistant" | "tool"; content: string; name?: string } = {
          role: m.role as "user" | "assistant" | "tool",
          // Tool metadata carries the tool name; surface it for card rendering.
          content: m.content,
        };
        const name = (m.metadata as { name?: string } | undefined)?.name;
        if (name) out.name = name;
        return out;
      });
    this.send({ type: "history", messages: history });
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
      // The context-window cap the engine actually enforces (TUI uses 84000).
      // Surfaced so the GUI's token gauge divides by the right denominator.
      contextWindow: 84000,
      // The engine's real slash-command catalog (registry .md templates), so the
      // GUI autocomplete stops drifting from what the engine accepts.
      commands: commandRegistry.getAll().map((c) => ({ name: c.name, description: c.description })),
      // The active theme as CSS variables (colorsToCSS), so the GUI applies the
      // full palette rather than collapsing 16 themes to 5 accent buckets.
      themeVars: colorsToCSS(themeEngine.getColors()),
      // First-run intercept: true when no provider is usable yet, so the GUI/TUI
      // shows the onboarding wizard instead of letting the first message fail.
      needsOnboarding: detectNeeds(process.env, available),
    };
  }
}
