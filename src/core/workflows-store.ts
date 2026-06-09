import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { createLogger } from "../utils/logger.js";

const log = createLogger({ prefix: "workflows" });

/** A saved, parameterized workflow: an ordered list of step prompts. */
export interface Workflow {
  name: string;
  description?: string;
  steps: string[];
  params?: string[];
}

function workflowsDir(projectRoot: string): string {
  return join(projectRoot, ".sentinel", "workflows");
}

/** Sanitize a workflow name into a safe filename stem. */
function safeName(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9._-]/g, "-");
}

/** Persist a workflow to `<projectRoot>/.sentinel/workflows/<name>.json`. Creates the dir if missing. */
export function saveWorkflow(projectRoot: string, wf: Workflow): void {
  const dir = workflowsDir(projectRoot);
  try {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${safeName(wf.name)}.json`);
    writeFileSync(file, JSON.stringify(wf, null, 2), "utf-8");
  } catch (err) {
    log.warn(`Failed to save workflow "${wf.name}": ${err}`);
    throw err;
  }
}

/** List all workflows in a project. Never throws — returns [] on any read error. */
export function listWorkflows(projectRoot: string): Workflow[] {
  const dir = workflowsDir(projectRoot);
  if (!existsSync(dir)) return [];
  const workflows: Workflow[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const wf = JSON.parse(readFileSync(join(dir, entry.name), "utf-8")) as Workflow;
        if (wf && typeof wf.name === "string" && Array.isArray(wf.steps)) workflows.push(wf);
      } catch (err) {
        log.warn(`Skipping invalid workflow file ${entry.name}: ${err}`);
      }
    }
  } catch (err) {
    log.warn(`Failed to list workflows: ${err}`);
    return [];
  }
  return workflows;
}

/** Get a single workflow by name, or undefined if not found / unreadable. Never throws. */
export function getWorkflow(projectRoot: string, name: string): Workflow | undefined {
  const file = join(workflowsDir(projectRoot), `${safeName(name)}.json`);
  if (!existsSync(file)) return undefined;
  try {
    const wf = JSON.parse(readFileSync(file, "utf-8")) as Workflow;
    if (wf && typeof wf.name === "string" && Array.isArray(wf.steps)) return wf;
    return undefined;
  } catch (err) {
    log.warn(`Failed to read workflow "${name}": ${err}`);
    return undefined;
  }
}

/** Delete a workflow. Returns true if it existed and was removed. Never throws. */
export function deleteWorkflow(projectRoot: string, name: string): boolean {
  const file = join(workflowsDir(projectRoot), `${safeName(name)}.json`);
  if (!existsSync(file)) return false;
  try {
    rmSync(file);
    return true;
  } catch (err) {
    log.warn(`Failed to delete workflow "${name}": ${err}`);
    return false;
  }
}

/**
 * Substitute `$1,$2,...` and `$ARGUMENTS` in each step.
 * Mirrors src/commands/loader.ts resolveTemplate semantics.
 */
export function renderSteps(wf: Workflow, args: string[]): string[] {
  return wf.steps.map((step) => {
    let result = step;
    result = result.replace(/\$ARGUMENTS/g, args.join(" "));
    args.forEach((arg, i) => {
      result = result.replace(new RegExp(`\\$${i + 1}`, "g"), arg);
    });
    return result;
  });
}
