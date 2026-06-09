#!/usr/bin/env node

import { resolve } from "path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { TUIApp } from "./tui/app.js";
import { getConfigManager } from "./core/config.js";
import { state } from "./core/state.js";
import { events } from "./core/events.js";
import { providerManager } from "./ai/provider.js";
import { toolManager } from "./tools/index.js";
import { runSetup } from "./commands/setup.js";
import { loadAllSkills } from "./skills/loader.js";
import { skillRegistry } from "./skills/registry.js";
import { loadAllCommands } from "./commands/loader.js";
import { commandRegistry } from "./commands/registry.js";
import { loadAllAgents } from "./agents/loader.js";
import { agentRegistry } from "./agents/registry.js";
import { themeEngine } from "./tui/themes/engine.js";
import { sessionManager } from "./core/session-manager.js";
import { contextManager } from "./ai/context.js";
import { getToolDefinitions, executeToolCall } from "./tools/tool-executor.js";
import { AgentRunner } from "./core/agent-runner.js";
import { extractToolCalls } from "./core/tool-call-extractor.js";
import { buildSystemPrompt } from "./core/system-prompt.js";
import { expandMentions } from "./core/mentions.js";
import { recallRelevant, DEFAULT_RECALL_TOOL } from "./core/brain-recall.js";
import { RoutedProvider } from "./ai/routed-provider.js";
import { PermissionEngine, PermissionMode, PermissionRequest } from "./core/permissions.js";
import { CheckpointManager } from "./core/checkpoints.js";
import { createGuardedExecutor } from "./core/guarded-executor.js";
import { createSubagentTool, createSubagentAwareExecutor } from "./core/subagent.js";
import { createTodoTool, createTodoAwareExecutor } from "./core/todos.js";
import { createHookAwareExecutor, defaultRunShell } from "./core/hooks.js";
import { MCPManager } from "./mcp/manager.js";
import { createMcpAwareExecutor } from "./mcp/mcp-executor.js";
import { runMcpServer } from "./mcp/server.js";
import { runServe } from "./server/serve.js";
import { launchGui } from "./server/gui-launcher.js";
import { runAutopilotSession, summarizeAutopilot } from "./core/autopilot-session.js";
import { usageTracker } from "./core/usage-tracker.js";
import { estimateCostUSD } from "./core/pricing.js";
import { writeRouterConfig, routerStartHelp, probeRouter, DEFAULT_ROUTER_URL } from "./core/router-connect.js";
import { setLogLevel, createLogger } from "./utils/logger.js";

const log = createLogger({ prefix: "cli" });

const VERSION = "0.3.0";

function getInstallRoot(): string {
  // fileURLToPath handles percent-encoding (spaces) and drive-letter casing on
  // Windows — a raw `.pathname` breaks global installs under paths like
  // "C:\Users\John Doe\..." (builtins then silently fail to load).
  return resolve(fileURLToPath(new URL("..", import.meta.url)));
}

function loadRegistries(installRoot: string, skillPaths: string[]): void {
  const { skills } = loadAllSkills(installRoot, skillPaths);
  for (const skill of skills) {
    skillRegistry.register(skill);
  }

  const commands = loadAllCommands(installRoot);
  for (const cmd of commands) {
    commandRegistry.register(cmd);
  }

  const agents = loadAllAgents(installRoot);
  for (const agent of agents) {
    agentRegistry.register(agent);
  }
}

const program = new Command();

program
  .name("sentinel")
  .description("AI-powered coding CLI - The best coding CLI on the planet")
  .version(VERSION)
  .option("--theme <theme>", "Set theme", "opencode")
  .option("--model <model>", "Set AI model")
  .option("--agent <agent>", "Set default agent")
  .option("--verbose", "Enable verbose logging")
  .option("--no-tui", "Run without TUI (headless mode)")
  .option("--project <path>", "Project root directory", process.cwd())
  .action(async (options) => {
    try {
      await runMain(options);
    } catch (err) {
      console.error(`Fatal error: ${err}`);
      process.exit(1);
    }
  });

