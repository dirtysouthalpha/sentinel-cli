import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../src/skills/loader.js";

describe("parseFrontmatter", () => {
  it("should parse frontmatter and body", () => {
    const content = `---
name: test-skill
description: A test skill
permissions:
  edit: allow
---

This is the body content.`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe("test-skill");
    expect(result.frontmatter.description).toBe("A test skill");
    expect(result.body.trim()).toBe("This is the body content.");
  });

  it("should handle content without frontmatter", () => {
    const content = "Just a body without frontmatter.";
    const result = parseFrontmatter(content);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe("Just a body without frontmatter.");
  });
});
