import { describe, it, expect } from "vitest";
import { attachmentFromDataUrl, extractImageMentions } from "../src/core/attachments.js";

// "hello" in base64
const HELLO_B64 = "aGVsbG8=";
const HELLO_DATAURL = `data:image/png;base64,${HELLO_B64}`;

describe("attachmentFromDataUrl — GUI paste path (pure)", () => {
  it("parses a well-formed data URL", () => {
    const att = attachmentFromDataUrl(HELLO_DATAURL, { name: "shot.png" });
    expect(att.mimeType).toBe("image/png");
    expect(att.name).toBe("shot.png");
    expect(att.bytes).toBe(5); // "hello" is 5 bytes
    expect(att.dataUrl).toBe(HELLO_DATAURL);
  });

  it("accepts bare base64 with an explicit mime", () => {
    const att = attachmentFromDataUrl(HELLO_B64, { mimeType: "image/jpeg" });
    expect(att.mimeType).toBe("image/jpeg");
    expect(att.name).toBe("pasted-image.jpg");
    // Canonical data URL emitted.
    expect(att.dataUrl).toBe(`data:image/jpeg;base64,${HELLO_B64}`);
  });

  it("rejects bare base64 with no mime hint", () => {
    expect(() => attachmentFromDataUrl(HELLO_B64)).toThrow(/requires opts.mimeType/);
  });

  it("rejects a non-image mime type", () => {
    expect(() =>
      attachmentFromDataUrl("data:text/plain;base64,aGVsbG8=")
    ).toThrow(/not an image mime/);
  });

  it("rejects malformed data URLs", () => {
    expect(() => attachmentFromDataUrl("not-a-data-url")).toThrow(/requires opts.mimeType|bad base64/);
  });

  it("picks a sensible extension from mime for the default name", () => {
    expect(attachmentFromDataUrl(HELLO_DATAURL).name).toBe("pasted-image.png");
    expect(
      attachmentFromDataUrl("data:image/webp;base64,aGVsbG8=").name
    ).toBe("pasted-image.webp");
  });
});

describe("extractImageMentions — D2 TUI path (pure)", () => {
  it("extracts image @-mentions and strips them from the text", () => {
    const { mentions, stripped } = extractImageMentions("look at @shot.png and explain");
    expect(mentions).toEqual(["shot.png"]);
    expect(stripped).toBe("look at  and explain");
  });

  it("leaves non-image mentions intact for expandMentions", () => {
    const { mentions, stripped } = extractImageMentions("read @notes.md and @photo.jpg");
    expect(mentions).toEqual(["photo.jpg"]);
    expect(stripped).toContain("@notes.md");
    expect(stripped).not.toContain("@photo.jpg");
  });

  it("dedupes repeated image mentions", () => {
    const { mentions } = extractImageMentions("@a.png @b.png @a.png");
    expect(mentions).toEqual(["a.png", "b.png"]);
  });

  it("strips trailing punctuation from the mention", () => {
    const { mentions } = extractImageMentions("see @shot.png.");
    expect(mentions).toEqual(["shot.png"]);
  });

  it("returns no mentions for a plain message", () => {
    const { mentions, stripped } = extractImageMentions("just a normal message");
    expect(mentions).toEqual([]);
    expect(stripped).toBe("just a normal message");
  });

  it("handles multiple image extensions", () => {
    const { mentions } = extractImageMentions("@a.png @b.jpg @c.gif @d.webp @e.bmp");
    expect(mentions).toEqual(["a.png", "b.jpg", "c.gif", "d.webp", "e.bmp"]);
  });
});