program
  .command("config")
  .description("Show current configuration")
  .option("--json", "Output as JSON")
  .action((opts) => {
    const config = getConfigManager().load();
    if (opts.json) {
      console.log(JSON.stringify(config, null, 2));
    } else {
      console.log("Current Configuration:");
      console.log(JSON.stringify(config, null, 2));
    }
  });

program
  .command("themes")
  .description("List available themes")
  .action(() => {
    const themes = themeEngine.getAllThemes();
    const current = themeEngine.getTheme().name;
    console.log("\nAvailable Themes:\n");
    for (const theme of themes) {
      const marker = theme.name === current ? " * " : "   ";
      console.log(`${marker}${theme.display.padEnd(12)} - ${theme.description}`);
    }
    console.log();
  });

program
  .command("skills")
  .description("List available skills")
  .action(() => {
    const config = getConfigManager().load();
    loadRegistries(getInstallRoot(), config.skills.paths);
    const skills = skillRegistry.getAll();
    if (skills.length === 0) {
      console.log("No skills loaded. Run sentinel first to load skills.");
      return;
    }
    console.log("\nLoaded Skills:\n");
    for (const skill of skills) {
      console.log(`  ${skill.name.padEnd(16)} - ${skill.description} [${skill.source}]`);
    }
    console.log();
  });

program
  .command("agents")
  .description("List available agents")
  .action(() => {
    const config = getConfigManager().load();
    loadRegistries(getInstallRoot(), config.skills.paths);
    const agents = agentRegistry.getAll();
    if (agents.length === 0) {
      console.log("No agents loaded. Run sentinel first to load agents.");
      return;
    }
    console.log("\nAvailable Agents:\n");
    for (const agent of agents) {
      console.log(`  ${agent.name.padEnd(12)} - ${agent.description} [${agent.mode}]`);
    }
    console.log();
  });

program
  .command("setup")
  .description("Interactive setup wizard for API keys and models")
  .action(async () => {
    await runSetup();
  });

program
  .command("ask <question>")
  .description("Ask a question (headless mode)")
  .option("--model <model>", "AI model to use")
  .action(async (question, _opts, command) => {
    const config = getConfigManager().load();
    providerManager.initializeFromConfig(config.provider as any);
    // --model is also defined on the root command, so commander binds it to the
    // global opts; merge both so the subcommand override is honored either way.
    const merged = command.optsWithGlobals();
    const model = merged.model || config.model;
    const [providerName, ...modelParts] = model.split("/");
    const modelName = modelParts.join("/") || undefined;

    console.log(`\nAsking ${model}...\n`);

    try {
      const response = await providerManager.chat(
        providerName,
        [{ role: "user", content: question }],
        { model: modelName }
      );
      console.log(response.content);
    } catch (err) {
      console.error(`Error: ${err}`);
    }
  });

