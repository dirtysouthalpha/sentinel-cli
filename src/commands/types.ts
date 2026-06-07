export interface CommandDef {
  name: string;
  description: string;
  agent?: string;
  model?: string;
  subtask?: boolean;
  template: string;
  source: "builtin" | "project" | "global";
  path?: string;
}

export interface ParsedCommand {
  name: string;
  args: string[];
  raw: string;
}
