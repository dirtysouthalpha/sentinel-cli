import type { CommandHost } from "./types.js";
import { usageTracker } from "../../core/usage-tracker.js";
import { buildAbout } from "../../core/about.js";
import { providerManager } from "../../ai/provider.js";
import { themeEngine } from "../themes/engine.js";
import { state } from "../../core/state.js";
import { skillRegistry } from "../../skills/registry.js";
import { agentRegistry } from "../../agents/registry.js";
import { commandRegistry } from "../../commands/registry.js";
import { CheckpointManager } from "../../core/checkpoints.js";
import { estimateCostUSD } from "../../core/pricing.js";

const VERSION = "1.2.0";

/**
 * Extracted read-only/info slash-command handlers (Phase 3b). Each is a free
 * function taking a CommandHost + args, so it's unit-testable with a fake host
 * — no blessed/screen dependency. Behavior + output strings are byte-identical
 * to the inlined handlers they replace in app.ts's handleCommand dispatcher.
 */

/** /cost — session cost breakdown. */
export function handleCost(host: CommandHost, _args: string[]): void {
  const cost = host.getCost?.() ?? {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    requests: 0,
    estimatedCostUSD: 0,
  };
  host.addSystem(
    [
      "Session cost:",
      `  Prompt:     ${cost.promptTokens.toLocaleString()} tokens`,
      `  Completion: ${cost.completionTokens.toLocaleString()} tokens`,
      `  Total:      ${cost.totalTokens.toLocaleString()} tokens`,
      `  Requests:   ${cost.requests}`,
      `  Est. cost:  $${cost.estimatedCostUSD.toFixed(4)}`,
    ].join("\n")
  );
}

/** /usage — cumulative usage across sessions. */
export function handleUsage(host: CommandHost, _args: string[]): void {
  host.addSystem(usageTracker.render());
}

/** /about — version + provider info. */
export function handleAbout(host: CommandHost, _args: string[]): void {
  host.addSystem(buildAbout(VERSION));
}

/** /context — active context stats. */
export function handleContext(host: CommandHost, _args: string[]): void {
  const ctx = host.getContext?.();
  if (!ctx) {
    host.addSystem("Context: unavailable.");
    return;
  }
  const totalChars = ctx.getCharTotal();
  host.addSystem(
    [
      "Context:",
      `  Messages: ${ctx.getMessageCount()}`,
      `  Size: ~${Math.ceil(totalChars / 4)} tokens`,
      "  Auto-compacts as it fills.",
    ].join("\n")
  );
}

/** /compact — force a context compaction now. */
export function handleCompact(host: CommandHost, _args: string[]): void {
  const ctx = host.getContext?.();
  if (!ctx) {
    host.addError("No active context to compact.");
    return;
  }
  const before = ctx.getMessageCount();
  ctx.compact();
  const after = ctx.getMessageCount();
  host.addSystem(`Compacted: ${before} → ${after} messages.`);
  host.markSessionDirty?.();
}

/** /clear — wipe context + transcript + cost (UI reset is the caller's job). */
export function handleClear(host: CommandHost, _args: string[]): void {
  host.getContext?.().clear();
  host.resetCost?.();
  host.requestRender?.();
}

/** /setup — provider-connection help. */
export function handleSetupHelp(host: CommandHost, _args: string[]): void {
  host.addSystem(
    [
      "Connect an AI provider:",
      "  Wizard:  run  node dist/cli.js setup  in a terminal",
      "  Env var: set ZAI_API_KEY=your-key  (or ANTHROPIC_API_KEY / OPENAI_API_KEY)",
      "  Config:  add a provider block to sentinel.json",
      "  Then switch with:  /model zai/glm-4.6",
    ].join("\n")
  );
}

/** /providers — list configured providers + availability. */
export function handleProviders(host: CommandHost, _args: string[]): void {
  const available = providerManager.getAvailableProviderNames();
  const names = providerManager.getAllProviderNames();
  if (names.length === 0) {
    host.addSystem("Providers: none configured. Run `sentinel setup`.");
    return;
  }
  let msg = "Providers:\n";
  for (const name of names) {
    msg += `  ${name.padEnd(12)} ${available.includes(name) ? "ok" : "no key"}\n`;
  }
  host.addSystem(msg.trimEnd());
}

