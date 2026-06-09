import { describe, it, expect } from "vitest";
import { loadAttachment, isImagePath, mimeForPath, toImageContentPart } from "../src/core/attachments.js";

const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic

describe("attachments", () => {
  it("detects image paths + mime types", () => {
    expect(isImagePath("a/b/c.png")).toBe(true);
    expect(isImagePath("photo.JPEG")).toBe(true);
    expect(isImagePath("notes.txt")).toBe(false);
    expect(mimeForPath("x.webp")).toBe("image/webp");
    expect(mimeForPath("x.txt")).toBe("application/octet-stream");
  });

  it("loads an image into a base64 data URL via injected reader", () => {
    const att = loadAttachment("pic.png", { read: () => fakePng });
    expect(att.mimeType).toBe("image/png");
    expect(att.name).toBe("pic.png");
    expect(att.bytes).toBe(fakePng.length);
    expect(att.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(att.dataUrl).toContain(fakePng.toString("base64"));
  });

  it("rejects unsupported types and oversize files", () => {
    expect(() => loadAttachment("notes.txt", { read: () => fakePng })).toThrow(/Unsupported/);
    expect(() => loadAttachment("big.png", { read: () => fakePng, maxBytes: 4 })).toThrow(/limit/);
  });

  it("surfaces read errors", () => {
    expect(() =>
      loadAttachment("missing.png", {
        read: () => {
          throw new Error("ENOENT");
        },
      })
    ).toThrow(/Cannot read attachment/);
  });

  it("builds an OpenAI image content part", () => {
    const att = loadAttachment("pic.png", { read: () => fakePng });
    const part = toImageContentPart(att);
    expect(part.type).toBe("image_url");
    expect(part.image_url.url).toBe(att.dataUrl);
  });
});
