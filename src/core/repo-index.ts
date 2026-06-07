import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative, sep, extname } from "node:path";

/**
 * V11 — lite, dependency-free semantic repo index.
 *
 * Builds a TF-IDF model over source files (no external embeddings, no network)
 * and answers free-text queries with cosine-ish ranked results. The {@link RepoIndex}
 * is a plain serializable object so it can be stored/cached cheaply.
 */

/** A single indexed document. */
export interface IndexedDoc {
  /** Path relative to `projectRoot`, using forward slashes. */
  path: string;
  /** Per-term raw counts for this document. */
  terms: Record<string, number>;
  /** Total token count (used to length-normalise term frequencies). */
  length: number;
  /** First ~1KB of the file, kept for snippet generation. */
  head: string;
}

/** A serializable TF-IDF index over a repository. */
export interface RepoIndex {
  /** Absolute root the index was built from. */
  projectRoot: string;
  /** Indexed documents. */
  docs: IndexedDoc[];
  /** Global document frequency: term → number of docs containing it. */
  documentFrequency: Record<string, number>;
  /** Number of files actually indexed. */
  fileCount: number;
  /** True when the file cap was hit and the walk stopped early. */
  truncated: boolean;
}

/** Options for {@link buildIndex}. */
export interface BuildIndexOpts {
  /** File extensions to include (with leading dot). Defaults to a sane source list. */
  includeExtensions?: string[];
  /** Directory names to skip entirely. Merged with the built-in skip list. */
  skipDirs?: string[];
  /** Max bytes per file; larger files are skipped. Defaults to 256KB. */
  maxFileBytes?: number;
  /** Max number of files to index before truncating. Defaults to 2000. */
  maxFiles?: number;
  /** Max directory recursion depth. Defaults to 25. */
  maxDepth?: number;
}

/** A ranked search hit. */
export interface SearchResult {
  /** Path relative to `projectRoot` (forward slashes). */
  path: string;
  /** Relevance score (higher is better). */
  score: number;
  /** Short context snippet (first matching line, else file head). */
  snippet: string;
}

const DEFAULT_INCLUDE_EXTENSIONS = [
  ".ts",
  ".js",
  ".tsx",
  ".jsx",
  ".py",
  ".md",
  ".json",
  ".rs",
  ".go",
];

const DEFAULT_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".claude",
  "worktrees",
]);

const DEFAULT_MAX_FILE_BYTES = 256 * 1024;
const DEFAULT_MAX_FILES = 2000;
const DEFAULT_MAX_DEPTH = 25;
const HEAD_BYTES = 1024;

/** Lowercase + split on non-alphanumeric, dropping empties and 1-char noise. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 2) out.push(raw);
  }
  return out;
}

/** Normalise a path to forward slashes for stable, cross-platform doc ids. */
function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

/**
 * Walk `projectRoot`, tokenize matching source files, and build a TF-IDF index.
 *
 * Deterministic (entries are sorted) and dependency-free. Respects an include
 * list of extensions, skips heavy/irrelevant directories (node_modules, .git,
 * dist, build, .claude, worktrees), skips files larger than `maxFileBytes`, and
 * caps the total number of files at `maxFiles` (setting `truncated` when hit).
 */
