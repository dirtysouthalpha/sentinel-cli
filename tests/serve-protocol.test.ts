import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpdir } from "os";
import { mkdtempSync } from "fs";
import { join } from "path";
import { WebSocket } from "ws";
import { runServe } from "../src/server/serve.js";
import type { ServerMessage } from "../src/server/protocol.js";

// Headless protocol smoke test: starts the `sentinel serve` engine in-process,
// connects with a real ws client, and asserts the handshake + a client message
// round-trip — all WITHOUT needing a live model/provider.
describe("serve protocol", () => {
  let server: { port: number; token: string; close: () => Promise<void> };

  beforeAll(async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "sentinel-serve-"));
    server = await runServe({ projectRoot, print: false });
  });

  afterAll(async () => {
    await server?.close();
  });

  // A buffering client: collects every frame from creation so we never miss the
  // `hello` that the engine sends synchronously on connect.
  type Client = {
    ws: WebSocket;
    waitFor: (pred: (m: ServerMessage) => boolean, timeout?: number) => Promise<ServerMessage>;
  };

  function open(): Promise<Client> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/?token=${server.token}`);
      const buffer: ServerMessage[] = [];
      const waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
      ws.on("message", (data: Buffer) => {
        let m: ServerMessage;
        try { m = JSON.parse(data.toString()); } catch { return; }
        const i = waiters.findIndex((w) => w.pred(m));
        if (i >= 0) { const [w] = waiters.splice(i, 1); w.resolve(m); }
        else buffer.push(m);
      });
      ws.once("error", reject);
      const waitFor = (pred: (m: ServerMessage) => boolean, timeout = 4000) =>
        new Promise<ServerMessage>((res, rej) => {
          const idx = buffer.findIndex(pred);
          if (idx >= 0) { const [m] = buffer.splice(idx, 1); return res(m); }
          const timer = setTimeout(() => rej(new Error("timeout waiting for message")), timeout);
          waiters.push({ pred, resolve: (m) => { clearTimeout(timer); res(m); } });
        });
      ws.once("open", () => resolve({ ws, waitFor }));
    });
  }

  it("rejects connections with a bad token", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/?token=wrong`);
    const code = await new Promise<number>((resolve) => ws.once("close", (c) => resolve(c)));
    expect(code).toBe(1008);
  });

  it("sends a hello with a state snapshot on connect", async () => {
    const c = await open();
    const hello = await c.waitFor((m) => m.type === "hello");
    expect(hello.type).toBe("hello");
    if (hello.type === "hello") {
      expect(typeof hello.version).toBe("string");
      expect(hello.state).toBeTruthy();
      expect(typeof hello.state.model).toBe("string");
      expect(Array.isArray(hello.state.agents)).toBe(true);
      expect(Array.isArray(hello.state.themes)).toBe(true);
      expect(hello.state.permissionMode).toBe("yolo");
    }
    c.ws.close();
  });

  it("round-trips a client message (setPermissionMode) without a model", async () => {
    const c = await open();
    await c.waitFor((m) => m.type === "hello");
    c.ws.send(JSON.stringify({ type: "setPermissionMode", mode: "gated" }));
    const state = await c.waitFor((m) => m.type === "state");
    if (state.type === "state") expect(state.state.permissionMode).toBe("gated");
    // getState should also reflect it
    c.ws.send(JSON.stringify({ type: "getState" }));
    const again = await c.waitFor((m) => m.type === "state");
    if (again.type === "state") expect(again.state.permissionMode).toBe("gated");
    c.ws.close();
  });

  it("ignores malformed client frames without crashing", async () => {
    const c = await open();
    await c.waitFor((m) => m.type === "hello");
    c.ws.send("not json at all {");
    // engine should still respond to a valid follow-up
    c.ws.send(JSON.stringify({ type: "getState" }));
    const state = await c.waitFor((m) => m.type === "state");
    expect(state.type).toBe("state");
    c.ws.close();
  });
});
