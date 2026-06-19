#!/usr/bin/env node

import { resolve } from "path";
import { join } from "path";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { TUIApp } from "./tui/app.js";
import { getConfigManager } from "./core/config.js";
import type { SentinelConfig } from "./core/types.js";
import { state } from "./core/state.js";
import { events } from "./core/events.js";
import { providerManager } from "./ai/provider.js";
import { toolManager } from "./tools/index.js";
import { runSetup } from "./commands/setup.js";
import { loadAllSkills } from "./skills/loader.js";
import { skillRegistry } from "./skills/registry.js";
import { loadAllCommands, resolveTemplate } from "./commands/loader.js";
import { commandRegistry } from "./commands/registry.js";
import { loadAllAgents } from "./agents/loader.js";
import { agentRegistry } from "./agents/registry.js";
import { themeEngine } from "./tui/themes/engine.js";
import { sessionManager } from "./core/session-manager.js";
import { contextManager } from "./ai/context.js";
import { getToolDefinitions, executeToolCall } from "./tools/tool-executor.js";
import { AgentRunner } from "./core/agent-runner.js";
import { makeCompactionSummarizer } from "./core/compaction-summarizer.js";
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
import { refineGoal } from "./core/refine-goal.js";
import { formatLoopBanner } from "./core/loop-banner.js";
import { usageTracker } from "./core/usage-tracker.js";
import { estimateCostUSD } from "./core/pricing.js";
import { writeRouterConfig, routerStartHelp, probeRouter, DEFAULT_ROUTER_URL } from "./core/router-connect.js";
import { primeEnvFromKeyring, migrateLegacyKeys, applyScrubMarker } from "./core/secrets/bootstrap.js";
import { setLogLevel, createLogger } from "./utils/logger.js";

const log = createLogger({ prefix: "cli" });

// Read version from package.json so it never drifts from the published value.
import pkg from "../package.json" with { type: "json" };
const VERSION = pkg.version;

function getInstallRoot(): string {
  // fileURLToPath handles percent-encoding (spaces) and drive-letter casing on
  // Windows — a raw `.pathname` breaks global installs under paths like
  // "C:\Users\John Doe\..." (builtins then silently fail to load).
  return resolve(fileURLToPath(new URL("..", import.meta.url)));
}

/**
 * A friendly, actionable message when a headless run has no usable provider.
 * Replaces the old one-liner that left new users guessing. Walks them through
 * the easiest paths (the guided wizard, an env var, or the keyless router).
 */