export function buildIndex(projectRoot: string, opts: BuildIndexOpts = {}): RepoIndex {
  const includeExtensions = new Set(
    (opts.includeExtensions ?? DEFAULT_INCLUDE_EXTENSIONS).map((e) =>
      e.startsWith(".") ? e.toLowerCase() : `.${e.toLowerCase()}`
    )
  );
  const skipDirs = new Set([...DEFAULT_SKIP_DIRS, ...(opts.skipDirs ?? [])]);
  const maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;

  const docs: IndexedDoc[] = [];
  const documentFrequency: Record<string, number> = {};
  let truncated = false;

  const walk = (dir: string, depth: number): void => {
    if (truncated || depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // Sort for deterministic ordering.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      if (truncated) return;
      // Skip dotfiles/dotdirs (covers .git, .claude, etc.) and the skip list.
      if (entry.name.startsWith(".")) continue;
      if (skipDirs.has(entry.name)) continue;

      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        if (!includeExtensions.has(extname(entry.name).toLowerCase())) continue;
        let size: number;
        try {
          size = statSync(full).size;
        } catch {
          continue;
        }
        if (size > maxFileBytes) continue;

        let content: string;
        try {
          content = readFileSync(full, "utf8");
        } catch {
          continue;
        }

        if (docs.length >= maxFiles) {
          truncated = true;
          return;
        }

        const tokens = tokenize(content);
        const terms: Record<string, number> = {};
        for (const tok of tokens) terms[tok] = (terms[tok] ?? 0) + 1;
        for (const term of Object.keys(terms)) {
          documentFrequency[term] = (documentFrequency[term] ?? 0) + 1;
        }

        docs.push({
          path: toPosix(relative(projectRoot, full)),
          terms,
          length: tokens.length,
          head: content.slice(0, HEAD_BYTES),
        });
      }
    }
  };

  walk(projectRoot, 0);

  return {
    projectRoot,
    docs,
    documentFrequency,
    fileCount: docs.length,
    truncated,
  };
}

/** Inverse document frequency for a term given the corpus size. */
function idf(df: number, totalDocs: number): number {
  // Smoothed IDF; always positive so common-but-present terms still contribute.
  return Math.log((1 + totalDocs) / (1 + df)) + 1;
}

/** Build a short snippet: the first line in `head` containing any query term. */
function makeSnippet(head: string, queryTerms: Set<string>): string {
  const lines = head.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const lineTokens = new Set(tokenize(trimmed));
    for (const qt of queryTerms) {
      if (lineTokens.has(qt)) {
        return trimmed.length > 160 ? trimmed.slice(0, 157) + "..." : trimmed;
      }
    }
  }
  // Fall back to the first non-empty line of the file head.
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) return trimmed.length > 160 ? trimmed.slice(0, 157) + "..." : trimmed;
  }
  return "";
}

/**
 * Rank documents in `index` against `query` using TF-IDF cosine-ish scoring.
 *
 * Query terms are weighted by IDF; document term weights use length-normalised
 * TF × IDF. The dot product is normalised by the document's weight magnitude so
 * long files don't dominate. Returns up to `k` hits, each with a short snippet.
 */
export function search(index: RepoIndex, query: string, k = 8): SearchResult[] {
  const queryTokenList = tokenize(query);
  if (queryTokenList.length === 0 || index.docs.length === 0) return [];

  const totalDocs = index.docs.length;
  const queryTerms = new Set(queryTokenList);

  // Query term weights (IDF-weighted term frequency).
  const queryWeights: Record<string, number> = {};
  for (const tok of queryTokenList) {
    queryWeights[tok] = (queryWeights[tok] ?? 0) + 1;
  }
  for (const term of Object.keys(queryWeights)) {
    const df = index.documentFrequency[term] ?? 0;
    queryWeights[term] *= idf(df, totalDocs);
  }

  const scored: SearchResult[] = [];
  for (const doc of index.docs) {
    if (doc.length === 0) continue;
    let dot = 0;
    let docMagSq = 0;

    // Accumulate document weight magnitude over all of its terms so the cosine
    // denominator reflects the whole document, not just query-matched terms.
    for (const term of Object.keys(doc.terms)) {
      const df = index.documentFrequency[term] ?? 1;
      const tf = doc.terms[term] / doc.length;
      const w = tf * idf(df, totalDocs);
      docMagSq += w * w;
      const qw = queryWeights[term];
      if (qw !== undefined) dot += w * qw;
    }

    if (dot <= 0) continue;
    const docMag = Math.sqrt(docMagSq) || 1;
    const score = dot / docMag;
    if (score <= 0) continue;

    scored.push({
      path: doc.path,
      score,
      snippet: makeSnippet(doc.head, queryTerms),
    });
  }

  scored.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1));
  return scored.slice(0, k);
}
