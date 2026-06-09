import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";
import { TabDef } from "./tab-bar.js";

export interface TabRenameModalOptions {
  screen: blessed.Widgets.Screen;
  currentTitle: string;
  existingTitles: string[];
  onConfirm: (newTitle: string) => void;
  onCancel: () => void;
}

export function showTabRenameModal(options: TabRenameModalOptions): void {
  const c = themeEngine.getBlessedColors();
  const { screen, currentTitle, existingTitles, onConfirm, onCancel } = options;

  const width = 50;
  const height = 7;
  const left = Math.floor((screen.width as number) / 2 - width / 2);
  const top = Math.floor((screen.height as number) / 2 - height / 2);

  const overlay = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    style: { bg: "black", fg: "white" },
    opacity: 0.7,
  });

  const box = blessed.box({
    parent: screen,
    top,
    left,
    width,
    height,
    border: { type: "line" },
    style: {
      bg: c.bgSecondary,
      fg: c.textPrimary,
      border: { fg: c.accent },
    },
    tags: true,
  });

  const label = blessed.text({
    parent: box,
    top: 0,
    left: 1,
    content: `{bold}Rename Tab{/}`,
    tags: true,
    style: { fg: c.cyan },
  });

  let inputText = currentTitle;
  const input = blessed.box({
    parent: box,
    top: 2,
    left: 1,
    width: width - 4,
    height: 1,
    style: { bg: c.bgPrimary, fg: c.textPrimary },
    tags: true,
  });

  const hint = blessed.text({
    parent: box,
    top: 4,
    left: 1,
    content: `{${c.textTertiary}-fg}Enter to confirm \u00B7 Esc to cancel{/}`,
    tags: true,
  });

  function renderInput(): void {
    input.setContent(` ${inputText}{inverse} {/inverse}`);
    screen.render();
  }

  renderInput();

  function cleanup(): void {
    overlay.destroy();
    box.destroy();
    screen.render();
  }

  function handleKey(ch: string, key: { name: string; full: string }): void {
    if (key.name === "escape") {
      cleanup();
      onCancel();
      return;
    }

    if (key.name === "return" || key.name === "enter") {
      const trimmed = inputText.trim();
      if (trimmed && !existingTitles.includes(trimmed)) {
        cleanup();
        onConfirm(trimmed);
      }
      return;
    }

    if (key.name === "backspace") {
      inputText = inputText.slice(0, -1);
      renderInput();
      return;
    }

    if (ch && ch.length === 1 && ch.charCodeAt(0) >= 32) {
      inputText += ch;
      renderInput();
    }
  }

  screen.program.on("keypress", handleKey);

  const originalCleanup = cleanup;
  const wrappedCleanup = () => {
    screen.program.removeListener("keypress", handleKey);
    originalCleanup();
  };

  overlay.on("destroy", () => screen.program.removeListener("keypress", handleKey));
  box.on("destroy", () => screen.program.removeListener("keypress", handleKey));
}
