import { describe, it, expect } from "vitest";
import { refineGoal, detectIntent, INTENTS, type Intent } from "../src/core/refine-goal.js";

describe("detectIntent — keyword matching", () => {
  it("detects 'fix' intent", () => {
    expect(detectIntent("fix the flaky login test")).toBe("fix");
    expect(detectIntent("Fix bug in parser")).toBe("fix");
  });
  it("detects 'implement' intent", () => {
    expect(detectIntent("implement oauth login")).toBe("implement");
    expect(detectIntent("add input validation")).toBe("add"); // 'add' beats 'implement'
  });
  it("detects 'add' intent", () => {
    expect(detectIntent("add a health check endpoint")).toBe("add");
  });
  it("detects 'refactor' intent", () => {
    expect(detectIntent("refactor the api layer")).toBe("refactor");
  });
  it("detects 'improve' intent", () => {
    expect(detectIntent("improve error handling")).toBe("improve");
  });
  it("detects 'clean' intent", () => {
    expect(detectIntent("clean up dead code")).toBe("clean");
    expect(detectIntent("remove unused imports")).toBe("clean");
  });
  it("detects 'document' intent", () => {
    expect(detectIntent("document the public api")).toBe("document");
    expect(detectIntent("write docs for the cli")).toBe("document");
  });
  it("detects 'secure' intent", () => {
    expect(detectIntent("secure the auth endpoints")).toBe("secure");
  });
  it("detects 'test' intent", () => {
    expect(detectIntent("write tests for the router")).toBe("test");
    expect(detectIntent("test the parser module")).toBe("test");
  });
  it("returns null when no intent matches", () => {
    expect(detectIntent("login form")).toBeNull();
    expect(detectIntent("make it faster")).toBeNull();
  });
});

describe("refineGoal — casual input → structured loop goal", () => {
  it("expands a 'fix' goal with a done-condition", () => {
    const r = refineGoal("fix the flaky test");
    expect(r.intent).toBe("fix");
    expect(r.refined).toContain("Fix the flaky test");
    expect(r.refined).toContain("Done when");
    expect(r.raw).toBe("fix the flaky test");
  });
  it("expands an 'add' goal", () => {
    const r = refineGoal("add a health check endpoint");
    expect(r.intent).toBe("add");
    expect(r.refined).toContain("Add a health check endpoint");
    expect(r.refined).toContain("Done when");
  });
  it("expands a 'refactor' goal with a preserve-behavior guardrail", () => {
    const r = refineGoal("refactor the api");
    expect(r.refined).toContain("Refactor the api");
    expect(r.refined).toContain("Preserve all existing behavior");
  });
  it("expands a 'secure' goal", () => {
    const r = refineGoal("secure the auth endpoints");
    expect(r.refined).toContain("Secure the auth endpoints");
  });
  it("falls back to a generic structure when no intent matches", () => {
    const r = refineGoal("login form");
    expect(r.intent).toBeNull();
    // Fallback still produces a structured goal with a done-condition.
    expect(r.refined).toContain("login form");
    expect(r.refined).toContain("Done when");
  });
  it("capitalizes the leading verb in the refined output", () => {
    const r = refineGoal("fix the bug");
    // Template capitalizes the verb ("Fix"); body keeps original case.
    expect(r.refined).toMatch(/^Fix the bug/);
  });
  it("is idempotent: already-structured input passes through cleanly", () => {
    const structured = "Fix the bug. Done when the test passes.";
    const r = refineGoal(structured);
    // Shouldn't double-wrap or mangle — still contains the original + a done-condition.
    expect(r.refined).toContain("Fix the bug");
    expect(r.refined).toContain("Done when");
  });
  it("handles empty/whitespace input gracefully", () => {
    const r = refineGoal("   ");
    expect(r.intent).toBeNull();
    // Never throws — produces something usable.
    expect(r.refined.length).toBeGreaterThan(0);
  });
  it("trims and collapses whitespace", () => {
    const r = refineGoal("  fix   the   bug  ");
    expect(r.refined).toContain("Fix the bug");
    expect(r.refined).not.toContain("  "); // no double spaces in the goal portion
  });
  it("INTENTS covers the documented set", () => {
    expect(INTENTS.map((i) => i.name).sort()).toEqual(
      ["add", "clean", "document", "fix", "implement", "improve", "refactor", "secure", "test"]
    );
  });
  it("every intent produces output containing 'Done when'", () => {
    for (const intent of INTENTS) {
      const r = refineGoal(`${intent.name} something`);
      expect(r.refined).toContain("Done when");
    }
  });
});
