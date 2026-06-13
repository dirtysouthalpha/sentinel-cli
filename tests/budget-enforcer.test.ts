import { describe, it, expect, vi } from "vitest";
import { BudgetEnforcer } from "../src/core/budget-enforcer.js";

describe("BudgetEnforcer", () => {
  it("isExceeded returns false when budget is 0 (disabled)", () => {
    const e = new BudgetEnforcer(0, () => 5.0);
    expect(e.isExceeded()).toBe(false);
  });

  it("isExceeded returns false when cost is under budget", () => {
    const e = new BudgetEnforcer(10.0, () => 5.0);
    expect(e.isExceeded()).toBe(false);
  });

  it("isExceeded returns true when cost meets budget", () => {
    const e = new BudgetEnforcer(5.0, () => 5.0);
    expect(e.isExceeded()).toBe(true);
  });

  it("isExceeded returns true when cost exceeds budget", () => {
    const e = new BudgetEnforcer(5.0, () => 7.5);
    expect(e.isExceeded()).toBe(true);
  });

  it("remaining returns correct amount", () => {
    const e = new BudgetEnforcer(10.0, () => 3.5);
    expect(e.remaining()).toBeCloseTo(6.5);
  });

  it("remaining returns 0 when exceeded", () => {
    const e = new BudgetEnforcer(5.0, () => 8.0);
    expect(e.remaining()).toBe(0);
  });
});
