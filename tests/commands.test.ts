import { describe, it, expect } from "vitest";
import { parseCommand, resolveTemplate } from "../src/commands/loader.js";

describe("parseCommand", () => {
  it("should parse slash commands", () => {
    const result = parseCommand("/test src/");
    expect(result.name).toBe("test");
    expect(result.args).toEqual(["src/"]);
  });

  it("should parse commands with multiple args", () => {
    const result = parseCommand("/fix src/index.ts src/utils.ts");
    expect(result.name).toBe("fix");
    expect(result.args).toEqual(["src/index.ts", "src/utils.ts"]);
  });

  it("should handle non-command input", () => {
    const result = parseCommand("hello world");
    expect(result.name).toBe("");
    expect(result.args).toEqual(["hello world"]);
  });

  it("should handle bare slash", () => {
    const result = parseCommand("/");
    expect(result.name).toBe("");
    expect(result.args).toEqual([]);
  });
});

describe("resolveTemplate", () => {
  it("should replace $ARGUMENTS", () => {
    const result = resolveTemplate("Run tests in $ARGUMENTS", ["src/", "--watch"]);
    expect(result).toBe("Run tests in src/ --watch");
  });

  it("should replace positional args", () => {
    const result = resolveTemplate("Fix $1 in $2", ["index.ts", "src/"]);
    expect(result).toBe("Fix index.ts in src/");
  });

  it("should replace mixed args", () => {
    const result = resolveTemplate("Run $1 with $ARGUMENTS", ["build", "--verbose"]);
    expect(result).toBe("Run build with build --verbose");
  });
});
