export interface SkillDef {
  name: string;
  description: string;
  permissions?: Record<string, string>;
  content: string;
  source: "builtin" | "project" | "global" | "remote";
  path?: string;
}

export interface SkillLoaderResult {
  skills: SkillDef[];
  errors: string[];
}
