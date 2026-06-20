/**
 * Lightweight syntax highlighting for the TUI — no deps, regex per language.
 *
 * Tokenizes code into {type, text} spans for the blessed tag renderer. Supports
 * ts/js, py, bash, json. Keeps each language under ~10 lines of regex. The
 * render-markdown module calls this inside code blocks.
 */

export type TokenType = "keyword" | "string" | "comment" | "number" | "function" | "plain";

export interface Token {
  type: TokenType;
  text: string;
}

const TS_KEYWORDS = /\b(const|let|var|function|return|if|else|for|while|class|extends|implements|interface|type|enum|import|export|from|default|async|await|new|try|catch|finally|throw|typeof|instanceof|in|of|void|delete|switch|case|break|continue|this|super|public|private|readonly|static|get|set|yield|namespace|declare|abstract|as|is)\b/;
const PY_KEYWORDS = /\b(def|class|return|if|elif|else|for|while|import|from|as|try|except|finally|with|raise|yield|lambda|pass|break|continue|global|nonlocal|assert|del|in|not|and|or|is|None|True|False|self)\b/;
const BASH_KEYWORDS = /\b(if|then|else|elif|fi|for|while|do|done|case|esac|function|return|export|local|echo|printf|read|cd|exit|source|alias|unalias|set|unset)\b/;

const PATTERNS: Record<string, { kw: RegExp; comment: string; str: RegExp }> = {
  typescript: { kw: TS_KEYWORDS, comment: "//", str: /(["'`])/ },
  javascript: { kw: TS_KEYWORDS, comment: "//", str: /(["'`])/ },
  ts: { kw: TS_KEYWORDS, comment: "//", str: /(["'`])/ },
  js: { kw: TS_KEYWORDS, comment: "//", str: /(["'`])/ },
  python: { kw: PY_KEYWORDS, comment: "#", str: /(["'])/ },
  py: { kw: PY_KEYWORDS, comment: "#", str: /(["'])/ },
  bash: { kw: BASH_KEYWORDS, comment: "#", str: /(["'])/ },
  sh: { kw: BASH_KEYWORDS, comment: "#", str: /(["'])/ },
  json: { kw: /\b(true|false|null)\b/, comment: "", str: /(")/ },
};

/** Tokenize a single line of code for the given language. */
export function tokenizeLine(line: string, lang: string): Token[] {
  const pat = PATTERNS[lang] ?? PATTERNS.typescript;
  const tokens: Token[] = [];
  let i = 0;

  while (i < line.length) {
    const rest = line.slice(i);

    // Comment to end of line.
    if (pat.comment && rest.startsWith(pat.comment)) {
      tokens.push({ type: "comment", text: rest });
      break;
    }

    // String literal.
    const strMatch = rest.match(pat.str);
    if (strMatch && rest.indexOf(strMatch[0]) === 0) {
      const quote = strMatch[0];
      const end = rest.indexOf(quote, 1);
      const strEnd = end === -1 ? rest.length : end + 1;
      tokens.push({ type: "string", text: rest.slice(0, strEnd) });
      i += strEnd;
      continue;
    }

    // Number.
    const numMatch = rest.match(/^\d+\.?\d*/);
    if (numMatch) {
      tokens.push({ type: "number", text: numMatch[0] });
      i += numMatch[0].length;
      continue;
    }

    // Keyword.
    const kwMatch = rest.match(pat.kw);
    if (kwMatch && rest.indexOf(kwMatch[0]) === 0) {
      // Check word boundary.
      const afterIdx = kwMatch[0].length;
      const afterChar = rest[afterIdx];
      if (!afterChar || /[\s;,.()\[\]{}:=+\-*/<>!&|?]/.test(afterChar)) {
        tokens.push({ type: "keyword", text: kwMatch[0] });
        i += kwMatch[0].length;
        continue;
      }
    }

    // Function call: word followed by '('.
    const fnMatch = rest.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/);
    if (fnMatch) {
      tokens.push({ type: "function", text: fnMatch[1] });
      i += fnMatch[1].length;
      continue;
    }

    // Plain text — accumulate a run of non-interesting chars. If the current
    // char IS a letter but didn't match keyword/function, consume the whole
    // word so we don't emit per-char tokens.
    const wordRun = rest.match(/^[a-zA-Z_$][a-zA-Z0-9_$]*/);
    if (wordRun && wordRun[0].length > 0) {
      tokens.push({ type: "plain", text: wordRun[0] });
      i += wordRun[0].length;
      continue;
    }

    // Non-letter plain char — accumulate until next interesting position.
    let nextStop = rest.length;
    if (pat.comment) { const c = rest.indexOf(pat.comment); if (c !== -1) nextStop = Math.min(nextStop, c); }
    const s = rest.search(pat.str); if (s !== -1) nextStop = Math.min(nextStop, s);
    const n = rest.search(/\d/); if (n !== -1) nextStop = Math.min(nextStop, n);
    const w = rest.search(/[a-zA-Z_$]/); if (w !== -1) nextStop = Math.min(nextStop, w);

    if (nextStop === 0) nextStop = 1; // always advance
    tokens.push({ type: "plain", text: rest.slice(0, nextStop) });
    i += nextStop;
  }

  return tokens;
}
