// Wire protocol for `sentinel serve` — a local WebSocket bridge that exposes the
// Sentinel engine to a GUI (or any client). All messages are JSON.

export type PermissionMode = "yolo" | "auto" | "gated";

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
}

// ---- client -> server -------------------------------------------------------
export type ClientMessage =
  | { type: "send"; text: string }
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
  | { type: "getState" };

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
  | { type: "busy"; busy: boolean };

export interface ServeHandshake {
  port: number;
  token: string;
  pid: number;
}
