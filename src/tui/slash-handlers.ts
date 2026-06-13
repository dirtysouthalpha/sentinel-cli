/**
 * Leaf slash-command handlers extracted from app.ts to keep the TUI orchestrator
 * focused. Each handler is a pure function over a small SlashHandlerContext rather
 * than a method on TUIApp, so it can be unit-tested without constructing the TUI.
 */
import { writeFileSync } from "node:fs";
import { join, isAbsolute, resolve } from "node:path";
import { sessionManager } from "../core/session-manager.js";
import { WorkspaceStore } from "../core/workspace.js";
import { TeamStore } from "../core/team.js";
import { exportSessionMarkdown, exportSessionHtml } from "../core/session-export.js";
import { TabManager } from "./tab-manager.js";

/** The slice of TUIApp the leaf handlers need. Built by app.ts via slashCtx(). */
export interface SlashHandlerContext {
  projectRoot: string;
  addSystem(text: string): void;
  addError(text: string): void;
  tabManager: TabManager;
  createNewTab(): void;
  onTabClose(sessionId: string): void;
}

export function handleWorkspaceCommand(ctx: SlashHandlerContext, args: string[]): void {
  const sub = (args[0] || "list").toLowerCase();
  let store: WorkspaceStore;
  try {
    store = new WorkspaceStore();
  } catch (err) {
    ctx.addError(`Workspace error: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (sub === "list") {
    const roots = store.listRoots();
    const active = store.getActive();
    if (roots.length === 0) {
      ctx.addSystem(
        "No workspace roots yet. Add one with /workspace add [path] (defaults to this project)."
      );
      return;
    }
    let msg = "Workspace roots:\n";
    for (const r of roots) msg += `  ${r === active ? "→" : " "} ${r}\n`;
    ctx.addSystem(msg.trimEnd());
    return;
  }

  if (sub === "add") {
    const path = args.slice(1).join(" ").trim() || ctx.projectRoot;
    try {
      const root = store.addRoot(path);
      ctx.addSystem(`Added workspace root: ${root}`);
    } catch (err) {
      ctx.addError(`Failed to add root: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (sub === "remove" || sub === "rm") {
    const path = args.slice(1).join(" ").trim();
    if (!path) {
      ctx.addSystem("Usage: /workspace remove <path>");
      return;
    }
    const removed = store.removeRoot(path);
    ctx.addSystem(removed ? `Removed workspace root: ${path}` : `Not a tracked root: ${path}`);
    return;
  }

  if (sub === "use") {
    const path = args.slice(1).join(" ").trim();
    if (!path) {
      ctx.addSystem("Usage: /workspace use <path>");
      return;
    }
    try {
      const root = store.setActive(path);
      ctx.addSystem(
        `Active workspace root → ${root}\nThis affects the next session / new tab — your current session keeps its project root.`
      );
    } catch (err) {
      ctx.addError(`Failed to set active root: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  ctx.addSystem(
    "Usage: /workspace <list | add [path] | remove <path> | use <path>>  (alias: /ws)"
  );
}

/**
 * /team — a shared team manifest (V10): a team name, a shared extension
 * registry, and a roster of members. The registry URL doubles as a
 * /marketplace source so the whole team installs the same skills/MCP servers.
 * Subcommands: info (default) | name <n> | registry <url> | add <member> | remove <member>.
 */
export function handleTeamCommand(ctx: SlashHandlerContext, args: string[]): void {
  const sub = (args[0] || "info").toLowerCase();
  let store: TeamStore;
  try {
    store = new TeamStore();
  } catch (err) {
    ctx.addError(`Team error: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (sub === "info") {
    const team = store.get();
    let msg = "Team:\n";
    msg += `  name:     ${team.name || "(unset)"}\n`;
    msg += `  registry: ${team.registry || "(unset)"}\n`;
    const members = team.members || [];
    if (members.length === 0) {
      msg += "  members:  (none) — add with /team add <member>";
    } else {
      msg += `  members:  ${members.length}\n`;
      for (const m of members) msg += `    - ${m}\n`;
      msg = msg.trimEnd();
    }
    ctx.addSystem(msg);
    return;
  }

  if (sub === "name") {
    const name = args.slice(1).join(" ").trim();
    if (!name) {
      ctx.addSystem("Usage: /team name <name>");
      return;
    }
    try {
      store.setName(name);
      ctx.addSystem(`Team name → ${name}`);
    } catch (err) {
      ctx.addError(`Failed to set team name: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (sub === "registry") {
    const url = args.slice(1).join(" ").trim();
    if (!url) {
      ctx.addSystem("Usage: /team registry <url>");
      return;
    }
    try {
      store.setRegistry(url);
      ctx.addSystem(
        `Team registry → ${url}\nUse it as a /marketplace source, e.g. /marketplace list ${url}`
      );
    } catch (err) {
      ctx.addError(`Failed to set team registry: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (sub === "add") {
    const member = args.slice(1).join(" ").trim();
    if (!member) {
      ctx.addSystem("Usage: /team add <member>");
      return;
    }
    try {
      store.addMember(member);
      ctx.addSystem(`Added team member: ${member}`);
    } catch (err) {
      ctx.addError(`Failed to add member: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (sub === "remove" || sub === "rm") {
    const member = args.slice(1).join(" ").trim();
    if (!member) {
      ctx.addSystem("Usage: /team remove <member>");
      return;
    }
    const removed = store.removeMember(member);
    ctx.addSystem(removed ? `Removed team member: ${member}` : `Not a team member: ${member}`);
    return;
  }

  ctx.addSystem(
    "Usage: /team <info | name <n> | registry <url> | add <member> | remove <member>>"
  );
}

export function handleExportCommand(ctx: SlashHandlerContext, args: string[]): void {
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
    ctx.addSystem("No active session to export.");
    return;
  }

  const messages = session.contextManager
    .getMessages()
    .map((m) => ({ role: m.role, content: m.content }));

  if (messages.length === 0) {
    ctx.addSystem("Nothing to export — this session has no messages yet.");
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
      : resolve(ctx.projectRoot, outPath)
    : join(ctx.projectRoot, defaultName);

  try {
    writeFileSync(target, content, "utf8");
    ctx.addSystem(`Exported ${messages.length} messages to ${target}`);
  } catch (err) {
    ctx.addSystem(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function handleBranchCommand(ctx: SlashHandlerContext): void {
  const source = sessionManager.getActiveSession();
  if (!source) {
    ctx.addSystem("No active session to branch.");
    return;
  }

  // Create a new session/tab, then copy the source's conversation into it so
  // the branch starts as an independent duplicate of the current context.
  const branch = sessionManager.createSession({
    projectRoot: ctx.projectRoot,
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
  ctx.tabManager.refresh();
  ctx.tabManager.switchTab(branch.id);
  ctx.addSystem(`Branched into a new tab: "${branch.title}" (${srcCm.getMessageCount()} messages copied).`);
}

export function handleTabsCommand(ctx: SlashHandlerContext, args: string[]): void {
  const sub = args[0];

  if (!sub || sub === "list") {
    const sessions = sessionManager.getAllSessions();
    const activeId = sessionManager.getActiveSessionId();
    let msg = "Tabs:\n";
    for (const s of sessions) {
      const active = s.id === activeId ? " ←" : "";
      const pin = s.pinned ? "\u{1F4CC}" : "  ";
      msg += `  ${pin} ${s.id.slice(0, 8)}… ${s.title}${active}\n`;
    }
    ctx.addSystem(msg.trimEnd());
    return;
  }

  if (sub === "new") {
    ctx.createNewTab();
    ctx.addSystem("New tab created.");
    return;
  }

  if (sub === "close") {
    const id = args[1];
    if (!id) {
      const activeId = sessionManager.getActiveSessionId();
      if (activeId) {
        ctx.onTabClose(activeId);
        ctx.addSystem("Closed active tab.");
      }
    } else {
      ctx.onTabClose(id);
      ctx.addSystem(`Closed tab ${id}.`);
    }
    return;
  }

  if (sub === "switch") {
    const id = args[1];
    if (id) {
      ctx.tabManager.switchTab(id);
      ctx.addSystem(`Switched to tab.`);
    }
    return;
  }

  if (sub === "rename") {
    const id = args[1];
    const name = args.slice(2).join(" ");
    if (id && name) {
      sessionManager.renameSession(id, name);
      ctx.tabManager.refresh();
      ctx.addSystem(`Tab renamed to ${name}.`);
    } else {
      ctx.tabManager.renameCurrentTab();
    }
    return;
  }

  if (sub === "pin") {
    ctx.tabManager.togglePinCurrent();
    ctx.addSystem("Pin toggled.");
    return;
  }

  ctx.addSystem("Usage: /tabs [list|new|close|switch|rename|pin]");
}
