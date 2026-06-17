import { writeFileSync } from "node:fs";
import { join, isAbsolute, resolve } from "node:path";
import { sessionManager } from "../../core/session-manager.js";
import { exportSessionMarkdown, exportSessionHtml } from "../../core/session-export.js";
import type { CommandHost } from "./types.js";

/** /export [md|html] [path] — write the active session's transcript to a file. */
export function handleExportCommand(host: CommandHost, args: string[]): void {
  // Parse args: format (md|html|markdown) and/or an output path, in any order.
  let format: "md" | "html" = "md";
  let outPath: string | undefined;
  for (const arg of args) {
    const lower = arg.toLowerCase();
    if (lower === "md" || lower === "markdown") {
      format = "md";
    } else if (lower === "html" || lower === "htm") {
      format = "html";
    } else {
      outPath = arg;
    }
  }

  const session = sessionManager.getActiveSession();
  if (!session) {
    host.addSystem("No active session to export.");
    return;
  }

  const messages = session.contextManager
    .getMessages()
    .map((m) => ({ role: m.role, content: m.content }));

  if (messages.length === 0) {
    host.addSystem("Nothing to export — this session has no messages yet.");
    return;
  }

  const title = session.title || "Sentinel Session";
  const ext = format === "html" ? "html" : "md";
  const content =
    format === "html"
      ? exportSessionHtml({ title, messages })
      : exportSessionMarkdown({ title, messages });

  const defaultName = `sentinel-export-${session.id.slice(0, 8)}.${ext}`;
  const target = outPath
    ? isAbsolute(outPath)
      ? outPath
      : resolve(host.projectRoot, outPath)
    : join(host.projectRoot, defaultName);

  try {
    writeFileSync(target, content, "utf8");
    host.addSystem(`Exported ${messages.length} messages to ${target}`);
  } catch (err) {
    host.addSystem(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** /branch — duplicate the active session (and its context) into a new tab. */
export function handleBranchCommand(host: CommandHost): void {
  const source = sessionManager.getActiveSession();
  if (!source) {
    host.addSystem("No active session to branch.");
    return;
  }

  // Create a new session/tab, then copy the source's conversation into it so
  // the branch starts as an independent duplicate of the current context.
  const branch = sessionManager.createSession({
    projectRoot: host.projectRoot,
    title: `${source.title} (branch)`,
    model: source.model,
    agent: source.agent,
  });

  const srcCm = source.contextManager;
  const dstCm = branch.contextManager;
  const sysPrompt = srcCm.getSystemPrompt();
  if (sysPrompt) dstCm.setSystemPrompt(sysPrompt);
  for (const m of srcCm.getMessages()) {
    if (m.role === "system") continue; // re-derived from the system prompt
    dstCm.addMessage(m.role as "user" | "assistant" | "tool", m.content, m.metadata);
  }
  sessionManager.markDirty(branch.id);

  // Switch the UI to the new branch tab and replay its transcript.
  host.tabManager.refresh();
  host.tabManager.switchTab(branch.id);
  host.addSystem(`Branched into a new tab: "${branch.title}" (${srcCm.getMessageCount()} messages copied).`);
}