program
  .command("run <task>")
  .description("Run an agentic task headlessly — executes tools (file, bash, search, git, web, patch)")
  .option("--model <model>", "AI model to use (provider/model)")
  .option("--agent <agent>", "Agent to use (default: config default_agent)")
  .option("--max-steps <n>", "Maximum tool rounds")
  .option("--json", "Emit newline-delimited JSON events instead of text")
  .option("--project <path>", "Project root directory")
  .option("--permission-mode <mode>", "Permission mode: yolo | auto | gated (default: yolo)")
  .option("--yes", "Auto-approve permission prompts (non-interactive)")
  .action(async (task, opts, command) => {
    // --model/--project are also defined on the root command, so commander binds
    // them to the global opts; merge so subcommand flags are honored either way.
    const merged = command.optsWithGlobals();
    const projectRoot = merged.project || opts.project || process.cwd();
    const config = getConfigManager(projectRoot).load();
    providerManager.initializeFromConfig(config.provider as any);
    toolManager.initialize(projectRoot);
    loadRegistries(getInstallRoot(), config.skills.paths);

    const explicitModel = merged.model as string | undefined;
    const agentName = opts.agent || config.default_agent;
    const json = !!opts.json;

    // Use the router when configured (and no explicit --model override); it
    // resolves a provider/model chain with fallback + retry. Otherwise a single
    // provider, exactly as before.
    let provider;
    let modelName: string | undefined;
    if (config.router && !explicitModel) {
      provider = new RoutedProvider(config.router, agentName);
      modelName = undefined;
    } else {
      const model = explicitModel || config.model;
      const parts = model.split("/");
      modelName = parts.slice(1).join("/") || undefined;
      const single = providerManager.getProvider(parts[0]);
      if (!single || !single.isAvailable()) {
        console.error(`Provider "${parts[0]}" not available. Configure it (sentinel setup) or set an API key.`);
        process.exitCode = 1;
        return;
      }
      provider = single;
    }

    contextManager.setSystemPrompt(buildSystemPrompt(agentName, projectRoot));

    // R3: connect configured MCP servers and merge their tools into the toolset.
    const mcp = new MCPManager();
    await mcp.connect((config.mcp as any) || {});
    const toolDefs = [...getToolDefinitions(), ...mcp.getToolDefs()];
    const mcpAware = createMcpAwareExecutor(mcp, executeToolCall);

    // R2: enforce permissions + checkpoint mutations. Default mode is "yolo"
    // (unchanged behavior); --permission-mode auto|gated turns on guardrails.
    const mode: PermissionMode = (opts.permissionMode as PermissionMode) || "yolo";
    const autoApprove = !!opts.yes;
    const engine = new PermissionEngine(mode, config.permissions as any, projectRoot);
    const checkpoints = new CheckpointManager(projectRoot);
    const guardedExecute = createGuardedExecutor({
      engine,
      checkpoints,
      baseExecute: mcpAware,
      ask: async (req: PermissionRequest, reason: string) => {
        // Headless: approve only with --yes; otherwise deny. Stay silent in
        // --json mode so the denial note can't be mistaken for protocol output.
        const label = `${req.tool}${req.action ? `(${req.action})` : ""}`;
        if (autoApprove) return true;
        if (!json) console.error(`Permission required: ${label} [${reason}] — denied (pass --yes to allow).`);
        return false;
      },
    });

    // V1: subagent delegation. The child reuses the same guarded executor (so
    // permissions/checkpoints still apply) but its toolset omits the subagent
    // tool, capping nesting at one level.
    const subagentTool = createSubagentTool({
      provider,
      toolDefs,
      executeTool: guardedExecute,
      extractToolCalls,
      model: modelName,
      systemPrompt: buildSystemPrompt(agentName, projectRoot),
    });
    const subagentExecute = createSubagentAwareExecutor(subagentTool, guardedExecute);
    // V1: todo tracker (parent-only) composed over the subagent executor.
    const todoTool = createTodoTool();
    const parentExecute = createTodoAwareExecutor(todoTool, subagentExecute);

    // V7: user-defined shell hooks around every tool call (outermost layer).
    const topExecute = config.hooks
      ? createHookAwareExecutor(config.hooks, parentExecute, defaultRunShell)
      : parentExecute;

    const maxRounds = opts.maxSteps ? parseInt(opts.maxSteps, 10) : agentName === "gsd" ? 30 : 15;
    const runner = new AgentRunner(
      {
        provider,
        context: contextManager,
        toolDefs: [...toolDefs, subagentTool.def, todoTool.def],
        executeTool: topExecute,
        extractToolCalls,
      },
      { model: modelName, maxRounds }
    );

    const emit = (obj: Record<string, unknown>) => {
      if (json) console.log(JSON.stringify(obj));
    };

    runner.on("roundStart", (round) => emit({ type: "round_start", round }));
    runner.on("token", (text) => {
      if (json) emit({ type: "token", text });
      else process.stdout.write(text);
    });
    runner.on("streamEnd", () => {
      if (!json) process.stdout.write("\n");
    });
    runner.on("usage", (u) => emit({ type: "usage", ...u }));
    runner.on("toolStart", (name, args) => {
      emit({ type: "tool_start", name, args });
      if (!json) process.stdout.write(`[tool] ${name} ${args}\n`);
    });
    runner.on("toolResult", (name, ok, firstLine, full) => {
      emit({ type: "tool_result", name, ok, firstLine, full });
      if (!json) process.stdout.write(`  ${ok ? "ok" : "ERR"} ${firstLine}\n`);
    });
    runner.on("roundEnd", (round, willContinue) => emit({ type: "round_end", round, willContinue }));
    runner.on("runError", (e) => {
      const message = e instanceof Error ? e.message : String(e);
      emit({ type: "error", message });
      if (!json) console.error(`\nError: ${message}`);
    });

    const ac = new AbortController();
    process.once("SIGINT", () => ac.abort());

    // disconnect MCP (kills child processes) on ANY exit path, including a throw
    // before the agent loop — otherwise the process can't drain and exit.
    let result;
    try {
      // V2: expand @file / @url mentions in the task before the agent runs.
      let outboundTask = await expandMentions(task, projectRoot);
      // V3: auto-recall from the Sentinel Prime brain when its MCP is connected.
      if (mcp.has(DEFAULT_RECALL_TOOL)) {
        try {
          outboundTask += await recallRelevant(mcpAware, task);
        } catch {
          // best-effort
        }
      }
      result = await runner.run(outboundTask, ac.signal);
    } finally {
      await mcp.disconnect();
    }
    emit({ type: "done", stopReason: result.stopReason, rounds: result.rounds, usage: result.usage });

    // Set exitCode and let the event loop drain (don't process.exit() — on
    // Windows that can tear down a still-flushing piped stdout and crash libuv).
    process.exitCode =
      result.stopReason === "no_tool_calls" ? 0 :
      result.stopReason === "aborted" ? 130 :
      result.stopReason === "max_rounds" ? 3 : 1;
  });

