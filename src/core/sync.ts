/**
 * V19 settings sync — a portable bundle export/import primitive (a local
 * "cloud sync" without the cloud). Gathers the global config, project skills,
 * and project workflows into a single JSON document that can be written, shared,
 * and re-applied on another machine / checkout.
 *
 * SECURITY: secrets never leave the box. `buildBundle` runs the config through
 * `redactConfig`, which (a) replaces any value under a secret-shaped key
 * (apiKey/token/secret/password/…) with "[REDACTED]" and (b) masks any inline
 * secret in remaining string values via the shared `redact()` util. Importing a
 * bundle never overwrites the global config — only skills + workflows are
 * restored; the (already-redacted) config is returned for the caller to inspect.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { redact } from "./redact.js";

/** Current bundle schema version. Bumped on incompatible shape changes. */
export const SYNC_BUNDLE_VERSION = 1;

export interface SyncBundle {
  version: number;
  exportedAt?: string;
  config?: unknown;
  skills?: Record<string, string>;
  workflows?: Record<string, unknown>;
}

/** Replaceable fs/clock hooks so the builder is fully testable. */
export interface BuildBundleOptions {
  /** Override the project root (defaults to the positional arg). */
  projectRoot?: string;
  /** Path to the global config JSON to bundle. Defaults to ~/.config/sentinel/config.json. */
  globalConfigPath?: string;
  exists?: (path: string) => boolean;
  readFile?: (path: string) => string;
  readDir?: (path: string) => string[];
  /** Returns the ISO timestamp stamped into the bundle. */
  now?: () => string;
}

export interface ReadBundleOptions {
  readFile?: (path: string) => string;
}

export interface ApplyBundleOptions {
  projectRoot?: string;
  writeFile?: (path: string, data: string) => void;
  mkdir?: (path: string) => void;
}

/** Keys whose string values are secrets and must never be exported verbatim. */
const SECRET_KEY_RE =
  /(api[-_]?key|apikey|access[-_]?key|token|secret|password|passwd|auth)/i;

/** Default location of the global config (mirrors core/config.ts's first path). */
export function defaultGlobalConfigPath(): string {
  return join(homedir(), ".config", "sentinel", "config.json");
}

/**
 * Deep-clone a parsed config with secrets stripped. Secret-shaped keys are
 * blanked entirely; every other string is run through redact() to catch inline
 * tokens. Pure (does not mutate the input).
 */
export function redactConfig(value: unknown): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(redactConfig);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(k) && typeof v === "string" && v.length > 0) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactConfig(v);
      }
    }
    return out;
  }
  return value;
}

/** Strip directory components so a malicious bundle can't escape .sentinel/. */
function safeFilename(name: string): string {
  return name.replace(/[\\/]/g, "_").replace(/\.\./g, "_");
}

/**
 * Build a portable bundle from the global config + project skills/workflows.
 * Tolerant of missing pieces: anything absent or unreadable is simply omitted.
 */
