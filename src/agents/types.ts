export interface AgentDef {
  name: string;
  description: string;
  mode: "primary" | "assistant" | "background";
  model?: string;
  steps?: number;
  color?: string;
  permissions?: Record<string, unknown>;
  systemPrompt: string;
  source: "builtin" | "project" | "global";
  path?: string;
}
