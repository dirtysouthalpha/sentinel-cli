import { describe, it, expect } from "vitest";
import { exportSessionMarkdown, exportSessionHtml } from "../src/core/session-export.js";

describe("exportSessionMarkdown", () => {
  it("renders an H1 title and bold role headers with content", () => {
    const md = exportSessionMarkdown({
      title: "My Session",
      messages: [
        { role: "user", content: "Hello there" },
        { role: "assistant", content: "Hi, how can I help?" },
      ],
    });

    expect(md.startsWith("# My Session")).toBe(true);
    expect(md).toContain("**You**");
    expect(md).toContain("Hello there");
    expect(md).toContain("**Sentinel**");
    expect(md).toContain("Hi, how can I help?");
    // Role header appears before its content.
    expect(md.indexOf("**You**")).toBeLessThan(md.indexOf("Hello there"));
  });

  it("skips empty / whitespace-only messages", () => {
    const md = exportSessionMarkdown({
      title: "T",
      messages: [
        { role: "user", content: "kept" },
        { role: "assistant", content: "" },
        { role: "tool", content: "   " },
      ],
    });

    expect(md).toContain("kept");
    expect(md).not.toContain("**Sentinel**");
    expect(md).not.toContain("**Tool**");
  });

  it("maps unknown roles to a capitalized header", () => {
    const md = exportSessionMarkdown({
      title: "T",
      messages: [{ role: "developer", content: "x" }],
    });
    expect(md).toContain("**Developer**");
  });
});

describe("exportSessionHtml", () => {
  it("wraps the transcript in a full HTML document", () => {
    const html = exportSessionHtml({
      title: "Doc",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>Doc</title>");
    expect(html).toContain("<h1>Doc</h1>");
    expect(html).toContain("<strong>You</strong>");
    expect(html).toContain("hi");
    expect(html).toContain("</html>");
  });

  it("escapes <, > and & in title and content", () => {
    const html = exportSessionHtml({
      title: "a & <b>",
      messages: [{ role: "user", content: "1 < 2 && 3 > 2 <script>" }],
    });

    expect(html).toContain("a &amp; &lt;b&gt;");
    expect(html).toContain("1 &lt; 2 &amp;&amp; 3 &gt; 2 &lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("skips empty messages", () => {
    const html = exportSessionHtml({
      title: "T",
      messages: [
        { role: "user", content: "real" },
        { role: "assistant", content: "  " },
      ],
    });

    expect(html).toContain("real");
    expect(html).not.toContain("<strong>Sentinel</strong>");
  });
});
