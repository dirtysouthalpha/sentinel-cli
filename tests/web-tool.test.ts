import { describe, it, expect } from "vitest";
import { htmlToText, isBlockedHost, checkFetchUrl } from "../src/tools/web.js";

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

describe("web SSRF guard", () => {
  it("blocks loopback, private, and metadata hosts", () => {
    for (const h of ["localhost", "127.0.0.1", "0.0.0.0", "10.0.0.5", "192.168.1.1", "172.16.0.1", "169.254.169.254", "::1"]) {
      expect(isBlockedHost(h)).toBe(true);
    }
  });

  it("allows normal public hosts", () => {
    for (const h of ["example.com", "8.8.8.8", "api.github.com", "172.15.0.1", "172.32.0.1"]) {
      expect(isBlockedHost(h)).toBe(false);
    }
  });

  it("checkFetchUrl rejects non-http schemes and blocked hosts", () => {
    expect(checkFetchUrl("file:///etc/passwd")).toMatch(/scheme/i);
    expect(checkFetchUrl("http://169.254.169.254/latest/meta-data")).toMatch(/blocked host/i);
    expect(checkFetchUrl("not a url")).toMatch(/invalid url/i);
    expect(checkFetchUrl("https://example.com/docs")).toBeNull();
  });
});
