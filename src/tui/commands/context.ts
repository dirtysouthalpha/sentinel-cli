import type { ContextManager } from "../../ai/context.js";
import type { Pipeline } from "../../core/pipeline-engine.js";
import type { RepoIndex } from "../../core/repo-index.js";
import type { PermissionMode } from "../../core/permissions.js";
import type { BackgroundTaskManager } from "../../core/background.js";
import type { MCPManager } from "../../mcp/manager.js";
import type { CostTracker } from "../chat-renderer.js";
import type { SlashHandlerContext } from "../slash-handlers.js";

/**
 * Everything a slash-command handler needs from the running {@link TUIApp},
 * exposed as a narrow interface so handlers live in their own files and never
 * touch the app instance directly. Process-wide singletons (state, events,
 * themeEngine, providerManager, sessionManager, usageTracker, the markdown
 * commandRegistry, …) are imported directly by each handler — only app-bound
 * state and actions belong here.
 */
export interface CommandContext {
  /** Project root the session is anchored to. */
  readonly projectRoot: string;
  /** Positional args after the command name (parseCommand's `args`). */
  readonly args: string[];
  /** The resolved command name (parseCommand's `name`) — for alias-aware handlers. */
  readonly commandName: string;

  // --- output ------------------------------------------------------------
  /** Append a system/info block to the transcript. */
  addSystem(text: string): void;
  /** Append an error block to the transcript. */
  addError(text: string): void;
  /** Push a raw (pre-formatted, blessed-tagged) block to the transcript. */
  push(block: string): void;

  // --- conversation / agentic loop --------------------------------------
  /** Send a message through the full agentic loop, as if the user typed it. */
  chatWithAI(message: string): Promise<void>;
  /** The active session's context manager. */
  getContextManager(): ContextManager;
  /** Current session cost snapshot. */
  getCost(): CostTracker;

  // --- mutable app state (via accessors) --------------------------------
  getPermissionMode(): PermissionMode;
  setPermissionMode(mode: PermissionMode): void;
  getRepoIndex(): RepoIndex | undefined;
  setRepoIndex(index: RepoIndex): void;
  /** Whether MCP servers have connected yet (they connect on first message). */
  isMcpConnected(): boolean;

  // --- managers ----------------------------------------------------------
  readonly mcp: MCPManager;
  readonly background: BackgroundTaskManager;
  /** Lazily wire background-task update notifications into the transcript. */
  wireBackground(): void;
  /** Run a shell command, honoring the project cwd and an abort signal. */
  runShell(command: string, signal: AbortSignal): Promise<string>;

  // --- orchestration delegates (kept on the app) ------------------------
  /** Run a parsed JSON pipeline via isolated subagents. */
  runPipeline(pipeline: Pipeline): Promise<void>;
  /** Run the autonomous GSD ship pipeline for a task. */
  runGsd(task: string): Promise<void>;

  // --- TUI actions -------------------------------------------------------
  /** Build the context the extracted slash-handlers.ts helpers expect. */
  slashCtx(): SlashHandlerContext;
  /** Render the built-in command menu (used by /help). */
  showSlashMenu(): void;
  /** Clear the transcript and reprint the welcome banner (used by /clear). */
  clearScreen(): void;
  /** Tear down the screen and exit the process (used by /quit). */
  quit(): void;
}

/** A single slash command: its canonical name, optional aliases, and handler. */
export interface CommandSpec {
  /** Canonical command name without the leading slash (e.g. "model"). */
  name: string;
  /** Alternate names that resolve to this handler (e.g. ["perms"]). */
  aliases?: string[];
  /** One-line description (reserved for future menu generation). */
  description?: string;
  /** Execute the command against the given context. */
  run(ctx: CommandContext): void | Promise<void>;
}
