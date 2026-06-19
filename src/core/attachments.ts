import { readFileSync } from "node:fs";
import { extname, basename } from "node:path";

/**
 * Image/file attachments (V14 multimodal groundwork). Loads a local image into a
 * base64 data URL suitable for an OpenAI/Anthropic vision content block. Pure +
 * dependency-free; the file reader is injectable for tests. Not yet wired into the
 * message pipeline — the TUI/`run` paths can attach via `loadAttachment` when V14 lands.
 */

export interface Attachment {
  path: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  bytes: number;
}

export const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export function isImagePath(path: string): boolean {
  return extname(path).toLowerCase() in MIME_BY_EXT;
}

export function mimeForPath(path: string): string {
  return MIME_BY_EXT[extname(path).toLowerCase()] || "application/octet-stream";
}

export interface LoadAttachmentOptions {
  maxBytes?: number;
  /** Injectable reader for tests; returns the raw bytes. */
  read?: (path: string) => Buffer;
}

/** Load a local image file into an Attachment (base64 data URL). Throws on missing
 *  file, unsupported type, or oversize input. */
export function loadAttachment(path: string, opts: LoadAttachmentOptions = {}): Attachment {
  if (!isImagePath(path)) {
    throw new Error(`Unsupported attachment type: ${extname(path) || "(none)"} — supported: ${Object.keys(MIME_BY_EXT).join(", ")}`);
  }
  const read = opts.read ?? ((p: string) => readFileSync(p));
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  let buf: Buffer;
  try {
    buf = read(path);
  } catch (e) {
    throw new Error(`Cannot read attachment ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (buf.length > maxBytes) {
    throw new Error(`Attachment ${path} is ${buf.length} bytes (> ${maxBytes} limit)`);
  }

  const mimeType = mimeForPath(path);
  const dataUrl = `data:${mimeType};base64,${buf.toString("base64")}`;
  return { path, name: basename(path), mimeType, dataUrl, bytes: buf.length };
}

/** Build an OpenAI-style image content part from an attachment. */
export function toImageContentPart(att: Attachment): { type: "image_url"; image_url: { url: string } } {
  return { type: "image_url", image_url: { url: att.dataUrl } };
}

/**
 * Build an Attachment directly from a base64 data URL (e.g. from a paste event
 * in the GUI composer, where there's no file on disk). Pure + dependency-free.
 *
 * Accepts both `data:image/png;base64,xxxx` and bare base64 (with an explicit
 * mime hint). Throws on malformed input. This is the GUI paste path; the TUI
 * @-mention path uses loadAttachment (file on disk).
 */
export function attachmentFromDataUrl(
  dataUrl: string,
  opts: { name?: string; mimeType?: string } = {}
): Attachment {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  let mimeType: string;
  let base64: string;
  if (match) {
    mimeType = match[1];
    base64 = match[2];
  } else {
    // Bare base64 — caller must supply a mime type.
    if (!opts.mimeType) throw new Error("attachmentFromDataUrl: bare base64 requires opts.mimeType");
    mimeType = opts.mimeType;
    base64 = dataUrl.trim();
  }

  if (!mimeType.startsWith("image/")) {
    throw new Error(`attachmentFromDataUrl: not an image mime: ${mimeType}`);
  }

  const buf = Buffer.from(base64, "base64");
  if (buf.length === 0) throw new Error("attachmentFromDataUrl: decoded to zero bytes (bad base64?)");

  const ext = mimeToExt(mimeType);
  const name = opts.name ?? `pasted-image.${ext}`;
  // Re-emit a canonical data URL so downstream sees a consistent shape even
  // when bare base64 was passed in.
  const canonical = match ? dataUrl : `data:${mimeType};base64,${base64}`;

  return {
    path: name,
    name,
    mimeType,
    dataUrl: canonical,
    bytes: buf.length,
  };
}

/** Inverse of MIME_BY_EXT for picking a filename extension from a mime type. */
function mimeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/svg+xml": "svg",
  };
  return map[mimeType] ?? "img";
}

/**
 * Extract `@<image-path>` mentions from a message, returning the mentions and
 * the message with those mentions removed (so expandMentions doesn't try to
 * read a binary image as utf8 text). Pure — no file loading; the caller loads
 * each via loadAttachment and handles missing files.
 */
export function extractImageMentions(text: string): { mentions: string[]; stripped: string } {
  const mentions: string[] = [];
  const seen = new Set<string>();
  // Same mention regex as mentions.ts: start-or-whitespace + @ + non-space.
  const stripped = text.replace(/(^|\s)@(\S+)/g, (full, lead, token) => {
    const clean = token.replace(/[).,;:!?'"]+$/, "");
    if (clean && isImagePath(clean) && !seen.has(clean)) {
      seen.add(clean);
      mentions.push(clean);
      return lead; // drop the @mention, keep the leading whitespace
    }
    return full; // leave non-image mentions intact for expandMentions
  });
  return { mentions, stripped };
}
