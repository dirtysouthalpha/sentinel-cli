import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, isAbsolute, resolve, sep } from "path";
import { ToolDef, ToolResult } from "./types.js";

/**
 * `create_skill` — let the agent author a reusable skill (.md) when it hits a
 * repeatable sub-task it lacks a tool for. The skill lands in
 * `<projectRoot>/.sentinel/skills/<name>.md` (a path the loader already scans),
 * so it's discovered on the next registry load — i.e. immediately usable.
 *
 * This is the "creates the tools to be the solution" affordance: the agent
 * doesn't get stuck when something's missing; it writes a procedure, in plain
 * markdown, that future turns (and future sessions) can invoke.
 *
 * The filename is sanitized (no path traversal — it stays under the skills dir)
 * and the content is written as-is (frontmatter + body), matching the loader's
 * format (name/description frontmatter + a body).
 */
export function createCreateSkillTool(projectRoot: string): ToolDef {
  const skillsDir = join(projectRoot, ".sentinel", "skills");

  return {
    name: "create_skill",
    description:
      "Author a new reusable skill (procedure) and save it so it's immediately available to you and future turns. " +
      "Use this when you find yourself repeating a multi-step sub-task, or when you hit a gap no existing tool covers — " +
      "write the procedure as a skill instead of getting stuck. The skill is a markdown file (.md) with a YAML frontmatter " +
      "(name, description) and a body of step-by-step instructions; it loads from .sentinel/skills on the next run.",
    parameters: {
      name: {
        type: "string",
        description: "Skill name (kebab-case, e.g. 'deploy-to-vercel'). Used as the filename.",
        required: true,
      },
      description: {
        type: "string",
        description: "One-line description of when to use this skill.",
        required: true,
      },
      body: {
        type: "string",
        description:
          "The skill body — markdown step-by-step instructions, code snippets, or a procedure the agent follows " +
          "when the skill is invoked. This is the substance of the skill.",
        required: true,
      },
    },
    execute: async (args): Promise<ToolResult> => {
      const rawName = String(args.name ?? "").trim();
      const description = String(args.description ?? "").trim();
      const body = String(args.body ?? "").trim();
      if (!rawName || !description || !body) {
        return {
          success: false,
          output: "",
          error: "create_skill requires 'name', 'description', and 'body'.",
        };
      }
      // Sanitize the name into a safe filename stem: keep alnum, dash, dot;
      // collapse everything else. Prevents path traversal out of the skills dir.
      const safe = rawName
        .toLowerCase()
        .replace(/[^a-z0-9.-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/\.{2,}/g, ".");
      if (!safe || safe.startsWith(".")) {
        return { success: false, output: "", error: `Invalid skill name: ${rawName}` };
      }

      try {
        if (!existsSync(skillsDir)) mkdirSync(skillsDir, { recursive: true });
        const dest = join(skillsDir, `${safe}.md`);
        // Belt-and-suspenders: confirm the resolved path stays under skillsDir.
        const resolved = resolve(dest);
        if (!resolved.startsWith(resolve(skillsDir) + sep) && resolved !== resolve(skillsDir)) {
          return { success: false, output: "", error: `Refusing to write outside skills dir: ${rawName}` };
        }
        const content =
          `---\nname: ${safe}\ndescription: ${description.replace(/\n/g, " ")}\n---\n\n${body}\n`;
        writeFileSync(dest, content, "utf-8");
        return {
          success: true,
          output:
            `Created skill "${safe}" → ${dest}.\n` +
            `It will be available on the next registry load (this run's skills were loaded at startup; ` +
            `restart, or run /skills, to pick it up). Reusable across sessions.`,
          data: { name: safe, path: dest },
        };
      } catch (err) {
        return { success: false, output: "", error: String(err) };
      }
    },
  };
}

/**
 * Pure helper: build the on-disk filename for a skill name (sanitized). Exported
 * for testing the sanitization rules without touching the filesystem.
 */
export function sanitizeSkillName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.-]+|[.-]+$/g, ""); // strip leading/trailing dots AND dashes
}
