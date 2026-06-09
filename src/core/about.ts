// About report: a compact, dependency-free summary of the running build.

const FEATURES = [
  "plan/subagents/todos/background",
  "MCP",
  "workflows",
  "pipeline",
  "GSD ship",
  "repo index",
  "usage",
  "hooks",
  "sessions",
  "marketplace",
  "workspaces",
  "sync",
  "diagnostics",
  "palette",
  "teams",
  "vision",
];

/**
 * Build a compact "about" report for the given version. Pure — reads only
 * process.version / process.platform plus the supplied version string.
 */
export function buildAbout(version: string): string {
  return [
    "Sentinel CLI",
    `  Version:   v${version}`,
    `  Node:      ${process.version}`,
    `  Platform:  ${process.platform}`,
    `  Features:  ${FEATURES.join(", ")}`,
  ].join("\n");
}