program
  .command("autopilot <goal>")
  .description("Set-and-forget: autonomously loop the GSD cycle until the project is production-ready")
  .option("--model <model>", "AI model to use (provider/model)")
  .option("--agent <agent>", "Agent to use (default: gsd)")
  .option("--project <path>", "Project root directory")
  .option("--max-iterations <n>", "Max autopilot iterations")
  .option("--max-stalls <n>", "Consecutive no-change iterations before stopping")
  .option("--max-minutes <n>", "Stop after this many wall-clock minutes")
  .option("--max-cost <usd>", "Stop after this estimated spend (USD)")
  .option("--resume", "Resume a prior interrupted run for the same goal")
  .action(async (goal, opts, command) => {
    const merged = command.optsWithGlobals();
    const projectRoot = merged.project || opts.project || process.cwd();
    const config = getConfigManager(projectRoot).load();
    providerManager.initializeFromConfig(config.provider as any);
    toolManager.initialize(projectRoot);
    loadRegistries(getInstallRoot(), config.skills.paths);

    const explicitModel = merged.model as string | undefined;
    const agentName = opts.agent || "gsd";

    let provider;
    let modelName: string | undefined;
    if (config.router && !explicitModel) {
      provider = new RoutedProvider(config.router, agentName);
      modelName = undefined;
    } else {
      const model = explicitModel || config.model;
      const parts = model.split("/");
      modelName = parts.slice(1).join("/") || undefined;
      const single = providerManager.getProvider(parts[0]);
      if (!single || !single.isAvailable()) {
        console.error(`Provider "${parts[0]}" not available. Run "sentinel setup" or "sentinel connect", or set an API key.`);
        process.exitCode = 1;
        return;
      }
      provider = single;
    }

    const mcp = new MCPManager();
    await mcp.connect((config.mcp as any) || {});
    const toolDefs = [...getToolDefinitions(), ...mcp.getToolDefs()];
    const mcpAware = createMcpAwareExecutor(mcp, executeToolCall);
    // Autonomous => yolo (no human in the loop). Checkpoints still snapshot edits.
    const engine = new PermissionEngine("yolo", config.permissions as any, projectRoot);
    const checkpoints = new CheckpointManager(projectRoot);
    const guardedExecute = createGuardedExecutor({ engine, checkpoints, baseExecute: mcpAware, ask: async () => true });
    const costModel = explicitModel || config.model;
    const subagentTool = createSubagentTool({
      provider,
      toolDefs,
      executeTool: guardedExecute,
      extractToolCalls,
      model: modelName,
      systemPrompt: buildSystemPrompt(agentName, projectRoot),
      onUsage: (u) => usageTracker.recordCostUSD(estimateCostUSD(costModel, u.promptTokens, u.completionTokens)),
    });

    const ap = config.autopilot ?? { maxIterations: 10, maxStalls: 2 };
    const maxIterations = opts.maxIterations ? parseInt(opts.maxIterations, 10) : Math.max(1, ap.maxIterations ?? 10);
    const maxStalls = opts.maxStalls ? parseInt(opts.maxStalls, 10) : Math.max(1, ap.maxStalls ?? 2);

    const ac = new AbortController();
    process.once("SIGINT", () => {
      console.error("\n[autopilot] stopping after the current step…");
      ac.abort();
    });

    let result;
    try {
      result = await runAutopilotSession({
        goal,
        projectRoot,
        maxIterations,
        maxStalls,
        verifyCommands: ap.verifyCommands,
        maxMinutes: opts.maxMinutes ? parseFloat(opts.maxMinutes) : ap.maxMinutes,
        maxCostUSD: opts.maxCost ? parseFloat(opts.maxCost) : ap.maxCostUSD,
        costSpent: () => usageTracker.snapshot().estimatedCostUSD,
        resume: !!opts.resume,
        runSubagent: (args, sig) => subagentTool.execute(args, sig),
        signal: ac.signal,
        log: (m) => console.log(m),
      });
    } finally {
      await mcp.disconnect();
    }
    console.log("\n" + summarizeAutopilot(result));
    process.exitCode =
      result.status === "production_ready" ? 0 :
      result.status === "aborted" ? 130 :
      result.status === "stalled" ? 4 : 3;
  });

