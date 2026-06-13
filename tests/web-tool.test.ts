import { describe, it, expect } from "vitest";
import { htmlToText } from "../src/tools/web.js";

describe("htmlToText", () => {
  it("strips tags and keeps readable text", () => {
    const html = "<html><body><h1>Title</h1><p>Hello <b>world</b>.</p></body></html>";
    const out = htmlToText(html);
    expect(out).not.toMatch(/</);
    expect(out).toMatch(/Title/);
    expect(out).toMatch(/Hello world\./);
  });

  it("drops script and style content entirely", () => {
    const html = `<style>.a{color:red}</style><script>alert('x')</script><p>kept</p>`;
    const out = htmlToText(html);
    expect(out).toContain("kept");
    expect(out).not.toMatch(/color:red/);
    expect(out).not.toMatch(/alert/);
  });

  it("decodes common entities", () => {
    expect(htmlToText("<p>a &amp; b &lt;c&gt; &quot;d&quot;</p>")).toBe('a & b <c> "d"');
  });

  it("turns block-level closes into line breaks", () => {
    const out = htmlToText("<li>one</li><li>two</li>");
    expect(out).toBe("one\ntwo");
  });
});
