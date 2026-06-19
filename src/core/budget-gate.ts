/**
 * Budget gate — proactive spend warnings.
 *
 * The old overBudget() was reactive (true only after crossing). This module
 * adds threshold checks at 50/80/100% so callers can warn BEFORE the budget
 * blows, and a formatter for human-readable messages. Pure + tested.
 */

export type BudgetStatus = "ok" | "warn" | "critical" | "exceeded";

/** Which threshold has spending reached? Budget of 0/undefined = unlimited = ok. */
export function budgetThresholds(spent: number, budget?: number): BudgetStatus {
  if (!budget || budget <= 0) return "ok";
  const ratio = spent / budget;
  if (ratio >= 1) return "exceeded";
  if (ratio >= 0.8) return "critical";
  if (ratio >= 0.5) return "warn";
  return "ok";
}

/** Human-readable warning string, or null when spending is fine. */
export function formatBudgetWarning(spent: number, budget?: number): string | null {
  const status = budgetThresholds(spent, budget);
  if (status === "ok") return null;
  const pct = budget ? Math.round((spent / budget) * 100) : 0;
  const spentStr = `$${spent.toFixed(2)}`;
  const budgetStr = budget ? `$${budget.toFixed(2)}` : "∞";
  switch (status) {
    case "warn":
      return `⚠ Budget: ${pct}% used (${spentStr} of ${budgetStr}). Approaching the limit.`;
    case "critical":
      return `🔴 Budget CRITICAL: ${pct}% used (${spentStr} of ${budgetStr}). Will stop soon.`;
    case "exceeded":
      return `⛔ Budget EXCEEDED: ${spentStr} spent (limit ${budgetStr}). Stopping to prevent overspend.`;
    default:
      return null;
  }
}
