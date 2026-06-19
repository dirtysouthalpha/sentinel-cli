/**
 * formatLoopBanner — pure startup-banner builder for the automation loop.
 *
 * Plain text (model-independent, terminal-friendly). Shows the refined goal,
 * the state-file path, the watch/stop/resume commands, and the safety budget
 * so the user knows exactly what's about to happen before the daemon commits.
 */

export interface BannerInput {
  /** The refined goal (post-refineGoal). */
  refinedGoal: string;
  /** The raw goal as the user typed it (shown if it differs from refined). */
  rawGoal?: string;
  /** Absolute path to project_state.md. */
  statePath: string;
  /** Budget knobs. */
  budget: { maxMinutes?: number; maxCostUSD?: number; maxIterations?: number };
  /** Sandbox on/off. */
  sandbox: boolean;
  /** True when resuming an existing project_state.md. */
  resuming?: boolean;
}

/** Wrap text to a width with a hanging indent (for long goals). */
function wrap(text: string, width: number, indent: string): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > width && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines.map((l, i) => (i === 0 ? l : indent + l)).join("\n");
}

export function formatLoopBanner(input: BannerInput): string {
  const { refinedGoal, rawGoal, statePath, budget, sandbox, resuming } = input;
  const W = 64;
  const ind = "           "; // align under "goal:    "

  const lines: string[] = [];
  lines.push("🔁 Sentinel loop — autonomous until 100%");
  lines.push("");
  lines.push(`  goal:     ${wrap(refinedGoal, W, ind)}`);
  if (rawGoal && rawGoal.trim() !== refinedGoal.trim() && !refinedGoal.startsWith(rawGoal.trim().slice(0, 20))) {
    lines.push(`  (you said: ${rawGoal.trim()})`);
  }
  lines.push(`  state:    ${statePath}  (gitignore this)`);
  lines.push(`  watch:    sentinel loopstatus   (or: tail -f ${statePath.split("/").pop()})`);
  lines.push(`  stop:     Ctrl+C — checkpoints cleanly; resume with: sentinel loop`);

  const budgetParts: string[] = [];
  if (budget.maxMinutes) budgetParts.push(`${budget.maxMinutes} min`);
  if (budget.maxCostUSD) budgetParts.push(`$${budget.maxCostUSD}`);
  if (budget.maxIterations) budgetParts.push(`${budget.maxIterations} iters`);
  budgetParts.push(`sandbox ${sandbox ? "ON" : "OFF"}`);
  lines.push(`  budget:   ${budgetParts.join(" · ")}`);

  lines.push("");
  lines.push(resuming
    ? `  resuming from ${statePath.split("/").pop()}…`
    : `  starting… (first iteration orients against ${statePath.split("/").pop()})`);

  return lines.join("\n");
}
