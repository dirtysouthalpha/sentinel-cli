import { describe, it, expect } from "vitest";
import { resolveRole, route, RouterConfig } from "../src/ai/router.js";

describe("resolveRole", () => {
  it("resolves a role to its model + fallback + default backstop, in order", () => {
    const cfg: RouterConfig = {
      default: "zai/glm-4.6",
      roles: {
        plan: { model: "openai/o3", fallback: ["anthropic/claude"] },
      },
    };
    expect(resolveRole(cfg, "plan")).toEqual([
      "openai/o3",
      "anthropic/claude",
      "zai/glm-4.6",
    ]);
  });

  it("resolves a role with no fallback to [model, default]", () => {
    const cfg: RouterConfig = {
      default: "zai/glm-4.6",
      roles: {
        smol: { model: "openai/gpt-4o-mini" },
      },
    };
    expect(resolveRole(cfg, "smol")).toEqual(["openai/gpt-4o-mini", "zai/glm-4.6"]);
  });

  it("unknown role falls back to [default]", () => {
    const cfg: RouterConfig = {
      default: "zai/glm-4.6",
      roles: {
        plan: { model: "openai/o3" },
      },
    };
    expect(resolveRole(cfg, "commit")).toEqual(["zai/glm-4.6"]);
  });

  it("absent roles config falls back to [default] (unchanged behavior)", () => {
    const cfg: RouterConfig = { default: "zai/glm-4.6" };
    expect(resolveRole(cfg, "plan")).toEqual(["zai/glm-4.6"]);
    expect(resolveRole(cfg, "default")).toEqual(["zai/glm-4.6"]);
  });

  it("preserves fallback ordering", () => {
    const cfg: RouterConfig = {
      default: "zai/glm-4.6",
      roles: {
        plan: {
          model: "openai/o3",
          fallback: ["anthropic/claude", "ollama/llama3", "zai/glm-4.5"],
        },
      },
    };
    expect(resolveRole(cfg, "plan")).toEqual([
      "openai/o3",
      "anthropic/claude",
      "ollama/llama3",
      "zai/glm-4.5",
      "zai/glm-4.6",
    ]);
  });

  it("de-duplicates targets, keeping first occurrence (default already in chain)", () => {
    const cfg: RouterConfig = {
      default: "zai/glm-4.6",
      roles: {
        // model and a fallback both equal to the default -> default appears once, in place
        plan: { model: "openai/o3", fallback: ["zai/glm-4.6", "anthropic/claude"] },
      },
    };
    expect(resolveRole(cfg, "plan")).toEqual([
      "openai/o3",
      "zai/glm-4.6",
      "anthropic/claude",
    ]);
  });

  it("a role whose model IS the default resolves to just [default]", () => {
    const cfg: RouterConfig = {
      default: "zai/glm-4.6",
      roles: {
        default: { model: "zai/glm-4.6" },
      },
    };
    expect(resolveRole(cfg, "default")).toEqual(["zai/glm-4.6"]);
  });
});

describe("route (unchanged when roles present)", () => {
  it("ignores roles and continues to use rules/default", () => {
    const cfg: RouterConfig = {
      default: "anthropic/claude",
      roles: { plan: { model: "openai/o3" } },
      rules: [{ match: { taskKind: "code" }, use: "openai/gpt-code" }],
    };
    // roles must not leak into rule-based routing
    expect(route(cfg, { taskKind: "code" }, () => true)).toEqual(["openai/gpt-code"]);
    expect(route(cfg, { taskKind: "chat" }, () => true)).toEqual(["anthropic/claude"]);
  });
});
