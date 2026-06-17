/**
 * Usage / metrics tracker (V17 observability). Accumulates token usage, per-tool
 * call counts (with success/failure), request counts, and an estimated USD cost
 * across a session. Pure and instantiable (no singletons): an injectable clock —
 * mirroring background.ts — keeps `startedAt` deterministic for tests. A shared
 * `usageTracker` singleton is exported too for app-wide use.
 */

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ToolStat {
  calls: number;
  ok: number;
  fail: number;
}

export interface UsageSnapshot {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  requests: number;
  estimatedCostUSD: number;
  toolCounts: Record<string, ToolStat>;
  startedAt: number;
}

export class UsageTracker {
  private promptTokens = 0;
  private completionTokens = 0;
  private totalTokens = 0;
  private requests = 0;
  private estimatedCostUSD = 0;
  private toolCounts = new Map<string, ToolStat>();
  private budgetUSD?: number;
  private readonly startedAt: number;

  /** Injectable clock keeps `startedAt` deterministic for tests (see background.ts). */
  constructor(private now: () => number = () => Date.now()) {
    this.startedAt = this.now();
  }

  /** Record a model response's token usage. Each call counts as one request. */
  recordTokens(u: TokenUsage | undefined): void {
    if (!u) return;
    this.promptTokens += u.promptTokens || 0;
    this.completionTokens += u.completionTokens || 0;
    this.totalTokens += u.totalTokens || 0;
    this.requests += 1;
  }

  /** Record a tool invocation outcome (and optionally its duration in ms). */
  recordTool(name: string, ok: boolean, _ms?: number): void {
    let stat = this.toolCounts.get(name);
    if (!stat) {
      stat = { calls: 0, ok: 0, fail: 0 };
      this.toolCounts.set(name, stat);
    }
    stat.calls += 1;
    if (ok) stat.ok += 1;
    else stat.fail += 1;
  }

  /** Add to the running estimated cost (USD). */
  recordCostUSD(n: number): void {
    if (!Number.isFinite(n)) return;
    this.estimatedCostUSD += n;
  }

  /** Set an optional spend budget; enables `overBudget()`. */
  setBudgetUSD(n: number): void {
    this.budgetUSD = n;
  }

  /** True when a budget is set and the estimated cost has exceeded it. */
  overBudget(): boolean {
    return this.budgetUSD !== undefined && this.estimatedCostUSD > this.budgetUSD;
  }

  snapshot(): UsageSnapshot {
    const toolCounts: Record<string, ToolStat> = {};
    for (const [name, stat] of this.toolCounts) {
      toolCounts[name] = { ...stat };
    }
    return {
      totalTokens: this.totalTokens,
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      requests: this.requests,
      estimatedCostUSD: this.estimatedCostUSD,
      toolCounts,
      startedAt: this.startedAt,
    };
  }

  /** Compact human-readable report: totals + a per-tool table sorted by calls. */
  render(): string {
    const lines: string[] = [];
    lines.push("Usage:");
    lines.push(`  Requests:   ${this.requests}`);
    lines.push(`  Prompt:     ${this.promptTokens.toLocaleString()} tokens`);
    lines.push(`  Completion: ${this.completionTokens.toLocaleString()} tokens`);
    lines.push(`  Total:      ${this.totalTokens.toLocaleString()} tokens`);
    lines.push(`  Est. cost:  $${this.estimatedCostUSD.toFixed(4)}`);
    if (this.budgetUSD !== undefined) {
      lines.push(
        `  Budget:     $${this.budgetUSD.toFixed(4)}${this.overBudget() ? "  (OVER BUDGET)" : ""}`
      );
    }

    const tools = [...this.toolCounts.entries()].sort((a, b) => b[1].calls - a[1].calls);
    lines.push("");
    if (tools.length === 0) {
      lines.push("Tools: (none used)");
    } else {
      lines.push("Tools:");
      const nameW = Math.max(4, ...tools.map(([n]) => n.length));
      lines.push(`  ${"TOOL".padEnd(nameW)}  ${"CALLS".padStart(5)}  ${"OK".padStart(5)}  ${"FAIL".padStart(5)}`);
      for (const [name, stat] of tools) {
        lines.push(
          `  ${name.padEnd(nameW)}  ${String(stat.calls).padStart(5)}  ${String(stat.ok).padStart(5)}  ${String(stat.fail).padStart(5)}`
        );
      }
    }
    return lines.join("\n");
  }
}

/** Shared app-wide singleton (in addition to the instantiable class). */
export const usageTracker = new UsageTracker();
