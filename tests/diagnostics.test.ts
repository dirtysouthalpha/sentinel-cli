import { describe, it, expect } from "vitest";
import {
  parseTscOutput,
  runDiagnostics,
  formatDiagnostics,
  type Diagnostic,
} from "../src/core/diagnostics.js";

describe("parseTscOutput", () => {
  it("parses multiple tsc errors and a warning", () => {
    const raw = [
      "src/a.ts(12,5): error TS1234: Type 'string' is not assignable to type 'number'.",
      "src/b.ts(3,1): error TS2304: Cannot find name 'foo'.",
      "src/a.ts(40,9): warning TS6133: 'x' is declared but its value is never read.",
    ].join("\n");

    const diags = parseTscOutput(raw);
    expect(diags).toHaveLength(3);
    expect(diags[0]).toEqual<Diagnostic>({
      file: "src/a.ts",
      line: 12,
      col: 5,
      severity: "error",
      message: "Type 'string' is not assignable to type 'number'.",
    });
    expect(diags[1].file).toBe("src/b.ts");
    expect(diags[1].line).toBe(3);
    expect(diags[1].col).toBe(1);
    expect(diags[2].severity).toBe("warning");
    expect(diags[2].message).toContain("never read");
  });

  it("tolerates eslint-ish file:line:col output", () => {
    const raw = [
      "src/c.ts:10:2: error Unexpected console statement",
      "src/c.ts:11:4: warning Missing semicolon",
      "src/d.ts:1:1 Unexpected token",
    ].join("\n");

    const diags = parseTscOutput(raw);
    expect(diags).toHaveLength(3);
    expect(diags[0]).toEqual<Diagnostic>({
      file: "src/c.ts",
      line: 10,
      col: 2,
      severity: "error",
      message: "Unexpected console statement",
    });
    expect(diags[1].severity).toBe("warning");
    // No explicit severity → defaults to error.
    expect(diags[2].severity).toBe("error");
    expect(diags[2].message).toBe("Unexpected token");
  });

  it("returns [] for empty / non-diagnostic output", () => {
    expect(parseTscOutput("")).toEqual([]);
    expect(parseTscOutput("\n  \n")).toEqual([]);
    expect(parseTscOutput("Compilation complete. Watching for changes.")).toEqual([]);
  });
});

describe("runDiagnostics", () => {
  it("parses output and reports ok=true on exit 0", async () => {
    const calls: Array<{ cmd: string; cwd: string }> = [];
    const result = await runDiagnostics("/proj", {
      run: async (cmd, cwd) => {
        calls.push({ cmd, cwd });
        return { stdout: "", stderr: "", code: 0 };
      },
    });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(calls[0].cmd).toBe("npx tsc --noEmit --pretty false");
    expect(calls[0].cwd).toBe("/proj");
  });

  it("parses canned error output and reports ok=false on non-zero exit", async () => {
    const canned = "src/a.ts(2,3): error TS2304: Cannot find name 'bar'.";
    const result = await runDiagnostics("/proj", {
      command: "npm run build",
      run: async () => ({ stdout: canned, stderr: "", code: 2 }),
    });
    expect(result.ok).toBe(false);
    expect(result.raw).toContain("TS2304");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].file).toBe("src/a.ts");
    expect(result.diagnostics[0].severity).toBe("error");
  });

  it("merges stdout and stderr when parsing", async () => {
    const result = await runDiagnostics("/proj", {
      run: async () => ({
        stdout: "src/a.ts(1,1): error TS1: a",
        stderr: "src/b.ts(2,2): error TS2: b",
        code: 1,
      }),
    });
    expect(result.diagnostics).toHaveLength(2);
    expect(result.ok).toBe(false);
  });
});

describe("formatDiagnostics", () => {
  it("returns a friendly message when there are no diagnostics", () => {
    expect(formatDiagnostics([])).toBe("No problems found.");
  });

  it("groups by file and includes a summary", () => {
    const out = formatDiagnostics([
      { file: "src/a.ts", line: 1, col: 2, severity: "error", message: "boom" },
      { file: "src/a.ts", line: 5, col: 1, severity: "warning", message: "meh" },
      { file: "src/b.ts", line: 3, col: 3, severity: "error", message: "bang" },
    ]);
    expect(out).toContain("src/a.ts");
    expect(out).toContain("src/b.ts");
    expect(out).toContain("error:1:2  boom");
    expect(out).toContain("warning:5:1  meh");
    expect(out).toContain("2 errors, 1 warning");
  });
});
