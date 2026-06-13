import { describe, it, expect } from "vitest";
import { LspManager } from "../src/core/lsp-manager.js";

describe("LspManager resilience", () => {
  it("degrades gracefully when a server binary is missing", async () => {
    const mgr = new LspManager();
    // Should not throw even though the binary does not exist.
    await mgr.connect({
      bogus: { command: ["sentinel-no-such-language-server-xyz", "--stdio"] },
    });
    // The failed server is not retained.
    expect((mgr as unknown as { servers: Record<string, unknown> }).servers).toEqual({});
    mgr.killAll();
  });

  it("killAll is safe with no servers running", () => {
    const mgr = new LspManager();
    expect(() => mgr.killAll()).not.toThrow();
  });
});
