#!/usr/bin/env node

import { Command } from "commander";
import { TUIApp } from "./tui/app.js";
import { getConfigManager } from "./core/config.js";
import { state } from "./core/state.js";
import { events } from "./core/events.js";
import { providerManager } from "./ai/provider.js";
import { toolManager } from "./tools/index.js";
import { runSetup } from "./commands/setup.js";
import { themeEngine } from "./tui/themes/engine.js";
import { skillRegistry } from "./skills/registry.js";
import { agentRegistry } from "./agents/registry.js";
import { ProviderError } from "./ai/errors.js";
import { runMcpServer } from "./mcp/server.js";
import { launchGui } from "./server/gui-launcher.js";
import { runServe } from "./server/serve.js";
import { MCPManager } from "./mcp/manager.js";
import { CheckpointManager } from "./core/checkpoints.js";
import { getInstallRoot, loadRegistries } from "./core/bootstrap.js";
import { runHeadless } from "./core/headless.js";
import { EXIT_CODES, EXIT_CODE_HELP } from "./core/exit-codes.js";
import { VERSION } from "./core/version.js";
import type { PermissionMode } from "./core/permissions.js";
import { setLogLevel, createLogger } from "./utils/logger.js";

const log = createLogger({ prefix: "cli" });

/** Read piped stdin to end (for bare `sentinel -p`). */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").trim();
}


const program = new Command();

program
  .name("sentinel")
  .description("AI-powered coding CLI - The best coding CLI on the planet")
  .version(VERSION)
  .option("--theme <theme>", "Set theme", "opencode")
  .option("--model <model>", "Set AI model")
  .option("--agent <agent>", "Set default agent")
  .option("-p, --print [prompt]", "Non-interactive: run one task headlessly and exit (reads piped stdin when no prompt is given)")
  .option("--output-format <fmt>", "With -p: text | json | stream-json (json = NDJSON stream)")
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
  .description("Ask a question (headless, one-shot; use 'run' for agentic tool execution)")
  .option("--model <model>", "AI model to use")
  .action(async (question, _opts, command) => {
    const config = getConfigManager().load();
    providerManager.initializeFromConfig(config.provider as any, { sentinelProxy: config.sentinelProxy, headroom: config.headroom });
    // --model is also defined on the root command, so commander binds it to the
    // global opts; merge both so the subcommand override is honored either way.
    const merged = command.optsWithGlobals();
    const model = merged.model || config.model;
    const [providerName, ...modelParts] = model.split("/");
    const modelName = modelParts.join("/") || undefined;

    console.log(`\nAsking ${model}...\n`);

    try {
      let output = "";
      await providerManager.chatStream(
        providerName,
        [{ role: "user", content: question }],
        { model: modelName },
        (chunk) => {
          if (chunk.content) {
            process.stdout.write(chunk.content);
            output += chunk.content;
          }
        }
      );
      if (!output.endsWith("\n")) console.log();
    } catch (err) {
      if (err instanceof ProviderError && err.status === 429) {
        console.error(`\nRate limited on ${model}.`);
        const fallback = config.small_model && config.small_model !== model ? config.small_model : undefined;
        if (fallback) console.error(`  Try: node dist/cli.js ask --model ${fallback} "..."`);
      } else {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
      }
      // Headless one-shot must fail loudly in CI: auth/config problems are
      // CONFIG_ERROR; everything else (rate limit, provider, network) AGENT_ERROR.
      process.exitCode =
        err instanceof ProviderError && (err.status === 401 || err.status === 403)
          ? EXIT_CODES.CONFIG_ERROR
          : EXIT_CODES.AGENT_ERROR;
    }
  });

program
  .command("run <task>")
  .description("Run an agentic task headlessly — executes tools (file, bash, search, git, web, patch)")
  .option("--model <model>", "AI model to use (provider/model)")
  .option("--agent <agent>", "Agent to use (default: config default_agent)")
  .option("--max-steps <n>", "Maximum tool rounds")
  .addHelpText(
    "after",
    "\nExit codes:\n" + EXIT_CODE_HELP.map(([code, meaning]) => `  ${String(code).padEnd(5)} ${meaning}`).join("\n")
  )
  .option("--json", "Emit newline-delimited JSON events instead of text")
  .option("--output-format <fmt>", "Output format: text | json | stream-json (json = NDJSON stream)")
  .option("--quiet", "Only emit the final result (text or JSON --json)")
  .option("--project <path>", "Project root directory")
  .option("--permission-mode <mode>", "Permission mode: yolo | auto | gated (default: yolo)")
  .option("--yes", "Auto-approve permission prompts (non-interactive)")
  .action(async (task, opts, command) => {
    // --model/--project are also defined on the root command, so commander binds
    // them to the global opts; merge so subcommand flags are honored either way.
    const merged = command.optsWithGlobals();
    const fmt = (opts.outputFormat || (opts.json ? "json" : "text")).toLowerCase();
    const json = fmt === "json" || fmt === "stream-json";
    const outcome = await runHeadless({
      task,
      projectRoot: merged.project || opts.project || process.cwd(),
      model: merged.model || opts.model,
      agent: opts.agent,
      maxSteps: opts.maxSteps ? parseInt(opts.maxSteps, 10) : undefined,
      json,
      quiet: !!opts.quiet,
      permissionMode: opts.permissionMode as PermissionMode | undefined,
      autoApprove: !!opts.yes,
      installRoot: getInstallRoot(),
    });
    if (outcome.configError) console.error(outcome.configError);
    // Let the event loop drain (don't process.exit() — on Windows that can
    // tear down a still-flushing piped stdout and crash libuv).
    process.exitCode = outcome.exitCode;
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
    providerManager.initializeFromConfig(config.provider as any, { sentinelProxy: config.sentinelProxy, headroom: config.headroom });
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
    providerManager.initializeFromConfig(config.provider as any, { sentinelProxy: config.sentinelProxy, headroom: config.headroom });
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
  print?: string | boolean;
  outputFormat?: string;
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

  providerManager.initializeFromConfig(config.provider as any, { sentinelProxy: config.sentinelProxy, headroom: config.headroom });

  toolManager.initialize(projectRoot);

  // -p / --print: one-shot non-interactive agentic run (prompt arg or piped
  // stdin), then exit. Never touches the TUI, safe with no TTY.
  if (options.print !== undefined) {
    const task =
      typeof options.print === "string" && options.print.trim().length > 0
        ? options.print
        : await readStdin();
    if (!task) {
      console.error("--print needs a prompt argument or a task piped on stdin.");
      process.exitCode = EXIT_CODES.CONFIG_ERROR;
      return;
    }
    const fmt = (options.outputFormat || "text").toLowerCase();
    const outcome = await runHeadless({
      task,
      projectRoot,
      model: options.model,
      agent: options.agent,
      json: fmt === "json" || fmt === "stream-json",
      installRoot,
    });
    if (outcome.configError) console.error(outcome.configError);
    process.exitCode = outcome.exitCode;
    return;
  }

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

program.parse();