program
  .command("connect [target]")
  .description("Configure Claude over your OAuth router (keyless). target: claude (default)")
  .option("--url <url>", "Router base URL", DEFAULT_ROUTER_URL)
  .action(async (target, opts) => {
    const t = (target || "claude").toLowerCase();
    if (t !== "claude") {
      console.error(`Unknown connect target "${t}". Supported: claude`);
      process.exitCode = 1;
      return;
    }
    const url = opts.url || DEFAULT_ROUTER_URL;
    const path = writeRouterConfig(url);
    console.log(`✓ Configured Claude via OAuth router (keyless) → ${url}`);
    console.log(`  Saved to ${path}`);
    const probe = await probeRouter(url);
    if (probe.reachable) {
      console.log(`✓ Router reachable — ${probe.detail}. Run "sentinel" and use a Claude model.`);
    } else {
      console.log(`! Router not reachable yet (${probe.detail}).`);
      console.log(routerStartHelp());
    }
  });

program
  .command("checkpoints")
  .description("List file checkpoints created by the agent")
  .option("--project <path>", "Project root directory")
  .action((opts, command) => {
    const projectRoot = command.optsWithGlobals().project || opts.project || process.cwd();
    const cps = new CheckpointManager(projectRoot).list();
    if (cps.length === 0) {
      console.log("No checkpoints.");
      return;
    }
    for (const c of cps) {
      const when = new Date(c.timestamp).toLocaleString();
      console.log(`${c.id}  ${when}  ${c.tool.padEnd(6)} ${c.existed ? "edit  " : "create"}  ${c.path}`);
    }
  });

program
  .command("undo")
  .description("Undo the most recent agent file change")
  .option("--project <path>", "Project root directory")
  .action((opts, command) => {
    const projectRoot = command.optsWithGlobals().project || opts.project || process.cwd();
    const cp = new CheckpointManager(projectRoot).undoLast();
    if (!cp) {
      console.log("Nothing to undo.");
      return;
    }
    console.log(`Undid ${cp.tool} ${cp.existed ? "edit" : "create"} of ${cp.path}`);
  });

program
  .command("mcp")
  .description("List configured MCP servers and their discovered tools")
  .option("--project <path>", "Project root directory")
  .action(async (opts, command) => {
    const projectRoot = command.optsWithGlobals().project || opts.project || process.cwd();
    const config = getConfigManager(projectRoot).load();
    const servers = (config.mcp as Record<string, unknown>) || {};
    if (Object.keys(servers).length === 0) {
      console.log('No MCP servers configured. Add them under "mcp" in sentinel.json.');
      return;
    }
    const mcp = new MCPManager();
    await mcp.connect(servers as any);
    const tools = mcp.list();
    if (tools.length === 0) {
      console.log("Connected, but no tools were discovered.");
    } else {
      console.log(`\n${mcp.serverCount()} server(s), ${tools.length} tool(s):\n`);
      for (const t of tools) {
        const desc = t.description ? ` - ${t.description.split("\n")[0]}` : "";
        console.log(`  mcp__${t.server}__${t.tool}${desc}`);
      }
    }
    await mcp.disconnect();
  });

