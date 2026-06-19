import { describe, it, expect } from "vitest";
import { budgetThresholds, formatBudgetWarning } from "../src/core/budget-gate.js";

describe("budgetThresholds — proactive spend warnings", () => {
  it("returns 'ok' when under 50%", () => {
    expect(budgetThresholds(1, 10)).toBe("ok");
    expect(budgetThresholds(4.99, 10)).toBe("ok");
  });
  it("returns 'warn' at 50%+", () => {
    expect(budgetThresholds(5, 10)).toBe("warn");
    expect(budgetThresholds(7, 10)).toBe("warn");
  });
  it("returns 'critical' at 80%+", () => {
    expect(budgetThresholds(8, 10)).toBe("critical");
    expect(budgetThresholds(9.99, 10)).toBe("critical");
  });
  it("returns 'exceeded' at 100%+", () => {
    expect(budgetThresholds(10, 10)).toBe("exceeded");
    expect(budgetThresholds(15, 10)).toBe("exceeded");
  });
  it("returns 'ok' when budget is 0 (unlimited)", () => {
    expect(budgetThresholds(100, 0)).toBe("ok");
  });
  it("returns 'ok' when budget is undefined", () => {
    expect(budgetThresholds(100, undefined)).toBe("ok");
  });
});

describe("formatBudgetWarning — human-readable warning text", () => {
  it("returns null when status is ok", () => {
    expect(formatBudgetWarning(3, 10)).toBeNull();
  });
  it("formats a warning at 50%", () => {
    const out = formatBudgetWarning(5, 10);
    expect(out).toContain("50%");
    expect(out).toContain("$5");
    expect(out).toContain("$10");
  });
  it("formats critical at 80%+", () => {
    const out = formatBudgetWarning(8.5, 10);
    expect(out).toContain("85%");
    expect(out.toLowerCase()).toContain("critical");
  });
  it("formats exceeded at 100%+", () => {
    const out = formatBudgetWarning(12, 10);
    expect(out.toLowerCase()).toContain("exceeded");
  });
});
