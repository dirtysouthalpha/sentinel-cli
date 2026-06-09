import { describe, it, expect, beforeEach } from "vitest";
import { state } from "../src/core/state.js";

describe("StateManager", () => {
  beforeEach(() => {
    state.reset();
  });

  it("should get and set values", () => {
    state.set("currentTheme", "matrix");
    expect(state.get("currentTheme")).toBe("matrix");
  });

  it("should have correct initial state", () => {
    expect(state.get("currentTheme")).toBe("cyberpunk");
    expect(state.get("currentAgent")).toBe("gsd");
    expect(state.get("isProcessing")).toBe(false);
  });

  it("should subscribe to changes", () => {
    const changes: Array<{ value: string; prev: string }> = [];
    state.subscribe("currentTheme", (value, prev) => {
      changes.push({ value, prev });
    });

    state.set("currentTheme", "matrix");
    state.set("currentTheme", "tron");

    expect(changes).toHaveLength(2);
    expect(changes[0]).toEqual({ value: "matrix", prev: "cyberpunk" });
    expect(changes[1]).toEqual({ value: "tron", prev: "matrix" });
  });

  it("should reset state", () => {
    state.set("currentTheme", "matrix");
    state.set("currentAgent", "debug");
    state.reset();
    expect(state.get("currentTheme")).toBe("cyberpunk");
    expect(state.get("currentAgent")).toBe("gsd");
  });

  it("should get all state", () => {
    const all = state.getAll();
    expect(all).toHaveProperty("currentTheme");
    expect(all).toHaveProperty("currentAgent");
    expect(all).toHaveProperty("messages");
  });
});
