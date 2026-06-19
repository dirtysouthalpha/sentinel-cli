/**
 * LSP client manager — spawn language servers per language, frame JSON-RPC over
 * stdio, and expose definitions/references/diagnostics queries.
 *
 * DESIGN — why the transport is injectable:
 * Real LSP servers are finicky, slow, and language-specific. The *valuable*
 * logic here is (a) mapping file → server, (b) JSON-RPC framing, and (c) the
 * request/response shaping. All three are testable without a real subprocess
 * if the byte transport is injected. Production passes a stdio transport;
 * tests pass a fake. This mirrors how the sandbox (bwrap) and browser
 * (puppeteer) modules keep their I/O at the edges.
 *
 * GRACEFUL DEGRADATION:
 * No server configured for a language → ensureServer returns null, queries
 * return null/[]. The agent falls back to grep. LSP is an *accelerator*, not
 * a hard dep — the system prompt and tool layer must never assume it exists.
 */

import { spawn, type ChildProcess } from "child_process";
import { extname } from "path";
import { createLogger } from "../utils/logger.js";

const log = createLogger({ prefix: "lsp" });

// --- LSP spec types (subset we use) -----------------------------------------

export interface LSPLocation {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export interface LSPDiagnostic {
  range: LSPLocation["range"];
  severity?: number; // 1=Error 2=Warning 3=Info 4=Hint
  code?: number | string;
  source?: string;
  message: string;
}

/** Config for one language server: command + args. */
export interface LSPServerConfig {
  command: string;
  args?: string[];
}

/** Per-language server map, keyed by language id (matches extension map below). */
export type LSPServerMap = Record<string, LSPServerConfig>;

// --- Transport seam ---------------------------------------------------------

/**
 * A framed byte transport. Production = stdio of a spawned server; tests = an
 * in-memory fake. `read` returns ONE complete JSON-RPC message (already
 * de-framed) or null if nothing is ready.
 */
export interface LSPTransport {
  /** Send a complete JSON-RPC message (caller handles framing). */
  write(framed: string): void;
  /** Read one de-framed JSON-RPC message, or null if none buffered. */
  read(): string | null;
  /** Tear down the underlying process/stream. */
  kill(): void;
}

export interface LSPTransportFactory {
  spawn(cfg: LSPServerConfig): LSPTransport;
}

/** Stdio transport for production: real subprocess, real Content-Length framing. */
class StdioTransport implements LSPTransport {
  private proc: ChildProcess;
  private buffer = "";
  private pending: string[] = [];

  constructor(cfg: LSPServerConfig) {
    this.proc = spawn(cfg.command, cfg.args ?? [], { stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stdout?.setEncoding("utf-8");
    this.proc.stdout?.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.parseFramed();
    });
    this.proc.on("error", (err) => log.warn(`LSP server error: ${err.message}`));
  }

  /** Split accumulated buffer into complete Content-Length-framed messages. */
  private parseFramed(): void {
    // LSP wire format: "Content-Length: N\r\n\r\n" then N bytes of JSON.
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = this.buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        // Malformed; drop the header to make progress.
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const len = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + len) return; // wait for more bytes
      const body = this.buffer.slice(bodyStart, bodyStart + len);
      this.pending.push(body);
      this.buffer = this.buffer.slice(bodyStart + len);
    }
  }

  write(msg: string): void {
    const framed = `Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`;
    this.proc.stdin?.write(framed);
  }

  read(): string | null {
    return this.pending.shift() ?? null;
  }

  kill(): void {
    this.proc.kill();
  }
}

/** Production transport factory: spawns real subprocesses. */
export const stdioTransportFactory: LSPTransportFactory = {
  spawn(cfg: LSPServerConfig): LSPTransport {
    return new StdioTransport(cfg);
  },
};

// --- Handle: one live server + its init state ------------------------------

interface LSPHandleInternal {
  language: string;
  transport: LSPTransport;
  initialized: boolean;
  /** Monotonic request id counter. */
  nextId: number;
  /** Responses keyed by request id, populated as they arrive on read(). */
  responses: Map<number, unknown>;
}

export type LSPHandle = LSPHandleInternal;

// --- Extension → language id ------------------------------------------------

/** Map a file path to a language id, or null if unsupported. */
export function languageForPath(filePath: string): string | null {
  const ext = extname(filePath).toLowerCase();
  const MAP: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".mts": "typescript",
    ".cts": "typescript",
    ".js": "typescript", // tsserver covers JS too
    ".jsx": "typescript",
    ".mjs": "typescript",
    ".cjs": "typescript",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".c": "c",
    ".cpp": "cpp",
    ".cc": "cpp",
    ".h": "cpp",
    ".hpp": "cpp",
    ".cs": "csharp",
    ".rb": "ruby",
    ".php": "php",
  };
  return MAP[ext] ?? null;
}