/** /agents — list registered agents. */
export function handleAgents(host: CommandHost, _args: string[]): void {
  const agents = agentRegistry.getAll();
  if (agents.length === 0) {
    host.addSystem("No agents loaded.");
    return;
  }
  let list = "Agents:\n";
  for (const a of agents) {
    const cur = a.name === state.get("currentAgent") ? "  ←" : "";
    list += `  ${a.name.padEnd(12)} ${a.description}${cur}\n`;
  }
  host.addSystem(list.trimEnd());
}

/** /skills — list loaded skills. */
export function handleSkills(host: CommandHost, _args: string[]): void {
  const skills = skillRegistry.getAll();
  if (skills.length === 0) {
    host.addSystem("No skills loaded.");
    return;
  }
  let list = "Skills:\n";
  for (const s of skills) {
    list += `  ${s.name.padEnd(16)} ${s.description} [${s.source}]\n`;
  }
  host.addSystem(list.trimEnd());
}

/** /theme [name] — list or set the theme. */
export function handleTheme(host: CommandHost, args: string[]): void {
  const name = args[0];
  if (!name) {
    let list = "Themes:\n";
    for (const t of themeEngine.getAllThemes()) {
      const cur = t.name === themeEngine.getTheme().name ? "  ←" : "";
      list += `  ${t.name.padEnd(12)} ${t.display}${cur}\n`;
    }
    host.addSystem(list.trimEnd());
    return;
  }
  if (themeEngine.setTheme(name)) {
    state.set("currentTheme", name);
    host.addSystem(`Theme → ${themeEngine.getTheme().display}`);
  } else {
    host.addError(`Unknown theme: ${name}`);
  }
}

/** /permissions [mode] — show or set the permission mode. */
export function handlePermissions(host: CommandHost, args: string[]): void {
  const mode = args[0];
  const current = host.getPermissionMode?.() ?? "gated";
  if (!mode) {
    host.addSystem(`Permission mode: ${current}  (yolo | auto | gated | plan)`);
    return;
  }
  if (mode === "yolo" || mode === "auto" || mode === "gated" || mode === "plan") {
    host.setPermissionMode?.(mode);
    host.addSystem(`Permission mode → ${mode}`);
  } else {
    host.addError(`Unknown mode: ${mode}. Use yolo | auto | gated | plan.`);
  }
}

/** /plan [off] — toggle read-only plan mode. */
export function handlePlan(host: CommandHost, args: string[]): void {
  if (args[0] === "off") {
    host.setPermissionMode?.("yolo");
    host.addSystem("Plan mode off → yolo. Edits/commands re-enabled.");
  } else {
    host.setPermissionMode?.("plan");
    host.addSystem(
      "Plan mode on (read-only). I'll research and propose a plan; edits/commands are blocked until you `/plan off`."
    );
  }
}

/** /checkpoints — list file checkpoints the agent made. */
export function handleCheckpoints(host: CommandHost, _args: string[]): void {
  const cps = new CheckpointManager(host.projectRoot).list();
  if (cps.length === 0) {
    host.addSystem("No checkpoints yet. They're created when the agent edits files.");
    return;
  }
  let msg = `Checkpoints (${cps.length}, newest last):\n`;
  for (const c of cps) {
    msg += `  ${c.id}  ${c.tool.padEnd(6)} ${c.existed ? "edit  " : "create"}  ${c.path}\n`;
  }
  host.addSystem(msg.trimEnd());
}

/** /undo — revert the most recent agent file change. */
export function handleUndo(host: CommandHost, _args: string[]): void {
  const cp = new CheckpointManager(host.projectRoot).undoLast();
  if (!cp) {
    host.addSystem("Nothing to undo.");
    return;
  }
  host.addSystem(`Undid ${cp.tool} ${cp.existed ? "edit" : "create"} of ${cp.path}`);
}
