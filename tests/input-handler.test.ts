import { describe, it, expect, vi } from "vitest";
import { InputHandler } from "../src/tui/input-handler.js";

function makeHandler(overrides: Partial<{
  onSubmit: (msg: string) => void;
  onCancel: () => void;
  onPermissionKey: (allow: boolean) => void;
  hasPendingPermission: () => boolean;
}> = {}) {
  const callbacks = {
    onSubmit: overrides.onSubmit ?? vi.fn(),
    onCancel: overrides.onCancel ?? vi.fn(),
    onPermissionKey: overrides.onPermissionKey ?? vi.fn(),
    hasPendingPermission: overrides.hasPendingPermission ?? (() => false),
  };
  const handler = new InputHandler(callbacks);
  const el = { setContent: vi.fn(), hide: vi.fn(), show: vi.fn(), render: vi.fn(), setFront: vi.fn() };
  const screen = { render: vi.fn() };
  handler.init(el as never, screen as never, el as never);
  return { handler, callbacks, el, screen };
}

describe("InputHandler", () => {
  it("starts with empty buffer and cursor at 0", () => {
    const { handler } = makeHandler();
    expect(handler.getBuffer()).toBe("");
    expect(handler.getCursor()).toBe(0);
  });

  it("setBuffer updates buffer and clamps cursor to length", () => {
    const { handler } = makeHandler();
    handler.setBuffer("hello", 10);
    expect(handler.getBuffer()).toBe("hello");
    expect(handler.getCursor()).toBe(5);
  });

  it("setBuffer clamps negative cursor to 0", () => {
    const { handler } = makeHandler();
    handler.setBuffer("abc", -3);
    expect(handler.getCursor()).toBe(0);
  });

  it("clearLine resets buffer and cursor", () => {
    const { handler } = makeHandler();
    handler.setBuffer("some text", 5);
    handler.clearLine();
    expect(handler.getBuffer()).toBe("");
    expect(handler.getCursor()).toBe(0);
  });

  it("onCancel fires on Ctrl+C (code 3)", () => {
    const { handler, callbacks } = makeHandler();
    handler["onChunk"]("\x03");
    expect(callbacks.onCancel).toHaveBeenCalled();
  });

  it("onSubmit fires on Enter with trimmed message", () => {
    const { handler, callbacks } = makeHandler();
    handler.setBuffer("  hello  ", 9);
    handler["onChunk"]("\r");
    expect(callbacks.onSubmit).toHaveBeenCalledWith("hello");
    expect(handler.getBuffer()).toBe("");
  });

  it("onSubmit ignores empty input", () => {
    const { handler, callbacks } = makeHandler();
    handler["onChunk"]("\r");
    expect(callbacks.onSubmit).not.toHaveBeenCalled();
  });

  it("onPermissionKey fires with allow=true for 'y' when pending", () => {
    const onPermissionKey = vi.fn();
    const { handler } = makeHandler({
      onPermissionKey,
      hasPendingPermission: () => true,
    });
    handler["onChunk"]("y");
    expect(onPermissionKey).toHaveBeenCalledWith(true);
  });

  it("onPermissionKey fires with allow=false for 'n' when pending", () => {
    const onPermissionKey = vi.fn();
    const { handler } = makeHandler({
      onPermissionKey,
      hasPendingPermission: () => true,
    });
    handler["onChunk"]("n");
    expect(onPermissionKey).toHaveBeenCalledWith(false);
  });

  it("recallHistory navigates through history", () => {
    const { handler } = makeHandler();
    handler.setBuffer("first", 5);
    handler["onChunk"]("\r");
    handler.setBuffer("second", 6);
    handler["onChunk"]("\r");
    handler["recallHistory"](-1);
    expect(handler.getBuffer()).toBe("second");
    handler["recallHistory"](-1);
    expect(handler.getBuffer()).toBe("first");
    handler["recallHistory"](1);
    expect(handler.getBuffer()).toBe("second");
  });

  it("recallHistory restores draft when navigating past newest", () => {
    const { handler } = makeHandler();
    handler.setBuffer("saved", 5);
    handler["onChunk"]("\r");
    handler.setBuffer("current draft", 13);
    handler["recallHistory"](-1);
    expect(handler.getBuffer()).toBe("saved");
    handler["recallHistory"](1);
    expect(handler.getBuffer()).toBe("current draft");
  });

  it("hideSlash calls slashBox.hide", () => {
    const { handler, el } = makeHandler();
    handler["slashActive"] = true;
    handler.hideSlash();
    expect(el.hide).toHaveBeenCalled();
  });
});
