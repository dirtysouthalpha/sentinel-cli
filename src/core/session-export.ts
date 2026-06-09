/**
 * Pure, singleton-free helpers for exporting a session transcript to Markdown or
 * HTML. They take a plain messages array so they stay trivially testable.
 */

export interface ExportMessage {
  role: string;
  content: string;
}

export interface ExportOptions {
  title: string;
  messages: ExportMessage[];
}

function roleHeader(role: string): string {
  switch (role) {
    case "user":
      return "You";
    case "assistant":
      return "Sentinel";
    case "system":
      return "System";
    case "tool":
      return "Tool";
    default:
      return role.charAt(0).toUpperCase() + role.slice(1);
  }
}

/**
 * Render a conversation as a clean Markdown transcript: an H1 title followed by,
 * per message, a bold role header and the message content. Empty messages are
 * skipped.
 */
export function exportSessionMarkdown(opts: ExportOptions): string {
  const parts: string[] = [`# ${opts.title}`];

  for (const msg of opts.messages) {
    const content = (msg.content ?? "").trim();
    if (!content) continue;
    parts.push(`**${roleHeader(msg.role)}**\n\n${content}`);
  }

  return parts.join("\n\n") + "\n";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Render the same transcript wrapped in minimal, self-contained HTML. All
 * user-supplied text (title, role, content) is HTML-escaped. Empty messages are
 * skipped.
 */
export function exportSessionHtml(opts: ExportOptions): string {
  const body: string[] = [`<h1>${escapeHtml(opts.title)}</h1>`];

  for (const msg of opts.messages) {
    const content = (msg.content ?? "").trim();
    if (!content) continue;
    body.push(
      `<div class="message ${escapeHtml(msg.role)}">\n` +
        `<p class="role"><strong>${escapeHtml(roleHeader(msg.role))}</strong></p>\n` +
        `<pre>${escapeHtml(content)}</pre>\n` +
        `</div>`
    );
  }

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeHtml(opts.title)}</title>`,
    "<style>",
    "body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }",
    ".message { margin-bottom: 1.5rem; }",
    ".role { margin: 0 0 0.25rem; }",
    "pre { white-space: pre-wrap; word-wrap: break-word; margin: 0; }",
    "</style>",
    "</head>",
    "<body>",
    body.join("\n"),
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