program
  .command("mcp-serve")
  .description("Run Sentinel as an MCP server (stdio), exposing its tools to MCP clients")
  .option("--project <path>", "Project root directory")
  .action(async (opts, command) => {
    const projectRoot = command.optsWithGlobals().project || opts.project || process.cwd();
    try {
      await runMcpServer(projectRoot);
    } catch (err) {
      // stderr only — stdout is the JSON-RPC channel.
      console.error(`MCP server failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  });

program
  .command("serve")
  .description("Run the engine as a local WebSocket server for the desktop GUI")
  .option("--project <path>", "Project root directory")
  .action(async (opts, command) => {
    // stdout carries only the {port,token} handshake; silence all logging first.
    setLogLevel("silent");
    const projectRoot = command.optsWithGlobals().project || opts.project || process.cwd();
    const config = getConfigManager(projectRoot).load();
    providerManager.initializeFromConfig(config.provider as any);
    toolManager.initialize(projectRoot);
    loadRegistries(getInstallRoot(), config.skills.paths);
    try {
      await runServe({ projectRoot });
    } catch (err) {
      console.error(`Serve failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  });

program
  .command("gui")
  .description("Launch the Sentinel desktop GUI (engine + glassmorphism web UI)")
  .option("--project <path>", "Project root directory")
  .action(async (opts, command) => {
    setLogLevel("warn");
    const projectRoot = command.optsWithGlobals().project || opts.project || process.cwd();
    const config = getConfigManager(projectRoot).load();
    providerManager.initializeFromConfig(config.provider as any);
    toolManager.initialize(projectRoot);
    loadRegistries(getInstallRoot(), config.skills.paths);
    await launchGui({ projectRoot, installRoot: getInstallRoot() });
  });

async function runMain(options: {
  theme: string;
  model?: string;
  agent?: string;
  verbose?: boolean;
  tui?: boolean;
  project: string;
}): Promise<void> {
  if (options.verbose) {
    setLogLevel("debug");
  }

  log.info(`Sentinel CLI v${VERSION} starting...`);

  const installRoot = getInstallRoot();
  const projectRoot = options.project;

  const configManager = getConfigManager(projectRoot);
  const config = configManager.load();

  if (options.theme) {
    themeEngine.setTheme(options.theme);
    state.set("currentTheme", options.theme);
  }

  if (options.model) {
    state.set("currentModel", options.model);
  } else {
    state.set("currentModel", config.model);
  }

  if (options.agent) {
    state.set("currentAgent", options.agent);
  } else {
    state.set("currentAgent", config.default_agent);
  }

  providerManager.initializeFromConfig(config.provider as any);

  toolManager.initialize(projectRoot);

  loadRegistries(installRoot, config.skills.paths);

  if (!options.tui) {
    log.info("Running in headless mode");
    return;
  }

  if (!process.stdin.isTTY) {
    log.error("No TTY detected. Use --no-tui for headless mode or run in a terminal.");
    process.exit(1);
  }

  // The Blessed TUI owns the screen; any stderr log line corrupts the render.
  // Silence logging once we're committed to the TUI (status is shown in-UI).
  // `--verbose` opts back into logs for debugging (accepting some corruption).
  if (!options.verbose) {
    setLogLevel("silent");
  }

  const app = new TUIApp({
    projectRoot: options.project,
    installRoot,
    initialTheme: options.theme,
  });

  app.initSessionManager();

  const cleanup = () => {
    events.emit("app:quit");
    app.destroy();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("uncaughtException", (err) => {
    log.error(`Uncaught: ${err.message}`);
  });
  process.on("unhandledRejection", (reason) => {
    log.error(`Unhandled rejection: ${reason}`);
  });

  app.start();

  await new Promise(() => {});
}

program
  .command("ink")
  .description("Preview the new Ink-based UI (work in progress)")
  .action(async () => {
    const { runInkDemo } = await import("./tui/ink/demo.js");
    runInkDemo();
  });

program.parse();
