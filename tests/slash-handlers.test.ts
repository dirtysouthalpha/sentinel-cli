import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SlashHandlerContext,
  handleExportCommand,
  handleWorkspaceCommand,
} from "../src/tui/slash-handlers.js";
import { sessionManager } from "../src/core/session-manager.js";

/** Minimal ctx that records what the handler would have shown the user. */
function makeCtx(projectRoot: string): SlashHandlerContext & { sys: string[]; err: string[] } {
  const sys: string[] = [];
  const err: string[] = [];
  return {
    projectRoot,
    sys,
    err,
    addSystem: (t) => sys.push(t),
    addError: (t) => err.push(t),
    // Not exercised by these tests:
    tabManager: {} as SlashHandlerContext["tabManager"],
    createNewTab: () => {},
    onTabClose: () => {},
  };
}

describe("slash-handlers", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sentinel-slash-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("handleExportCommand", () => {
    it("reports when there is no active session", () => {
      // Ensure no active session for this assertion.
      const original = sessionManager.getActiveSession;
      (sessionManager as unknown as { getActiveSession: () => undefined }).getActiveSession = () => undefined;
      try {
        const ctx = makeCtx(dir);
        handleExportCommand(ctx, []);
        expect(ctx.sys.join(" ")).toMatch(/no active session/i);
      } finally {
        (sessionManager as unknown as { getActiveSession: typeof original }).getActiveSession = original;
      }
    });

    it("writes a markdown transcript for a session with messages", () => {
      const session = sessionManager.createSession({ projectRoot: dir, title: "Export Test" });
      session.contextManager.addMessage("user", "hello world");
      session.contextManager.addMessage("assistant", "hi there");

      const original = sessionManager.getActiveSession;
      (sessionManager as unknown as { getActiveSession: () => unknown }).getActiveSession = () => session;
      try {
        const ctx = makeCtx(dir);
        handleExportCommand(ctx, ["md", "out.md"]);

        const target = join(dir, "out.md");
        expect(existsSync(target)).toBe(true);
        const content = readFileSync(target, "utf8");
        expect(content).toContain("hello world");
        expect(content).toContain("hi there");
        expect(ctx.sys.join(" ")).toMatch(/exported 2 messages/i);
      } finally {
        (sessionManager as unknown as { getActiveSession: typeof original }).getActiveSession = original;
      }
    });
  });

  describe("handleWorkspaceCommand", () => {
    it("shows usage for an unknown subcommand", () => {
      const ctx = makeCtx(dir);
      handleWorkspaceCommand(ctx, ["bogus"]);
      expect(ctx.sys.join(" ")).toMatch(/usage: \/workspace/i);
    });
  });
});
