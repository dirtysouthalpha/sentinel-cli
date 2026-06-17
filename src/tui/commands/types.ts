import type { TabManager } from "../tab-manager.js";

/**
 * The slice of TUIApp that extracted slash-command handlers depend on. TUIApp
 * builds one of these (via `commandHost()`) and passes it in, so each handler
 * stays decoupled from the rest of the class and its private rendering internals.
 */
export interface CommandHost {
  readonly projectRoot: string;
  readonly tabManager: TabManager;
  addSystem(text: string): void;
  addError(text: string): void;
  /** Run a message through the main agent loop (used by `/workflow run`). */
  chatWithAI(message: string): Promise<void>;
}
