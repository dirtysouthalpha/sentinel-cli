import { spawn, ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createLogger } from "../utils/logger.js";

// Polyfill: Promise.withResolvers requires ES2024 but tsconfig targets ES2022
const withResolvers = <T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void } => {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const log = createLogger({ prefix: "lsp" });

interface ServerState {
  process: ChildProcess;
  buffer: string;
  requestId: number;
  capabilities: Record<string, unknown>;
  pending: Record<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
}

export class LspManager extends EventEmitter {
  private servers: Record<string, ServerState> = {};
  private openDocs = new Set<string>();
  private initialized = false;

  async connect(servers: Record<string, { command: string[] }>): Promise<void> {
    for (const [name, config] of Object.entries(servers)) {
      try {
        await this.spawnServer(name, config.command);
      } catch (err) {
        // A missing/broken language server must not take down the whole tool —
        // degrade gracefully and keep any servers that did start.
        log.warn(`[${name}] failed to connect: ${err instanceof Error ? err.message : String(err)}`);
        delete this.servers[name];
      }
    }
    this.initialized = true;
    log.info(`Connected ${Object.keys(this.servers).length} language server(s)`);
  }

  private async spawnServer(name: string, command: string[]): Promise<void> {
    const proc = spawn(command[0], command.slice(1), {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const state: ServerState = {
      process: proc,
      buffer: "",
      requestId: 0,
      capabilities: {},
      pending: {},
    };
    this.servers[name] = state;

    // Reject fast if the binary is missing or fails to launch, instead of
    // waiting out the 15s initialize timeout.
    const spawnFailed = new Promise<never>((_, reject) => {
      proc.once("error", (err) => reject(new Error(`spawn failed: ${err.message}`)));
    });

    proc.stdout?.on("data", (chunk: Buffer) => this.onData(name, chunk));
    proc.stderr?.on("data", (chunk: Buffer) =>
      log.debug(`[${name}] stderr: ${chunk.toString()}`)
    );

    proc.on("exit", (code) => {
      log.warn(`[${name}] exited with code ${code}`);
      this.emit("server:exit", name, code);
    });

    // Initialize, racing against a launch failure.
    const init = (async () => {
      const initResult = await this.sendRequest(name, "initialize", {
        processId: process.pid,
        rootUri: null,
        capabilities: {},
      });
      state.capabilities = (initResult as Record<string, unknown>)?.capabilities as Record<string, unknown> ?? {};
      await this.sendNotification(name, "initialized", {});
      log.info(`[${name}] initialized`);
    })();

    await Promise.race([init, spawnFailed]);
  }

  /** Map a path to an LSP languageId so didOpen registers the right grammar. */
  private languageId(file: string): string {
    if (/\.tsx?$/i.test(file)) return "typescript";
    if (/\.jsx?$/i.test(file)) return "javascript";
    if (/\.py$/i.test(file)) return "python";
    return "plaintext";
  }

  /**
   * Most servers only answer requests for documents they've been told about.
   * Send textDocument/didOpen (once per file) with the on-disk content before
   * any file-scoped request.
   */
  private async ensureOpen(server: string, file: string): Promise<void> {
    const uri = this.toFileUri(file);
    if (this.openDocs.has(uri)) return;
    let text = "";
    try { text = readFileSync(file, "utf8"); } catch { /* server can still try */ }
    await this.sendNotification(server, "textDocument/didOpen", {
      textDocument: { uri, languageId: this.languageId(file), version: 1, text },
    });
    this.openDocs.add(uri);
  }

  private onData(name: string, chunk: Buffer): void {
    const state = this.servers[name];
    if (!state) return;
    state.buffer += chunk.toString();

    while (state.buffer.length > 0) {
      const headerEnd = state.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      const header = state.buffer.slice(0, headerEnd);
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        state.buffer = state.buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (state.buffer.length < bodyStart + contentLength) return;

      const body = state.buffer.slice(bodyStart, bodyStart + contentLength);
      state.buffer = state.buffer.slice(bodyStart + contentLength);

      try {
        const msg = JSON.parse(body) as Record<string, unknown>;
        if (msg.id != null && typeof msg.id === "number" && state.pending[msg.id]) {
          const { resolve, reject } = state.pending[msg.id];
          delete state.pending[msg.id];
          if (msg.error) {
            reject(new Error(String((msg.error as Record<string, unknown>)?.message ?? msg.error)));
          } else {
            resolve(msg.result);
          }
        }
      } catch (err) {
        log.debug(`[${name}] parse error: ${err}`);
      }
    }
  }

  private sendRequest(server: string, method: string, params: unknown): Promise<unknown> {
    const state = this.servers[server];
    if (!state) return Promise.reject(new Error(`Server "${server}" not connected`));

    const id = ++state.requestId;
    const message = JSON.stringify({ jsonrpc: "2.0", id, method, params });

    const { promise, resolve, reject } = withResolvers<unknown>();
    state.pending[id] = { resolve, reject };

    const header = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n`;
    state.process.stdin!.write(header + message);

    const timer = setTimeout(() => {
      delete state.pending[id];
      reject(new Error(`Request ${method} timed out`));
    }, 15_000);

    return promise.finally(() => clearTimeout(timer));
  }

  private sendNotification(server: string, method: string, params: unknown): Promise<void> {
    const state = this.servers[server];
    if (!state) return Promise.reject(new Error(`Server "${server}" not connected`));

    const message = JSON.stringify({ jsonrpc: "2.0", method, params });
    const header = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n`;
    state.process.stdin!.write(header + message);
    return Promise.resolve();
  }

  private toFileUri(file: string): string {
    return file.startsWith("file://") ? file : `file:///${file.replace(/\\/g, "/")}`;
  }

  async request(server: string, method: string, params: unknown): Promise<unknown> {
    return this.sendRequest(server, method, params);
  }

  async diagnostics(file: string): Promise<unknown> {
    const uri = this.toFileUri(file);
    await this.ensureOpen("typescript", file);
    return this.sendRequest("typescript", "textDocument/diagnostic", {
      textDocument: { uri },
    });
  }

  async definition(file: string, line: number, char: number): Promise<unknown> {
    const uri = this.toFileUri(file);
    await this.ensureOpen("typescript", file);
    return this.sendRequest("typescript", "textDocument/definition", {
      textDocument: { uri },
      position: { line, character: char },
    });
  }

  async references(file: string, line: number, char: number): Promise<unknown> {
    const uri = this.toFileUri(file);
    await this.ensureOpen("typescript", file);
    return this.sendRequest("typescript", "textDocument/references", {
      textDocument: { uri },
      position: { line, character: char },
      context: { includeDeclaration: true },
    });
  }

  async hover(file: string, line: number, char: number): Promise<unknown> {
    const uri = this.toFileUri(file);
    await this.ensureOpen("typescript", file);
    return this.sendRequest("typescript", "textDocument/hover", {
      textDocument: { uri },
      position: { line, character: char },
    });
  }

  async symbols(query: string): Promise<unknown> {
    return this.sendRequest("typescript", "workspace/symbol", { query });
  }

  async rename(file: string, line: number, char: number, newName: string): Promise<unknown> {
    const uri = this.toFileUri(file);
    await this.ensureOpen("typescript", file);
    return this.sendRequest("typescript", "textDocument/rename", {
      textDocument: { uri },
      position: { line, character: char },
      newName,
    });
  }

  async codeActions(file: string, line: number, char: number): Promise<unknown> {
    const uri = this.toFileUri(file);
    await this.ensureOpen("typescript", file);
    return this.sendRequest("typescript", "textDocument/codeAction", {
      textDocument: { uri },
      range: {
        start: { line, character: char },
        end: { line, character: char },
      },
    });
  }

  async shutdown(): Promise<void> {
    for (const [name, state] of Object.entries(this.servers)) {
      try {
        await this.sendRequest(name, "shutdown", null);
        await this.sendNotification(name, "exit", null);
      } catch {
        // force kill if graceful fails
      }
      state.process.kill();
      log.info(`[${name}] shutdown`);
    }
    this.servers = {};
    this.openDocs.clear();
    this.initialized = false;
  }

  /** Synchronously kill all servers — safe to call from a process exit hook. */
  killAll(): void {
    for (const state of Object.values(this.servers)) {
      try { state.process.kill(); } catch { /* already gone */ }
    }
    this.servers = {};
    this.openDocs.clear();
    this.initialized = false;
  }
}
