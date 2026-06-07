import { existsSync, readFileSync } from "fs";
import { join } from "path";

export interface ProjectInfo {
  type: string;
  name: string;
  language: string;
  icon: string;
}

const PROJECT_FILES: Array<{
  file: string;
  type: string;
  language: string;
  icon: string;
  nameExtractor?: (content: string) => string | undefined;
}> = [
  {
    file: "package.json",
    type: "node",
    language: "TypeScript/JavaScript",
    icon: "\u{1F4E6}",
    nameExtractor: (c) => { try { return JSON.parse(c).name; } catch { return undefined; } },
  },
  {
    file: "Cargo.toml",
    type: "rust",
    language: "Rust",
    icon: "\u{1F980}",
    nameExtractor: (c) => { const m = c.match(/^name\s*=\s*"([^"]+)"/m); return m?.[1]; },
  },
  {
    file: "pyproject.toml",
    type: "python",
    language: "Python",
    icon: "\u{1F40D}",
    nameExtractor: (c) => { const m = c.match(/^name\s*=\s*"([^"]+)"/m); return m?.[1]; },
  },
  {
    file: "pom.xml",
    type: "java",
    language: "Java",
    icon: "\u2615",
  },
  {
    file: "go.mod",
    type: "go",
    language: "Go",
    icon: "\u{1F408}",
    nameExtractor: (c) => { const m = c.match(/^module\s+(\S+)/m); return m?.[1]; },
  },
  {
    file: "Gemfile",
    type: "ruby",
    language: "Ruby",
    icon: "\u{1F48E}",
  },
  {
    file: "*.csproj",
    type: "dotnet",
    language: "C#",
    icon: "\u{1F4A0}",
  },
];

export function detectProject(projectRoot: string): ProjectInfo | null {
  for (const pf of PROJECT_FILES) {
    const filePath = join(projectRoot, pf.file);
    if (existsSync(filePath)) {
      let name: string | undefined;
      if (pf.nameExtractor) {
        try {
          const content = readFileSync(filePath, "utf-8");
          name = pf.nameExtractor(content);
        } catch {
          // ignore
        }
      }

      return {
        type: pf.type,
        name: name || projectRoot.split(/[/\\]/).pop() || "Unknown",
        language: pf.language,
        icon: pf.icon,
      };
    }
  }

  return null;
}

export function getProjectIcon(projectRoot: string): string {
  const info = detectProject(projectRoot);
  return info?.icon || "\u{1F4C1}";
}
