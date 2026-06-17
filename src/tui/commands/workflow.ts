import {
  saveWorkflow,
  listWorkflows,
  getWorkflow,
  deleteWorkflow,
  renderSteps,
} from "../../core/workflows-store.js";
import type { CommandHost } from "./types.js";

/** /workflow — saved, parameterized workflows (Warp Drive): list | save | run | delete. */
export async function handleWorkflowCommand(host: CommandHost, args: string[]): Promise<void> {
  const sub = (args[0] || "").toLowerCase();

  if (!sub || sub === "list") {
    const wfs = listWorkflows(host.projectRoot);
    if (wfs.length === 0) {
      host.addSystem(
        "No workflows yet. Save one with:\n  /workflow save <name> <step1> ; <step2> ..."
      );
      return;
    }
    let msg = `Workflows (${wfs.length}):\n`;
    for (const wf of wfs) {
      const desc = wf.description ? ` — ${wf.description}` : "";
      msg += `  ${wf.name.padEnd(16)} ${wf.steps.length} step(s)${desc}\n`;
    }
    host.addSystem(msg.trimEnd());
    return;
  }

  if (sub === "save") {
    const name = args[1];
    if (!name) {
      host.addSystem("Usage: /workflow save <name> <step1> ; <step2> ...");
      return;
    }
    const rest = args.slice(2).join(" ").trim();
    const steps = rest
      .split(" ; ")
      .map((s) => s.trim())
      .filter(Boolean);
    if (steps.length === 0) {
      host.addSystem("Usage: /workflow save <name> <step1> ; <step2> ...");
      return;
    }
    try {
      saveWorkflow(host.projectRoot, { name, steps });
      host.addSystem(`Saved workflow "${name}" (${steps.length} step(s)).`);
    } catch (err) {
      host.addError(
        `Failed to save workflow: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return;
  }

  if (sub === "delete") {
    const name = args[1];
    if (!name) {
      host.addSystem("Usage: /workflow delete <name>");
      return;
    }
    host.addSystem(
      deleteWorkflow(host.projectRoot, name)
        ? `Deleted workflow "${name}".`
        : `No workflow named "${name}".`
    );
    return;
  }

  if (sub === "run") {
    const name = args[1];
    if (!name) {
      host.addSystem("Usage: /workflow run <name> [args...]");
      return;
    }
    const wf = getWorkflow(host.projectRoot, name);
    if (!wf) {
      host.addError(`No workflow named "${name}". Try /workflow list`);
      return;
    }
    const rendered = renderSteps(wf, args.slice(2));
    const composed =
      "Execute this workflow:\n" +
      rendered.map((step, i) => `${i + 1}. ${step}`).join("\n");
    host.addSystem(`▶ Running workflow "${name}" (${rendered.length} step(s))...`);
    await host.chatWithAI(composed);
    return;
  }

  host.addSystem(
    "Usage: /workflow list  ·  /workflow save <name> <step1> ; <step2> ...  ·  /workflow run <name> [args...]  ·  /workflow delete <name>"
  );
}
