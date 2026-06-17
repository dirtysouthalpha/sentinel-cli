export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  data?: unknown;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolParameter {
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  required?: boolean;
  default?: unknown;
}

export type PermissionLevel = "allow" | "deny" | "ask";

export interface ToolPermission {
  tool: string;
  permission: PermissionLevel;
  patterns?: string[];
}