function printProviderHelp(provider: string): string {
  const envFor: Record<string, string> = {
    zai: "ZAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    gemini: "GEMINI_API_KEY",
  };
  const env = envFor[provider];
  const lines = [
    `No API key for "${provider}". Get started in 30 seconds:`,
    "",
    "  ▸ Guided wizard:   node dist/cli.js setup",
  ];
  if (env) lines.push(`  ▸ Env var:         export ${env}=<your-key>`);
  lines.push(
    "  ▸ Keyless (Claude): sentinel connect   (rides a Claude Max subscription)",
    "  ▸ All options:     sentinel setup"
  );
  return lines.join("\n");
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

/**
 * Resolve provider keys before initializeFromConfig: prime process.env from the
 * platform secret store (keyring/DPAPI/encrypted file), and run the one-time
 * migration that scrubs legacy plaintext out of config.json. Safe to call on
 * every agent-loop start — migration is idempotent, env priming skips vars
 * already set. Errors are non-fatal: env/plaintext still work as before.
 */
async function bootstrapKeys(config: SentinelConfig, projectRoot: string): Promise<void> {
  try {
    await primeEnvFromKeyring(config.provider as Record<string, unknown>);
    const scrub = await migrateLegacyKeys(config.provider as Record<string, unknown>);
    if (scrub.length > 0) {
      // Persist the scrubbed config so plaintext keys are gone for good.
      applyScrubMarker(config.provider as Record<string, unknown>, scrub);
      getConfigManager(projectRoot).save();
      log.info(`scrubbed plaintext keys for ${scrub.join(", ")} (moved to secret store)`);
    }
  } catch (err) {
    log.warn(`key bootstrap failed (continuing with env/plaintext): ${err instanceof Error ? err.message : String(err)}`);
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
    const projectRoot = process.cwd();
    const config = getConfigManager(projectRoot).load();
    // Prime provider keys from the secret store (keyring/encrypted file) before
    // init, exactly like run/autopilot/serve/gui/TUI do. Without this, keys
    // stored as `keyring://<provider>` markers are never resolved in headless
    // `ask` mode and the call fails with "API key not configured".
    await bootstrapKeys(config, projectRoot);
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
  .description("Run ONE agentic task headlessly (single pass, not a loop). Executes tools: file, bash, search, git, web, patch. For an autonomous loop until done, use 'sentinel loop' instead.")
  .option("--model <model>", "AI model to use (provider/model)")
  .option("--agent <agent>", "Agent to use (default: config default_agent)")
  .option("--max-steps <n>", "Maximum tool rounds")
  .option("--json", "Emit newline-delimited JSON events instead of text")
  .option("--project <path>", "Project root directory")
  .option("--permission-mode <mode>", "Permission mode: gated | auto | yolo (default: gated)")
  .option("--yes", "Auto-approve permission prompts (non-interactive). Equivalent to --permission-mode yolo for unattended/CI runs")
  .option("--sandbox", "Run bash commands in a bubblewrap sandbox (Linux+bwrap): FS confined to project, network blocked. Recommended for unattended runs")
  .option("--sandbox-net", "Allow network inside the sandbox (for installs/fetches); pairs with --sandbox")
  .action(async (task, opts, command) => {
    // Delegate to the shared headless runner (also backs `sentinel loop`).
    await runHeadless(task, opts, command);
  });

/**
 * Shared headless runner. Backs `sentinel run <task>` (raw prompt) and
 * `sentinel loop <goal>` (prompt wrapped in the automation-loop template).
 * One implementation: permissions, MCP, compaction, subagents, hooks, and exit
 * codes stay identical across both entry points. Extracted verbatim from the
 * former inline `run` action body.
 */
async function runHeadless(task: string, opts: any, command: any): Promise<void> {
    // Headless output should be clean — silence the INFO provider/tool/loader spam.
    // Errors and warnings stay visible. Pass --debug on the root command to override.
    if (!process.env.SENTINEL_DEBUG) setLogLevel("warn");
    // --model/--project are also defined on the root command, so commander binds
    // them to the global opts; merge so subcommand flags are honored either way.
    const merged = command.optsWithGlobals();
    const projectRoot = merged.project || opts.project || process.cwd();
    const config = getConfigManager(projectRoot).load();
    await bootstrapKeys(config, projectRoot);
    providerManager.initializeFromConfig(config.provider as any);
    toolManager.initialize(projectRoot, {
      sandbox: !!opts.sandbox,
      sandboxAllowNetwork: !!opts.sandboxNet,
    });
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
        console.error(printProviderHelp(parts[0]));
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

    // R2: enforce permissions + checkpoint mutations. Default mode is "gated"
    // (reads allowed; edits/bash/network ask) so a headless run can't silently
    // mutate the workspace or run commands without opt-in. --yes auto-approves
    // the asks (the unattended/CI path). Pass --permission-mode yolo only when
    // you explicitly want full auto-allow with no guardrails.
    const mode: PermissionMode = (opts.permissionMode as PermissionMode) || "gated";
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

    // Honor the agent's `steps` frontmatter (e.g. orchestrator=80, gsd=50)
    // instead of the hardcoded gsd?30:15. --max-steps still overrides.
    const maxRounds = opts.maxSteps ? parseInt(opts.maxSteps, 10) : agentRegistry.roundsFor(agentName);
    const runner = new AgentRunner(
      {
        provider,
        context: contextManager,
        toolDefs: [...toolDefs, subagentTool.def, todoTool.def],
        executeTool: topExecute,
        extractToolCalls,
        summarizeForCompaction: makeCompactionSummarizer(provider, modelName),
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
}

program
  .command("loop [goals...]")
  .description(
    "The easy button: refine your goal (casual input OK), then run an autonomous " +
    "PLAN -> ACT -> AUDIT -> REPEAT daemon until project_state.md reads 100%. " +
    "Bare 'sentinel loop' prompts for a goal or resumes. Sandbox ON by default. " +
    "Tip: 'sentinel run' for one task, 'sentinel autopilot' for full budget/verify knobs."
  )
  .option("--model <model>", "AI model to use (provider/model)")
  .option("--agent <agent>", "Agent to use (default: gsd)")
  .option("--max-iterations <n>", "Max loop iterations (default: 10)")
  .option("--max-stalls <n>", "Consecutive no-progress iterations before stopping (default: 2)")
  .option("--max-minutes <n>", "Stop after this many wall-clock minutes (default: 60)")
  .option("--max-cost <usd>", "Stop after this estimated spend in USD (default: 5)")
  .option("--resume", "Resume a prior interrupted run for the same goal")
  .option("--project <path>", "Project root directory")
  .option("--sandbox", "Run bash in a bubblewrap sandbox (default ON when bwrap is available)")
  .option("--no-sandbox", "Disable the sandbox even when bwrap is available")
  .option("--sandbox-net", "Allow network inside the sandbox (installs/fetches)")
  .option("--force", "Allow running in $HOME or outside a git repo (use with caution)")
  .action(async (goals, opts, command) => {
    // Headless loop output should be clean — silence the INFO spam.
    if (!process.env.SENTINEL_DEBUG) setLogLevel("warn");
    const merged = command.optsWithGlobals();
    const projectRoot = (merged.project || opts.project || process.cwd()) as string;
    const statePath = join(projectRoot, "project_state.md");
    const resuming = existsSync(statePath);

    // Safety guard: refuse to run in $HOME with no git repo unless --force.
    // An autonomous loop rewriting your home directory is almost never intended.
    const inHomeNoGit = projectRoot === homedir() && !existsSync(join(projectRoot, ".git"));
    if (inHomeNoGit && !opts.force) {
      console.error(
        `⚠  Refusing to run an autonomous loop in your home directory (${projectRoot}).\n` +
        `   This would let the agent read and edit everything you own.\n` +
        `   cd into the project you want to work on, or pass --force to override.`
      );
      process.exitCode = 1;
      return;
    }

    // Variadic: join all words into one goal sentence (so "sentinel loop fix
    // the flaky test" captures the whole sentence, not just "fix").
    const goal = Array.isArray(goals) ? goals.join(" ") : (goals as string);

    // Resolve the goal: explicit arg → resume-if-bare → interactive prompt.
    let rawGoal = goal as string | undefined;
    if (!rawGoal) {
      if (resuming) {
        rawGoal = ""; // resume — the goal lives in project_state.md
      } else if (process.stdin.isTTY) {
        // Friendly interactive prompt for first-time use.
        process.stdout.write("🔁 Sentinel loop — what do you want built?\n> ");
        rawGoal = await new Promise<string>((resolveRead) => {
          let buf = "";
          process.stdin.setEncoding("utf-8");
          process.stdin.resume();
          process.stdin.once("data", (d: string) => {
            buf = d;
            process.stdin.pause();
            resolveRead(buf);
          });
        });
      } else {
        // Non-interactive (piped stdin / CI) with no goal and no state file.
        console.error("No goal provided and no project_state.md to resume. Pass a goal: sentinel loop \"<your goal>\"");
        process.exitCode = 1;
        return;
      }
    }

    // Refine casual input into a well-structured goal (pure, model-independent).
    const { refined, raw } = refineGoal(rawGoal || "");
    const commands = loadAllCommands(projectRoot);
    const tmpl = commands.find((c) => c.name === "automationloop");
    // The loop daemon's per-iteration task: the automationloop template enforces
    // ORIENT->SCAN->PLAN->ACT->AUDIT->REPEAT against project_state.md. Inject the
    // refined goal as $ARGUMENTS so every iteration re-orients toward it.
    const loopGoal = tmpl
      ? resolveTemplate(tmpl.template, [refined])
      : `AUTONOMOUS CODING LOOP\n\nGOAL: ${refined}\n\nRun a continuous PLAN -> ACT -> AUDIT -> REPEAT loop, maintaining project_state.md as your brain, until the goal is 100% complete.`;

    // --- boot provider/tools/config (same as autopilot) ---
    const config = getConfigManager(projectRoot).load();
    await bootstrapKeys(config, projectRoot);
    providerManager.initializeFromConfig(config.provider as any);
    const useSandbox = opts.sandbox === true || (opts.sandbox === undefined && opts.noSandbox !== true);
    toolManager.initialize(projectRoot, { sandbox: useSandbox, sandboxAllowNetwork: !!opts.sandboxNet });
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
        console.error(printProviderHelp(parts[0]));
        process.exitCode = 1;
        return;
      }
      provider = single;
    }

    const mcp = new MCPManager();
    await mcp.connect((config.mcp as any) || {});
    const toolDefs = [...getToolDefinitions(), ...mcp.getToolDefs()];
    const mcpAware = createMcpAwareExecutor(mcp, executeToolCall);
    // Loop is unattended => yolo (checkpoints still snapshot edits). Use --gated
    // semantics via autopilot's engine if you want per-mutation asks instead.
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
    const maxMinutes = opts.maxMinutes ? parseFloat(opts.maxMinutes) : (ap.maxMinutes ?? 60);
    const maxCostUSD = opts.maxCost ? parseFloat(opts.maxCost) : (ap.maxCostUSD ?? 5);

    // Print the friendly banner so the user knows what's happening.
    console.log(formatLoopBanner({
      refinedGoal: refined,
      rawGoal: raw,
      statePath,
      budget: { maxMinutes, maxCostUSD, maxIterations },
      sandbox: useSandbox,
      resuming,
    }));

    const ac = new AbortController();
    process.once("SIGINT", () => {
      console.error("\n[loop] stopping after the current step… (resume with: sentinel loop)");
      ac.abort();
    });

    let result;
    try {
      result = await runAutopilotSession({
        goal: loopGoal,
        projectRoot,
        maxIterations,
        maxStalls,
        verifyCommands: ap.verifyCommands,
        maxMinutes,
        maxCostUSD,
        costSpent: () => usageTracker.snapshot().estimatedCostUSD,
        resume: !!opts.resume || resuming,
        runSubagent: (args, sig) => subagentTool.execute(args, sig),
        signal: ac.signal,
        log: (m) => console.log(m),
      });
    } finally {
      await mcp.disconnect();
    }
    const statusLabel: Record<string, string> = {
      production_ready: "complete — goal achieved",
      max_iterations: "stopped — max iterations reached",
      stalled: "stopped — stalled (no progress)",
      aborted: "aborted",
      budget_exhausted: "stopped — budget exhausted",
    };
    console.log(`\n[loop] ${statusLabel[result.status] ?? result.status} (${result.iterations} iterations)`);
    process.exitCode = result.status === "production_ready" ? 0 : result.status === "aborted" ? 130 : 1;
  });

program
  .command("loopstatus")
  .description("Read and pretty-print project_state.md — check automation-loop progress at a glance, read-only. Works in a second terminal while the loop runs.")
  .option("--project <path>", "Project root directory")
  .action((opts, command) => {
    const projectRoot = (command.optsWithGlobals().project || opts.project || process.cwd()) as string;
    const statePath = join(projectRoot, "project_state.md");
    if (!existsSync(statePath)) {
      console.log(`No project_state.md at ${statePath}. Run 'sentinel loop "<goal>"' to start an automation loop.`);
      return;
    }
    const text = readFileSync(statePath, "utf-8");
    const goal = text.match(/##?\s*GOAL\s*\n([\s\S]*?)(?:\n##|\n$|$)/i)?.[1]?.trim() || "(unknown)";
    const phase = text.match(/##?\s*PHASE\s*\n([\s\S]*?)(?:\n##|\n$|$)/i)?.[1]?.trim() || "(unknown)";
    const progressMatch = text.match(/##?\s*OVERALL PROGRESS\s*\n.*?(\d+)\s*%/is)?.[1];
    const pct = progressMatch ? parseInt(progressMatch, 10) : 0;
    const completed = (text.match(/\[x\]/gi) || []).length;
    const inProgressMatch = text.match(/##?\s*IN PROGRESS\s*\n\s*-?\s*\[.\]\s*(.+)$/im);
    const inProgress = inProgressMatch?.[1]?.trim() || "(none)";
    // Queue items, excluding the in-progress task so it doesn't show twice.
    const queueItems = [...text.matchAll(/^\s*-\s*\[\s\]\s*(.+)$/gm)]
      .map((m) => m[1].trim())
      .filter((q) => q !== inProgress)
      .slice(0, 3);
    const blockers = [...text.matchAll(/(?:^|\n)\s*-\s*(\[FIXED\].*|\w[^\n]*(?:error|fail|broken|missing)[^\n]*)/gi)].map((m) => m[1].trim());

    const filled = Math.round(pct / 10);
    const bar = "█".repeat(filled) + "░".repeat(10 - filled);
    console.log("");
    console.log(`  Goal:      ${goal}`);
    console.log(`  Phase:     ${phase}`);
    console.log(`  Progress:  [${bar}] ${pct}%`);
    console.log(`  In progress: ${inProgress}`);
    console.log(`  Up next:   ${queueItems.length ? queueItems.map((q) => `• ${q}`).join("  ") : "(queue empty)"}`);
    console.log(`  Blockers:  ${blockers.length ? blockers.map((b) => `! ${b}`).join("  ") : "none"}`);
    console.log(`  Done:      ${completed} task${completed === 1 ? "" : "s"} complete`);
    console.log("");
  });

program
  .command("autopilot <goal>")
  .description("Advanced autonomous driver — same engine as 'sentinel loop' but with full control over verify gates, budgets, and stall detection. Use 'sentinel loop' for the easy default; this is the power-user path.")
  .option("--model <model>", "AI model to use (provider/model)")
  .option("--agent <agent>", "Agent to use (default: gsd)")
  .option("--project <path>", "Project root directory")
  .option("--max-iterations <n>", "Max autopilot iterations")
  .option("--max-stalls <n>", "Consecutive no-change iterations before stopping")
  .option("--max-minutes <n>", "Stop after this many wall-clock minutes")
  .option("--max-cost <usd>", "Stop after this estimated spend (USD)")
  .option("--resume", "Resume a prior interrupted run for the same goal")
  .option("--sandbox", "Run bash in a bubblewrap sandbox (FS confined to project, network blocked). Default ON for autopilot when bwrap is available")
  .option("--no-sandbox", "Disable the autopilot sandbox even when bwrap is available")
  .option("--sandbox-net", "Allow network inside the sandbox (installs/fetches)")
  .action(async (goal, opts, command) => {
    const merged = command.optsWithGlobals();
    const projectRoot = merged.project || opts.project || process.cwd();
    const config = getConfigManager(projectRoot).load();
    await bootstrapKeys(config, projectRoot);
    providerManager.initializeFromConfig(config.provider as any);
    // Autopilot is the unattended path — sandbox by default when bwrap is
    // present, unless --no-sandbox is passed. --sandbox forces it on explicitly.
    const useSandbox = opts.sandbox === true || (opts.sandbox === undefined && opts.noSandbox !== true);
    toolManager.initialize(projectRoot, {
      sandbox: useSandbox,
      sandboxAllowNetwork: !!opts.sandboxNet,
    });
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
        console.error(printProviderHelp(parts[0]));
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
    await bootstrapKeys(config, projectRoot);
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
  .option("--window", "Open in a borderless app window (Chrome --app) instead of a browser tab")
  .action(async (opts, command) => {
    setLogLevel("warn");
    const projectRoot = command.optsWithGlobals().project || opts.project || process.cwd();
    const config = getConfigManager(projectRoot).load();
    await bootstrapKeys(config, projectRoot);
    providerManager.initializeFromConfig(config.provider as any);
    toolManager.initialize(projectRoot);
    loadRegistries(getInstallRoot(), config.skills.paths);
    await launchGui({ projectRoot, installRoot: getInstallRoot(), windowed: !!opts.window });
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

  await bootstrapKeys(config, projectRoot);
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
