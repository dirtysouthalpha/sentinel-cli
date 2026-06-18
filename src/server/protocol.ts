// Wire protocol for `sentinel serve` — a local WebSocket bridge that exposes the
// Sentinel engine to a GUI (or any client). All messages are JSON.

export type PermissionMode = "yolo" | "auto" | "gated" | "plan";

export interface StateSnapshot {
  model: string;
  agent: string;
  theme: string;
  permissionMode: PermissionMode;
  themes: { name: string; display: string }[];
  models: string[];
  agents: string[];
  sessions: { id: string; title: string; active: boolean }[];
  mcpTools: { server: string; tool: string; full: string }[];
  cost: { promptTokens: number; completionTokens: number; totalTokens: number; estimatedCostUSD: number; requests: number };
  providers: { name: string; available: boolean }[];
  /** Engine context-window cap (tokens), so the GUI gauge uses the right denominator. */
  contextWindow: number;
  /** The engine's actual slash-command catalog, so the GUI autocomplete doesn't drift. */
  commands: { name: string; description: string }[];
  /** The active theme as a CSS-variable map (colorsToCSS), so the GUI can apply
   *  the full palette instead of collapsing 16 themes to 5 accent buckets. */
  themeVars: Record<string, string>;
}

// ---- client -> server -------------------------------------------------------
export type ClientMessage =
  | { type: "send"; text: string }
  | { type: "edit"; text: string; truncateIndex: number }
  | { type: "cancel" }
  | { type: "permission"; allow: boolean }
  | { type: "command"; name: string; args?: string[] }
  | { type: "setModel"; model: string }
  | { type: "setAgent"; agent: string }
  | { type: "setTheme"; theme: string }
  | { type: "setPermissionMode"; mode: PermissionMode }
  | { type: "session"; action: "new" | "switch" | "close" | "rename"; id?: string; title?: string }
  | { type: "checkpoints"; action: "list" | "undo" }
  | { type: "compact" }
  | { type: "clear" }
  | { type: "getState" }
  // ---- settings (providers / models / MCP) ----
  | { type: "getConfig" }
  | { type: "setProvider"; name: string; apiKey?: string; baseURL?: string; defaultModel?: string }
  | { type: "removeProvider"; name: string }
  | { type: "addModel"; model: string }
  | { type: "removeModel"; model: string }
  | { type: "addMcp"; name: string; command?: string[]; url?: string; enabled?: boolean }
  | { type: "removeMcp"; name: string }
  | { type: "toggleMcp"; name: string; enabled: boolean }
  // D2: @-mention file autocomplete — client queries, server globs the project.
  | { type: "listFiles"; query: string };

export interface ConfigView {
  providers: { name: string; hasKey: boolean; baseURL?: string; defaultModel?: string; builtin: boolean; available: boolean }[];
  models: string[];
  mcp: { name: string; command?: string[]; url?: string; enabled: boolean; connected: boolean }[];
}

// ---- server -> client -------------------------------------------------------
export interface ToolArgs {
  [k: string]: unknown;
}

export type ServerMessage =
  | { type: "hello"; version: string; state: StateSnapshot }
  | { type: "state"; state: StateSnapshot }
  | { type: "user"; text: string }
  | { type: "round_start"; round: number }
  | { type: "token"; text: string }
  | { type: "stream_end" }
  | { type: "usage"; promptTokens: number; completionTokens: number; totalTokens: number; estimatedCostUSD: number }
  | { type: "tool_start"; tool: string; name: string; args: ToolArgs; argsRaw: string }
  | { type: "tool_result"; name: string; ok: boolean; firstLine: string; full: string }
  | { type: "round_end"; round: number; willContinue: boolean }
  | { type: "permission_request"; tool: string; action?: string; path?: string; reason: string }
  | { type: "done"; stopReason: string; rounds: number }
  | { type: "system"; text: string }
  | { type: "error"; message: string }
  | { type: "checkpoints"; items: { id: string; tool: string; path: string; existed: boolean; timestamp: number }[] }
  | { type: "todos"; items: { content: string; status: "pending" | "in_progress" | "completed" }[] }
  | { type: "config"; config: ConfigView }
  | { type: "busy"; busy: boolean }
  // Full conversation replay: sent after getState (and on reconnect) so the GUI
  // can rebuild its message blocks. Without it, a transient WS drop blanks the
  // chat even though ContextManager still holds every turn.
  | { type: "history"; messages: HistoryMessage[] }
  // D2: reply to listFiles — project paths matching the @-mention query.
  | { type: "files"; items: string[] };

/** One replayed conversation turn for the `history` message. */
export interface HistoryMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  /** For tool entries, the tool name (so the GUI can render a tool card). */
  name?: string;
}

export interface ServeHandshake {
  port: number;
  token: string;
  pid: number;
}
