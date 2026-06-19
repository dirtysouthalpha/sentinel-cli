import { describe, it, expect } from "vitest";
import {
  LSPManager,
  type LSPServerConfig,
  type LSPTransport,
  type LSPHandle,
} from "../src/core/lsp-client.js";

/**
 * A fake transport that captures every sent message and answers each with a
 * queued response. No real subprocess, no real JSON-RPC over stdio — the
 * manager's job is to frame requests and parse responses, which is the part
 * worth testing.
 */
function fakeTransport(): LSPTransport & { sent: any[]; queue: any[] } {
  const sent: any[] = [];
  const queue: any[] = [];
  return {
    sent,
    queue,
    write(msg: string) {
      sent.push(JSON.parse(msg));
    },
    // Manager reads one framed message; we hand back the front of the queue.
    read(): string | null {
      const next = queue.shift();
      return next == null ? null : JSON.stringify(next);
    },
    kill() {},
  };
}

const TS_SERVER: LSPServerConfig = { command: "typescript-language-server", args: ["--stdio"] };
const PY_SERVER: LSPServerConfig = { command: "pylsp" };

describe("LSPManager — server selection + lifecycle", () => {
  it("picks the right server by file extension", () => {
    const transport = fakeTransport();
    let spawned = 0;
    const mgr = new LSPManager(
      { typescript: TS_SERVER, python: PY_SERVER },
      { spawn: () => (spawned++, transport) }
    );
    const ts = mgr.ensureServer("/abs/src/foo.ts");
    const py = mgr.ensureServer("/abs/src/bar.py");
    expect(ts?.language).toBe("typescript");
    expect(py?.language).toBe("python");
    expect(spawned).toBe(2);
  });

  it("returns null for an unknown extension (no server, no spawn)", () => {
    const transport = fakeTransport();
    const mgr = new LSPManager(
      { typescript: TS_SERVER },
      { spawn: () => transport }
    );
    expect(mgr.ensureServer("/abs/README.xyz")).toBeNull();
  });

  it("caches: doesn't double-spawn the same language", () => {
    const transport = fakeTransport();
    let spawned = 0;
    const mgr = new LSPManager(
      { typescript: TS_SERVER },
      { spawn: () => (spawned++, transport) }
    );
    mgr.ensureServer("/abs/a.ts");
    mgr.ensureServer("/abs/b.ts");
    mgr.ensureServer("/abs/c.ts");
    expect(spawned).toBe(1);
  });

  it("initializes the server once on spawn (sends initialize request)", () => {
    const transport = fakeTransport();
    const mgr = new LSPManager(
      { typescript: TS_SERVER },
      { spawn: () => transport }
    );
    mgr.ensureServer("/abs/foo.ts");
    // First message must be the LSP initialize handshake.
    expect(transport.sent[0].method).toBe("initialize");
    expect(transport.sent[0].params.capabilities).toBeTruthy();
  });

  it("shutdown kills all spawned transports, then re-spawn works", () => {
    // Each spawn gets its OWN transport so kill counts are unambiguous.
    const transports: { killed: boolean }[] = [];
    const mgr = new LSPManager(
      { typescript: TS_SERVER, python: PY_SERVER },
      {
        spawn: () => {
          const t = { killed: false };
          transports.push(t);
          return {
            write() {},
            read: () => null,
            kill: () => (t.killed = true),
          };
        },
      }
    );
    mgr.ensureServer("/abs/a.ts");
    mgr.ensureServer("/abs/b.py");
    mgr.shutdown();
    expect(transports.map((t) => t.killed)).toEqual([true, true]);
    // After shutdown the cache is cleared, so a fresh ensureServer spawns again.
    mgr.ensureServer("/abs/c.ts");
    expect(transports).toHaveLength(3);
    expect(transports[2].killed).toBe(false);
  });
});

describe("LSPManager — request framing + response parsing", () => {
  it("sends a textDocument/definition request with the right params", () => {
    const transport = fakeTransport();
    const mgr = new LSPManager({ typescript: TS_SERVER }, { spawn: () => transport });
    mgr.ensureServer("/abs/foo.ts");
    transport.sent.length = 0; // clear the initialize handshake

    mgr.getDefinition("/abs/foo.ts", 41, 9); // 0-based LSP line/col
    const req = transport.sent[0];
    expect(req.method).toBe("textDocument/definition");
    expect(req.params.textDocument.uri).toBe("file:///abs/foo.ts");
    expect(req.params.position).toEqual({ line: 41, character: 9 });
  });

  it("returns the parsed Location from the server response", async () => {
    const transport = fakeTransport();
    const mgr = new LSPManager({ typescript: TS_SERVER }, { spawn: () => transport });
    const h = mgr.ensureServer("/abs/foo.ts")!;
    transport.sent.length = 0;

    // Queue the response the server would return.
    transport.queue.push({
      id: 1, // manager's first real request (after initialize) is id 1
      result: {
        uri: "file:///abs/src/bar.ts",
        range: { start: { line: 12, character: 5 }, end: { line: 12, character: 8 } },
      },
    });

    const loc = await mgr.getDefinition("/abs/foo.ts", 41, 9);
    expect(loc).toEqual({
      uri: "file:///abs/src/bar.ts",
      range: { start: { line: 12, character: 5 }, end: { line: 12, character: 8 } },
    });
  });

  it("references returns an array of Locations", async () => {
    const transport = fakeTransport();
    const mgr = new LSPManager({ typescript: TS_SERVER }, { spawn: () => transport });
    mgr.ensureServer("/abs/foo.ts");
    transport.sent.length = 0;

    transport.queue.push({
      id: 1,
      result: [
        { uri: "file:///abs/a.ts", range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } } },
        { uri: "file:///abs/b.ts", range: { start: { line: 2, character: 4 }, end: { line: 2, character: 7 } } },
      ],
    });

    const refs = await mgr.getReferences("/abs/foo.ts", 41, 9);
    expect(refs).toHaveLength(2);
    expect(refs[0].uri).toBe("file:///abs/a.ts");
  });

  it("diagnostics returns the server's publishDiagnostics notifications", async () => {
    const transport = fakeTransport();
    const mgr = new LSPManager({ typescript: TS_SERVER }, { spawn: () => transport });
    mgr.ensureServer("/abs/foo.ts");
    transport.sent.length = 0;

    // Diagnostics arrive as unsolicited notifications, not request responses.
    transport.queue.push({
      method: "textDocument/publishDiagnostics",
      params: {
        uri: "file:///abs/foo.ts",
        diagnostics: [
          {
            range: { start: { line: 9, character: 0 }, end: { line: 9, character: 10 } },
            severity: 1,
            message: "Type 'string' is not assignable to type 'number'.",
          },
        ],
      },
    });

    const diags = await mgr.getDiagnostics("/abs/foo.ts");
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain("not assignable");
  });

  it("returns null/[] when no server is configured (graceful degradation)", async () => {
    const mgr = new LSPManager({}, { spawn: () => fakeTransport() });
    expect(mgr.ensureServer("/abs/foo.ts")).toBeNull();
    expect(await mgr.getDefinition("/abs/foo.ts", 0, 0)).toBeNull();
    expect(await mgr.getReferences("/abs/foo.ts", 0, 0)).toEqual([]);
    expect(await mgr.getDiagnostics("/abs/foo.ts")).toEqual([]);
  });
});
