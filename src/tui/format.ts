/**
 * Pure formatting helpers for the TUI status bar and tool-call rows. Kept
 * side-effect-free so the historically-ad-hoc display logic is unit-tested
 * (tests/format.test.ts).
 */

/** 12577 -> "12.6k", 1_500_000 -> "1.5M", 840 -> "840". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.max(0, Math.round(n)));
  if (n < 1_000_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
}

/** 0.0448 -> "0.045", 1.2 -> "1.20" (sub-dollar gets 3 dp, else 2). */
export function formatCost(n: number): string {
  return n < 1 ? n.toFixed(3) : n.toFixed(2);
}

function parseArgs(argsJson: string): Record<string, unknown> {
  try {
    const v = JSON.parse(argsJson);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function str(a: Record<string, unknown>, key: string): string {
  return typeof a[key] === "string" ? (a[key] as string) : "";
}

/** Short, human-readable description of a tool call, e.g. "read README.md". */
export function humanizeToolCall(name: string, argsJson: string): string {
  const a = parseArgs(argsJson);
  switch (name) {
    case "file": {
      const action = str(a, "action") || "file";
      const path = str(a, "path");
      return path ? `${action} ${path}` : action;
    }
    case "bash":
      return str(a, "command") || "bash";
    case "search": {
      const q = str(a, "query") || str(a, "pattern");
      return q ? `search "${q}"` : "search";
    }
    case "git":
      return `git ${str(a, "command") || str(a, "action")}`.trim();
    case "web":
      return str(a, "url") || "web";
    case "patch":
      return `patch ${str(a, "path")}`.trim();
    case "browser": {
      const action = str(a, "action") || "browser";
      const target = str(a, "url") || str(a, "selector") || str(a, "text");
      return target ? `browser ${action} ${target}` : `browser ${action}`;
    }
    default: {
      const compact = (argsJson || "").replace(/\s+/g, " ").trim();
      return compact && compact !== "{}" ? `${name} ${compact}` : name;
    }
  }
}

function countLines(s: string): number {
  const t = (s || "").replace(/\n+$/, "");
  return t ? t.split("\n").length : 0;
}

function firstLine(s: string): string {
  const l = (s || "").split("\n").find((x) => x.trim()) || "";
  return l.trim().slice(0, 60);
}

/** "+X -Y" from unified-diff-ish output; empty string when there are no +/- lines. */
function diffStat(s: string): string {
  let add = 0;
  let del = 0;
  for (const l of (s || "").split("\n")) {
    if (/^\+/.test(l) && !/^\+\+\+/.test(l)) add++;
    else if (/^-/.test(l) && !/^---/.test(l)) del++;
  }
  return add || del ? `+${add} −${del}` : "";
}

/**
 * A short, tool-aware summary of a result, e.g. "268 lines", "+3 -2", "7 matches".
 * Strips the "[<tool> output]" wrapper the context compressor prepends so the
 * preview never shows that placeholder again.
 */
export function summarizeToolResult(name: string, argsJson: string, ok: boolean, output: string): string {
  const out = (output || "").replace(/^\[[^\]]*output\]\n/, "");
  if (!ok) return firstLine(out) || "failed";

  const a = parseArgs(argsJson);
  const action = str(a, "action");
  switch (name) {
    case "file": {
      if (action === "read") return `${countLines(out)} lines`;
      if (action === "write") {
        const m = out.match(/(\d+)\s*bytes/);
        return m ? `${m[1]} bytes` : "written";
      }
      if (action === "delete") return "deleted";
      if (action === "exists") return out.trim().slice(0, 20);
      return diffStat(out) || firstLine(out);
    }
    case "patch":
      return diffStat(out) || "patched";
    case "search":
      return `${countLines(out)} matches`;
    case "bash":
      return firstLine(out) || "done";
    default:
      return firstLine(out);
  }
}
