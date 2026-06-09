export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

export function indent(text: string, spaces: number = 2): string {
  const prefix = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line ? prefix + line : line))
    .join("\n");
}

export function wordWrap(text: string, width: number = 80): string {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.length <= width) {
      lines.push(paragraph);
      continue;
    }
    let line = "";
    for (const word of paragraph.split(" ")) {
      if (line.length + word.length + 1 > width) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) lines.push(line);
  }
  return lines.join("\n");
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString();
}

export function highlight(text: string, query: string, colorCode: string = "\x1b[33m"): string {
  if (!query) return text;
  const regex = new RegExp(`(${escapeRegex(query)})`, "gi");
  return text.replace(regex, `${colorCode}$1\x1b[0m`);
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

export function table(rows: string[][], headers?: string[]): string {
  if (!rows.length) return "";

  const allRows = headers ? [headers, ...rows] : rows;
  const colWidths = allRows[0].map((_, colIdx) =>
    Math.max(...allRows.map((row) => stripAnsi(row[colIdx] || "").length))
  );

  const lines = allRows.map((row, rowIdx) =>
    row.map((cell, colIdx) => {
      const stripped = stripAnsi(cell || "");
      const padding = " ".repeat(Math.max(0, colWidths[colIdx] - stripped.length));
      return `${cell}${padding}`;
    }).join("  ")
  );

  if (headers) {
    const separator = colWidths.map((w) => "─".repeat(w)).join("──");
    lines.splice(1, 0, separator);
  }

  return lines.join("\n");
}
