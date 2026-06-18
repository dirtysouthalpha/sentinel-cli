import type { TabManager } from "../tab-manager.js";

/** A read-only view of the session cost tracker (for /cost, /usage display). */
export interface CostSnapshot {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requests: number;
  estimatedCostUSD: number;
}

/** Minimal context access extracted commands need (for /context, /compact). */
export interface ContextView {
  getMessageCount(): number;
  getTotalTokens(): number;
  getCharTotal(): number;
  compact(): void;
  clear(): void;
}

/**
 * The slice of TUIApp that extracted slash-command handlers depend on. TUIApp
 * builds one of these (via `commandHost()`) and passes it in, so each handler
 * stays decoupled from the rest of the class and its private rendering internals.
 *
 * Fields are optional so a test (or a command that doesn't need them) can omit
 * them; handlers check before use.
 */
export interface CommandHost {
  readonly projectRoot: string;
  readonly tabManager: TabManager;
  addSystem(text: string): void;
  addError(text: string): void;
  /** Run a message through the main agent loop (used by `/workflow run`). */
  chatWithAI(message: string): Promise<void>;
  /** Current session cost snapshot. Optional — only display commands need it. */
  getCost?(): CostSnapshot;
  /** Reset the session cost tracker (e.g. on /clear). Optional. */
  resetCost?(): void;
  /** Active context manager view. Optional. */
  getContext?(): ContextView;
  /** Mark the active session dirty (persist soon). Optional. */
  markSessionDirty?(): void;
  /** Re-render the status bar + transcript (after a mutation). Optional. */
  requestRender?(): void;
  /** Permission mode get/set (for /permissions, /plan). Optional. */
  getPermissionMode?(): string;
  setPermissionMode?(mode: "yolo" | "auto" | "gated" | "plan"): void;
  /** The last tool call's full output (for /out). Optional. */
  getLastToolOutput?(): { name: string; ok: boolean; output: string } | null;
}
