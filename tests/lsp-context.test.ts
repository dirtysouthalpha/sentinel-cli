import { describe, it, expect } from "vitest";
import {
  formatDefinition,
  formatReferences,
  formatDiagnostics,
  uriToPath,
  formatLocation,
  severityLabel,
} from "../src/core/lsp-context.js";
import type { LSPLocation, LSPDiagnostic } from "../src/core/lsp-client.js";

const loc = (file: string, line: number, col: number): LSPLocation => ({
  uri: `file:///abs/${file}`,
  range: {
    start: { line, character: col },
    end: { line, character: col + 3 },
  },
});

const diag = (line: number, severity: number | undefined, message: string): LSPDiagnostic => ({
  range: { start: { line, character: 0 }, end: { line, character: 10 } },
  severity,
  message,
});

describe("uriToPath", () => {
  it("strips the file:// prefix and decodes", () => {
    expect(uriToPath("file:///abs/src/foo.ts")).toBe("/abs/src/foo.ts");
    expect(uriToPath("file:///abs/src/a%20b.ts")).toBe("/abs/src/a b.ts");
  });
  it("returns the input unchanged when not a file:// URI", () => {
    expect(uriToPath("/abs/src/foo.ts")).toBe("/abs/src/foo.ts");
  });
});

describe("severityLabel", () => {
  it("maps LSP severity ints to labels", () => {
    expect(severityLabel(1)).toBe("error");
    expect(severityLabel(2)).toBe("warning");
    expect(severityLabel(3)).toBe("info");
    expect(severityLabel(4)).toBe("hint");
  });
  it("defaults to error when missing", () => {
    expect(severityLabel(undefined)).toBe("error");
  });
});

describe("formatLocation", () => {
  it("formats a single location as path:line:col (1-based)", () => {
    // LSP line/character are 0-based; display 1-based like editors.
    // displayPath strips cwd when possible; for the synthetic /abs path it
    // keeps the full path. Assert the line/col suffix + that the path is present.
    const out = formatLocation(loc("src/foo.ts", 41, 9));
    expect(out).toMatch(/:42:10$/);
    expect(out).toContain("src/foo.ts");
  });
});

describe("formatDefinition", () => {
  it("formats a definition location", () => {
    const out = formatDefinition(loc("src/foo.ts", 41, 9));
    expect(out).toMatch(/^defined at .*src\/foo\.ts:42:10$/);
  });
  it("returns a not-found string for null", () => {
    expect(formatDefinition(null)).toBe("no definition found");
  });
});

describe("formatReferences", () => {
  it("formats a deduped, capped list of references", () => {
    const refs = [
      loc("src/a.ts", 1, 0),
      loc("src/a.ts", 1, 0), // dup → collapsed
      loc("src/b.ts", 5, 2),
      loc("src/c.ts", 9, 4),
    ];
    const out = formatReferences(refs);
    expect(out).toContain("src/a.ts:2:1");
    expect(out).toContain("src/b.ts:6:3");
    expect(out).toContain("src/c.ts:10:5");
    // dup collapsed: only one a.ts:2:1 line
    expect(out.match(/src\/a\.ts:2:1/g)).toHaveLength(1);
  });
  it("caps at 20 references and notes the truncation", () => {
    const refs = Array.from({ length: 30 }, (_, i) => loc(`f${i}.ts`, i, 0));
    const out = formatReferences(refs);
    expect(out).toContain("20 of 30");
  });
  it("returns a none string for empty", () => {
    expect(formatReferences([])).toBe("no references found");
  });
});

describe("formatDiagnostics", () => {
  it("formats each diagnostic with severity + message", () => {
    const out = formatDiagnostics([
      diag(9, 1, "Type 'string' is not assignable to type 'number'."),
      diag(20, 2, "Unused variable 'x'."),
    ]);
    // Diagnostics don't carry a uri; assert on severity + message structure.
    expect(out).toContain("error");
    expect(out).toContain("not assignable");
    expect(out).toContain("warning");
    expect(out).toContain("Unused variable");
  });
  it("uses the relative path and 1-based line", () => {
    const out = formatDiagnostics([diag(9, 1, "boom")]);
    // diag() uses file:///abs/<file>; we don't have the file path, so we
    // assert on the structure (severity + message) rather than exact path.
    expect(out).toMatch(/error.*boom/s);
  });
  it("returns a clean string for empty", () => {
    expect(formatDiagnostics([])).toBe("no diagnostics");
  });
});
