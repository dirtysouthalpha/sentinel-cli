import { exec } from "node:child_process";

/**
 * V12 diagnostics (lite LSP-ish): run the project's typecheck/build and surface
 * structured errors to both the user and the agent.
 */
export interface Diagnostic {
  file?: string;
  line?: number;
  col?: number;
  severity: "error" | "warning";
  message: string;
}

export interface RunDiagnosticsOptions {
  /** Command to run. Default: `npx tsc --noEmit`. */
  command?: string;
  /** Injected runner (for tests). Default uses child_process.exec. */
  run?: (cmd: string, cwd: string) => Promise<{ stdout: string; stderr: string; code: number }>;
}

export interface DiagnosticsResult {
  ok: boolean;
  diagnostics: Diagnostic[];
  raw: string;
}

// TypeScript: `src/x.ts(12,5): error TS1234: message`
const TSC_LINE = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+TS\d+:\s+(.*)$/;
// eslint-ish / generic: `file:line:col: severity message` or `file:line:col message`
const COLON_LINE = /^(.+?):(\d+):(\d+):?\s+(?:(error|warning)\s+)?(.*)$/;

/**
 * Parse compiler output (tsc, or eslint-ish `file:line:col`) into Diagnostics.
 * Pure function — the main thing to unit-test.
 */
export function parseTscOutput(raw: string): Diagnostic[] {
  if (!raw) return [];
  const diags: Diagnostic[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;

    const tsc = TSC_LINE.exec(line);
    if (tsc) {
      diags.push({
        file: tsc[1].trim(),
        line: Number(tsc[2]),
        col: Number(tsc[3]),
        severity: tsc[4] === "warning" ? "warning" : "error",
        message: tsc[5].trim(),
      });
      continue;
    }

    const colon = COLON_LINE.exec(line);
    if (colon) {
      diags.push({
        file: colon[1].trim(),
        line: Number(colon[2]),
        col: Number(colon[3]),
        severity: colon[4] === "warning" ? "warning" : "error",
        message: colon[5].trim(),
      });
      continue;
    }
  }
  return diags;
}

const defaultRun: NonNullable<RunDiagnosticsOptions["run"]> = (cmd, cwd) =>
  new Promise((resolve) => {
    const isWindows = process.platform === "win32";
    const shell = isWindows ? "powershell.exe" : undefined;
    exec(cmd, { cwd, maxBuffer: 10 * 1024 * 1024, shell }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout || "",
        stderr: stderr || "",
        code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
      });
    });
  });

/**
 * Run a diagnostics command (default `npx tsc --noEmit`) and parse its output.
 * `ok` is true when the command exits 0.
 */
export async function runDiagnostics(
  projectRoot: string,
  opts: RunDiagnosticsOptions = {}
): Promise<DiagnosticsResult> {
  const command = opts.command || "npx tsc --noEmit";
  const run = opts.run || defaultRun;
  const { stdout, stderr, code } = await run(command, projectRoot);
  const raw = [stdout, stderr].filter(Boolean).join("\n");
  const diagnostics = parseTscOutput(raw);
  return { ok: code === 0, diagnostics, raw };
}

/**
 * Compact, grouped-by-file report of diagnostics.
 */
export function formatDiagnostics(diags: Diagnostic[]): string {
  if (diags.length === 0) return "No problems found.";

  const byFile = new Map<string, Diagnostic[]>();
  for (const d of diags) {
    const key = d.file || "(general)";
    const arr = byFile.get(key);
    if (arr) arr.push(d);
    else byFile.set(key, [d]);
  }

  let errors = 0;
  let warnings = 0;
  for (const d of diags) {
    if (d.severity === "warning") warnings++;
    else errors++;
  }

  const lines: string[] = [];
  for (const [file, items] of byFile) {
    lines.push(file);
    for (const d of items) {
      const loc = d.line != null ? `:${d.line}${d.col != null ? `:${d.col}` : ""}` : "";
      const sev = d.severity === "warning" ? "warning" : "error";
      lines.push(`  ${sev}${loc}  ${d.message}`);
    }
  }

  const summary = `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${
    warnings === 1 ? "" : "s"
  }`;
  lines.push("");
  lines.push(summary);

  return lines.join("\n");
}
