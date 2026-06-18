/**
 * GUI markdown renderer — HTML surface that shares block segmentation with the
 * TUI (Blessed) renderer via `parseMarkdownBlocks` in the CLI's `src/core`.
 *
 * Produces safe, escaped HTML with:
 *   - fenced code blocks, syntax-highlighted via highlight.js, each with a
 *     language label + copy button,
 *   - standalone unified-diff runs colorized green/red,
 *   - prose blocks with headings, lists, bold/italic, inline `code`, and links.
 *
 * Two entry points:
 *   - `renderMarkdownHTML(text)`   full render, used once streaming completes.
 *   - `renderStreamingHTML(text)`  cheaper render for live token streams: code
 *     blocks are highlighted, but prose is kept to a light pass to stay cheap
 *     and flicker-free (full reflow happens at stream_end).
 */
import { parseMarkdownBlocks, type MarkdownBlock } from "../../src/core/markdown";
import hljs from "highlight.js/lib/common";

// ---- escaping ---------------------------------------------------------------
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Highlight a code block to HTML, falling back to a plain escaped <code>. */
function highlight(lang: string, code: string): string {
  const trimmed = lang.trim().toLowerCase();
  try {
    if (trimmed && hljs.getLanguage(trimmed)) {
      return hljs.highlight(code, { language: trimmed, ignoreIllegals: true }).value;
    }
    return hljs.highlightAuto(code).value;
  } catch {
    return esc(code);
  }
}

/** Render a fenced code block to HTML (highlighted + copy button). */
function renderCodeBlock(b: Extract<MarkdownBlock, { kind: "code" }>): string {
  const code = b.lines.join("\n");
  const lang = b.lang || "code";
  const cls = b.complete ? "" : " incomplete";
  // A data attribute carries the raw code for the copy button (avoids re-parsing DOM).
  return (
    `<div class="md-code${cls}">` +
    `<div class="md-code-bar"><span class="md-code-lang">${esc(lang)}</span>` +
    `<button class="md-copy" data-copy>copy</button></div>` +
    `<pre><code class="hljs language-${esc(b.lang)}">${highlight(b.lang, code)}</code></pre>` +
    `</div>`
  );
}

/** Render a unified-diff run to colorized HTML. */
function renderDiffBlock(b: Extract<MarkdownBlock, { kind: "diff" }>): string {
  let out = `<div class="md-diff">`;
  for (const line of b.lines) {
    let cls = "ctx";
    if (line.startsWith("@@")) { cls = "hunk"; }
    else if (line.startsWith("+")) { cls = "add"; }
    else if (line.startsWith("-")) { cls = "del"; }
    out += `<div class="md-diff-ln ${cls}">${esc(line)}</div>`;
  }
  return out + `</div>`;
}

// ---- prose inline markdown --------------------------------------------------
/**
 * Format a single prose line into HTML. Handles inline `code`, bold (** / __),
 * italic (* / _), and autolinks ([text](url) and bare URLs). Order matters: we
 * tokenize so inline-code spans are protected before other transforms run.
 */
function renderInline(raw: string): string {
  let s = esc(raw);
  // Protect inline code spans first by stashing them.
  const codes: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_m, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  // Bold.
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  // Strikethrough (~~x~~).
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  // Italic (single * or _ not part of bold).
  s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_])_([^_\s][^_]*?)_/g, "$1<em>$2</em>");
  // Markdown links [text](url) — url must be http(s)/relative; javascript: stripped.
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, url) => {
    return `<a href="${safeHref(url)}" target="_blank" rel="noreferrer noopener">${text}</a>`;
  });
  // Bare autolinks.
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s)<]+)/g, (_m, lead, url) => {
    const bare = url.replace(/[.,;:!?)]$/, "");
    return `${lead}<a href="${bare}" target="_blank" rel="noreferrer noopener">${bare}</a>`;
  });
  // Restore inline code spans.
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i) => `<code class="md-ic">${codes[Number(i)]}</code>`);
  return s;
}