/** Convert an absolute path to a file:// URI. */
export function pathToUri(filePath: string): string {
  // Encode but preserve the leading slash on POSIX and the drive on Windows.
  return "file://" + encodeURI(filePath).replace(/#/g, "%23");
}

// --- The manager ------------------------------------------------------------

export interface LSPManagerOptions {
  /** Spawn fn: given a server config, return a transport. Inject for tests. */
  spawn?: (cfg: LSPServerConfig) => LSPTransport;
}

export class LSPManager {
  private servers: LSPServerMap;
  private spawner: (cfg: LSPServerConfig) => LSPTransport;
  /** Live handles, keyed by language id. */
  private handles = new Map<string, LSPHandleInternal>();

  constructor(servers: LSPServerMap, opts: LSPManagerOptions = {}) {
    this.servers = servers;
    this.spawner = opts.spawn ?? ((cfg) => stdioTransportFactory.spawn(cfg));
  }

  /**
   * Ensure a server is live for the language of `filePath`. Returns null when
   * no server is configured (caller falls back to grep). Idempotent: a second
   * call for the same language reuses the cached handle.
   */
  ensureServer(filePath: string): LSPHandle | null {
    const language = languageForPath(filePath);
    if (!language) return null;
    if (!this.servers[language]) return null;

    const cached = this.handles.get(language);
    if (cached) return cached;

    const transport = this.spawner(this.servers[language]);
    const handle: LSPHandleInternal = {
      language,
      transport,
      initialized: false,
      nextId: 0,
      responses: new Map(),
    };
    this.handles.set(language, handle);
    this.initialize(handle);
    return handle;
  }

  /** Send the LSP initialize handshake. Fire-and-forget; queries wait on read(). */
  private initialize(handle: LSPHandleInternal): void {
    const id = handle.nextId++;
    handle.transport.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "initialize",
        params: {
          processId: process.pid,
          rootUri: pathToUri(process.cwd()),
          capabilities: {
            // Minimal client caps — we only need textDocument def/refs/diag.
            textDocument: {
              synchronization: { didOpen: true },
              definition: { dynamicRegistration: false },
              references: { dynamicRegistration: false },
              publishDiagnostics: { relatedInformation: false },
            },
          },
        },
      })
    );
    handle.initialized = true;
  }

  /**
   * Send a request and resolve its response by id. Drains the transport's
   * read() until the matching response arrives. Time out after `timeoutMs`
   * (default 5s) so a hung server never blocks the agent loop.
   */
  private async request<R>(
    handle: LSPHandleInternal,
    method: string,
    params: unknown,
    timeoutMs = 5000
  ): Promise<R | null> {
    const id = handle.nextId++;
    handle.transport.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }));

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // Drain everything currently readable, banking responses by id.
      let raw: string | null;
      while ((raw = handle.transport.read()) !== null) {
        try {
          const msg = JSON.parse(raw);
          if (msg.id != null) handle.responses.set(msg.id, msg.result);
        } catch {
          // Malformed frame — skip. Never let a bad message crash the loop.
        }
      }
      if (handle.responses.has(id)) {
        return handle.responses.get(id) as R;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    log.warn(`LSP ${method} timed out after ${timeoutMs}ms`);
    return null;
  }

  async getDefinition(filePath: string, line: number, character: number): Promise<LSPLocation | null> {
    const h = this.ensureServer(filePath);
    if (!h) return null;
    const result = await this.request<LSPLocation | LSPLocation[]>(
      h,
      "textDocument/definition",
      { textDocument: { uri: pathToUri(filePath) }, position: { line, character } }
    );
    // Definition can be a single Location, an array, or null.
    if (Array.isArray(result)) return result[0] ?? null;
    return result ?? null;
  }

  async getReferences(filePath: string, line: number, character: number): Promise<LSPLocation[]> {
    const h = this.ensureServer(filePath);
    if (!h) return [];
    const result = await this.request<LSPLocation[]>(
      h,
      "textDocument/references",
      { textDocument: { uri: pathToUri(filePath) }, position: { line, character }, context: { includeDeclaration: true } }
    );
    return Array.isArray(result) ? result : result ? [result] : [];
  }

  /**
   * Pull cached diagnostics. LSP servers push diagnostics via notification
   * (textDocument/publishDiagnostics); we request them via a best-effort
   * pull using the (widely-supported) workspace diagnostic or fall back to
   * whatever has been buffered. Here we issue textDocument/documentSymbol
   * style no-op — but for broad compatibility we use a custom pull: many
   * servers respond to a `textDocument/pullDiagnostics` (3.17) request.
   * To stay simple and server-portable, we just read any buffered
   * publishDiagnostics notifications addressed to this file.
   */
  async getDiagnostics(filePath: string): Promise<LSPDiagnostic[]> {
    const h = this.ensureServer(filePath);
    if (!h) return [];
    // Drain and collect any publishDiagnostics notifications for this file.
    const uri = pathToUri(filePath);
    const collected: LSPDiagnostic[] = [];
    let raw: string | null;
    while ((raw = h.transport.read()) !== null) {
      try {
        const msg = JSON.parse(raw);
        if (msg.method === "textDocument/publishDiagnostics" && msg.params?.uri === uri) {
          collected.push(...(msg.params.diagnostics ?? []));
        } else if (msg.id != null) {
          // Bank stray responses for other in-flight requests.
          h.responses.set(msg.id, msg.result);
        }
      } catch {
        /* skip */
      }
    }
    return collected;
  }

  /** Kill every spawned server. Safe to call again after — cache is cleared. */
  shutdown(): void {
    for (const handle of this.handles.values()) {
      try {
        handle.transport.kill();
      } catch {
        /* best effort */
      }
    }
    this.handles.clear();
  }
}