export function buildBundle(
  projectRoot: string,
  opts: BuildBundleOptions = {}
): SyncBundle {
  const root = opts.projectRoot ?? projectRoot;
  const exists = opts.exists ?? existsSync;
  const readFile = opts.readFile ?? ((p: string) => readFileSync(p, "utf-8"));
  const readDir = opts.readDir ?? ((p: string) => readdirSync(p));
  const globalConfigPath = opts.globalConfigPath ?? defaultGlobalConfigPath();
  const now = opts.now ?? (() => new Date().toISOString());

  const bundle: SyncBundle = {
    version: SYNC_BUNDLE_VERSION,
    exportedAt: now(),
  };

  // --- global config (redacted) ---
  if (exists(globalConfigPath)) {
    try {
      const parsed = JSON.parse(readFile(globalConfigPath));
      bundle.config = redactConfig(parsed);
    } catch {
      /* unreadable / invalid JSON — omit */
    }
  }

  // --- project skills (.sentinel/skills/*.md) ---
  const skillsDir = join(root, ".sentinel", "skills");
  if (exists(skillsDir)) {
    const skills: Record<string, string> = {};
    try {
      for (const name of readDir(skillsDir)) {
        if (!name.endsWith(".md")) continue;
        try {
          skills[name] = readFile(join(skillsDir, name));
        } catch {
          /* skip unreadable file */
        }
      }
    } catch {
      /* unreadable dir — omit */
    }
    if (Object.keys(skills).length > 0) bundle.skills = skills;
  }

  // --- project workflows (.sentinel/workflows/*.json) ---
  const wfDir = join(root, ".sentinel", "workflows");
  if (exists(wfDir)) {
    const workflows: Record<string, unknown> = {};
    try {
      for (const name of readDir(wfDir)) {
        if (!name.endsWith(".json")) continue;
        try {
          workflows[name] = JSON.parse(readFile(join(wfDir, name)));
        } catch {
          /* skip invalid JSON */
        }
      }
    } catch {
      /* unreadable dir — omit */
    }
    if (Object.keys(workflows).length > 0) bundle.workflows = workflows;
  }

  return bundle;
}

/** Write a bundle to disk as pretty JSON. */
export function writeBundle(path: string, bundle: SyncBundle): void {
  writeFileSync(path, JSON.stringify(bundle, null, 2), "utf-8");
}

/** Read + validate a bundle from disk. Throws on missing/unsupported version. */
export function readBundle(path: string, opts: ReadBundleOptions = {}): SyncBundle {
  const readFile = opts.readFile ?? ((p: string) => readFileSync(p, "utf-8"));
  let parsed: SyncBundle;
  try {
    parsed = JSON.parse(readFile(path)) as SyncBundle;
  } catch (err) {
    throw new Error(
      `Invalid sync bundle: not valid JSON (${err instanceof Error ? err.message : String(err)})`
    );
  }
  if (!parsed || typeof parsed !== "object" || typeof parsed.version !== "number") {
    throw new Error("Invalid sync bundle: missing numeric `version`.");
  }
  if (parsed.version > SYNC_BUNDLE_VERSION) {
    throw new Error(
      `Unsupported sync bundle version ${parsed.version} (this build supports up to ${SYNC_BUNDLE_VERSION}).`
    );
  }
  return parsed;
}

/**
 * Restore skills + workflows from a bundle into `<projectRoot>/.sentinel/`.
 * Does NOT touch the global config — callers decide what to do with
 * `bundle.config`. Returns a list of applied items (e.g. "skill: foo.md").
 */
export function applyBundle(
  projectRoot: string,
  bundle: SyncBundle,
  opts: ApplyBundleOptions = {}
): string[] {
  const root = opts.projectRoot ?? projectRoot;
  const writeFile =
    opts.writeFile ?? ((p: string, d: string) => writeFileSync(p, d, "utf-8"));
  const mkdir =
    opts.mkdir ?? ((p: string) => void mkdirSync(p, { recursive: true }));

  const applied: string[] = [];

  if (bundle.skills && Object.keys(bundle.skills).length > 0) {
    const dir = join(root, ".sentinel", "skills");
    mkdir(dir);
    for (const [name, content] of Object.entries(bundle.skills)) {
      if (typeof content !== "string") continue;
      const safe = safeFilename(name.endsWith(".md") ? name : `${name}.md`);
      writeFile(join(dir, safe), content);
      applied.push(`skill: ${safe}`);
    }
  }

  if (bundle.workflows && Object.keys(bundle.workflows).length > 0) {
    const dir = join(root, ".sentinel", "workflows");
    mkdir(dir);
    for (const [name, wf] of Object.entries(bundle.workflows)) {
      const safe = safeFilename(name.endsWith(".json") ? name : `${name}.json`);
      writeFile(join(dir, safe), JSON.stringify(wf, null, 2));
      applied.push(`workflow: ${safe}`);
    }
  }

  return applied;
}
