/**
 * Secret redaction (V16 safety groundwork). A pure utility for masking credentials
 * in text before it's logged, shown, or sent off-box. Conservative patterns to keep
 * false positives low; masks the value while leaving a short prefix for debugging.
 *
 * Not wired into the pipeline yet — call `redact()` at log/transcript/tool-output
 * boundaries when V16 lands.
 */

export interface RedactPattern {
  name: string;
  re: RegExp;
}

/** Mask a token: keep a short prefix, replace the rest with •. */
function mask(token: string, keep = 4): string {
  if (token.length <= keep) return "•".repeat(token.length);
  return token.slice(0, keep) + "•".repeat(Math.max(4, token.length - keep));
}

// Order matters: more specific provider tokens first, generic assignments last.
export const REDACT_PATTERNS: RedactPattern[] = [
  { name: "openai", re: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { name: "anthropic", re: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g },
  { name: "composio", re: /\b(?:u?ak)_[A-Za-z0-9]{12,}\b/g },
  { name: "github", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: "aws", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "google", re: /\bAIza[0-9A-Za-z_-]{20,}\b/g },
  { name: "slack", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "bearer", re: /\bBearer\s+[A-Za-z0-9._-]{12,}/g },
  // Generic `KEY=value` / `"key": "value"` for *_KEY / *_TOKEN / *_SECRET / PASSWORD
  // (key may be quoted, e.g. JSON). Groups: 1=keyQuote 2=key 3=sep 4=valQuote 5=value.
  {
    name: "assignment",
    re: /(["']?)([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD))\1(\s*[:=]\s*)(["']?)([^\s"']{6,})\4/gi,
  },
];

/** Redact known secret shapes from a string. Returns the text with values masked. */
export function redact(text: string): string {
  if (!text) return text;
  let out = text;
  for (const { re, name } of REDACT_PATTERNS) {
    re.lastIndex = 0;
    if (name === "bearer") {
      out = out.replace(re, (m) => `Bearer ${mask(m.slice(7).trim())}`);
    } else if (name === "assignment") {
      out = out.replace(re, (_m, _kq: string, key: string, sep: string, q: string, val: string) => `${key}${sep}${q}${mask(val)}${q}`);
    } else {
      out = out.replace(re, (m) => mask(m));
    }
  }
  return out;
}

/** True if the text appears to contain a secret (useful for warnings/gates). */
export function containsSecret(text: string): boolean {
  if (!text) return false;
  return REDACT_PATTERNS.some(({ re }) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}
