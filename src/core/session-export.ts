/**
 * sessionToMarkdown — pure transcript-to-markdown formatter.
 *
 * Turns a conversation transcript into a clean markdown document the user can
 * save, share, or archive. Pure: no I/O — the caller writes the file.
 */

export interface ExportMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
}

export function sessionToMarkdown(messages: ExportMessage[]): string {
  const lines: string[] = ["# Sentinel Session", ""];
  for (const msg of messages) {
    if (msg.role === "user") {
      lines.push("## User", "");
      lines.push(msg.content || "(empty)");
      lines.push("");
    } else if (msg.role === "assistant") {
      if (msg.content.trim()) {
        lines.push("## Assistant", "");
        lines.push(msg.content);
        lines.push("");
      }
    } else if (msg.role === "tool") {
      lines.push("### Tool Result", "");
      lines.push("```");
      lines.push(msg.content.slice(0, 2000));
      lines.push("```");
      lines.push("");
    }
  }
  return lines.join("\n");
}

/** Alias for backward compat with session-commands.ts. Accepts { title, messages }. */
export function exportSessionMarkdown(input: ExportMessage[] | { title: string; messages: ExportMessage[] }): string {
  const msgs = Array.isArray(input) ? input : input.messages;
  const title = Array.isArray(input) ? "Sentinel Session" : input.title;
  const body = sessionToMarkdown(msgs);
  return body.replace("# Sentinel Session", `# ${title}`);
}

/** HTML export — wraps the markdown in a basic HTML shell. */
export function exportSessionHtml(input: ExportMessage[] | { title: string; messages: ExportMessage[] }): string {
  const md = exportSessionMarkdown(input);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sentinel Session</title></head><body><pre>${md.replace(/</g, "&lt;")}</pre></body></html>`;
}