/** Allow only http(s) and relative hrefs; block javascript:/data: schemes. */
function safeHref(url: string): string {
  const u = url.trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (/^[/#]/.test(u)) return u;
  return "#";
}

/**
 * Render a prose block to HTML. Handles fenced structure within prose: ATX
 * headings (# .. ######), bullet lists (-, *, +), ordered lists (1.), block
 * quotes (>), and hard rule (---/***). Blank lines separate paragraphs.
 */
function renderProseBlock(b: Extract<MarkdownBlock, { kind: "prose" }>): string {
  const lines = b.text.split("\n");
  const html: string[] = [];
  let i = 0;
  let para: string[] = [];

  const flushPara = (): void => {
    if (para.length) {
      const joined = para.join(" ");
      html.push(`<p>${renderInline(joined)}</p>`);
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Hard rule.
    if (/^(\s*[-*_]\s*){3,}$/.test(trimmed) && trimmed.length >= 3) {
      flushPara();
      html.push(`<hr/>`);
      i++;
      continue;
    }
    // ATX heading.
    const h = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (h) {
      flushPara();
      const level = h[1].length;
      html.push(`<h${level}>${renderInline(h[2].trim())}</h${level}>`);
      i++;
      continue;
    }
    // Block quote: collect consecutive '>' lines.
    if (/^>\s?/.test(trimmed)) {
      flushPara();
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quote.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      html.push(`<blockquote>${renderProseBlock({ kind: "prose", text: quote.join("\n") })}</blockquote>`);
      continue;
    }
    // Bullet list (-, *, +).
    if (/^\s*[-*+]\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      html.push(`<ul>${items.map((it) => `<li>${renderInline(it)}</li>`).join("")}</ul>`);
      continue;
    }
    // Ordered list (N.).
    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      html.push(`<ol>${items.map((it) => `<li>${renderInline(it)}</li>`).join("")}</ol>`);
      continue;
    }
    // Blank line -> paragraph break.
    if (trimmed === "") {
      flushPara();
      i++;
      continue;
    }
    para.push(trimmed);
    i++;
  }
  flushPara();

  return html.join("");
}

function renderBlockHTML(block: MarkdownBlock, full: boolean): string {
  switch (block.kind) {
    case "code":
      return full ? renderCodeBlock(block) : renderCodeBlockStreaming(block);
    case "diff":
      return renderDiffBlock(block);
    case "prose":
      return renderProseBlock(block);
    case "heading":
      return `<h${block.level}>${renderInline(block.text)}</h${block.level}>`;
    case "hr":
      return `<hr/>`;
    case "table":
      return renderTableBlock(block);
    case "tasklist":
      return (
        `<ul class="md-tasklist">` +
        block.items
          .map(
            (it) =>
              `<li><input type="checkbox" disabled${it.checked ? " checked" : ""}> ${renderInline(it.text)}</li>`
          )
          .join("") +
        `</ul>`
      );
    case "list":
      return `<ul>${block.items.map((it) => `<li>${renderInline(it)}</li>`).join("")}</ul>`;
  }
}

/** Render a GFM table block (header + alignment + rows) to an HTML table. */
function renderTableBlock(b: Extract<MarkdownBlock, { kind: "table" }>): string {
  const cell = (c: string, tag: string, align?: string): string =>
    `<${tag}${align ? ` style="text-align:${align}"` : ""}>${renderInline(c)}</${tag}>`;
  const head = b.header.map((c, i) => cell(c, "th", b.align[i])).join("");
  const body = b.rows
    .map((row) => `<tr>${row.map((c, i) => cell(c, "td", b.align[i])).join("")}</tr>`)
    .join("");
  return `<div class="md-table-wrap"><table class="md-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** Streaming variant: highlight code but no copy bar (final bar added at end). */
function renderCodeBlockStreaming(b: Extract<MarkdownBlock, { kind: "code" }>): string {
  const code = b.lines.join("\n");
  const lang = b.lang || "code";
  const badge = `<div class="md-code-stream-bar"><span class="md-code-lang">${esc(lang)}</span></div>`;
  return (
    `<div class="md-code${b.complete ? "" : " streaming"}">` +
    (b.complete ? "" : badge) +
    `<pre><code class="hljs language-${esc(b.lang)}">${highlight(b.lang, code)}</code></pre>` +
    `</div>`
  );
}

/** Full markdown -> HTML. Used once a message is complete. */
export function renderMarkdownHTML(text: string): string {
  if (!text) return "";
  return parseMarkdownBlocks(text).map((b) => renderBlockHTML(b, true)).join("");
}

/**
 * Cheaper render for live token streams. Renders structural blocks (so code is
 * still highlighted live) but keeps prose formatting light to limit per-token
 * cost; the message is fully re-rendered at stream_end via renderMarkdownHTML.
 */
export function renderStreamingHTML(text: string): string {
  if (!text) return "";
  return parseMarkdownBlocks(text).map((b) => renderBlockHTML(b, false)).join("");
}
