import blessed from "blessed";
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { themeEngine } from "./themes/engine.js";

export function createFileExplorer(
  screen: blessed.Widgets.Screen,
  projectRoot: string
): blessed.Widgets.ListElement {
  const c = themeEngine.getBlessedColors();

  const fileList = blessed.list({
    parent: screen,
    top: 1,
    left: 0,
    width: "100%",
    bottom: 3,
    mouse: true,
    keys: true,
    vi: true,
    style: {
      bg: c.bgPrimary,
      fg: c.textPrimary,
      selected: { bg: c.bgTertiary, fg: c.cyan, bold: true },
      item: { fg: c.textSecondary },
    },
    scrollbar: {
      ch: "│",
      track: { bg: c.bgSecondary },
      style: { fg: c.borderActive },
    },
    tags: true,
  });

  let currentPath = projectRoot;

  function loadDirectory(dirPath: string): void {
    currentPath = dirPath;
    const items: string[] = [];

    if (dirPath !== projectRoot) {
      items.push(`{${c.amber}-fg}  ◈ ../{/}`);
    }

    try {
      const entries = readdirSync(dirPath).sort((a, b) => {
        const aDir = statSync(join(dirPath, a)).isDirectory();
        const bDir = statSync(join(dirPath, b)).isDirectory();
        if (aDir !== bDir) return aDir ? -1 : 1;
        return a.localeCompare(b);
      });

      for (const entry of entries) {
        if (entry.startsWith(".") && entry !== ".") continue;
        const fullPath = join(dirPath, entry);
        const isDir = statSync(fullPath).isDirectory();
        if (isDir) {
          items.push(`{${c.accent}-fg}  ▸ ${entry}/{/}`);
        } else {
          items.push(`{${c.textTertiary}-fg}  ·{/} {${c.textSecondary}-fg}${entry}{/${c.textSecondary}-fg}}`);
        }
      }
    } catch {
      items.push(`{${c.error}-fg}  ✖ Error reading directory{/}`);
    }

    fileList.setItems(items);
    screen.render();
  }

  fileList.on("select", (item) => {
    const text = item.getContent().replace(/\{[^}]+\}/g, "").trim();
    const cleanText = text.replace(/^[▸·◈]\s*/, "");
    const dirName = cleanText.replace(/\/$/, "");
    const fullPath = join(currentPath, dirName);

    if (cleanText === "..") {
      loadDirectory(join(currentPath, ".."));
      return;
    }

    if (existsSync(fullPath) && statSync(fullPath).isDirectory()) {
      loadDirectory(fullPath);
    }
  });

  loadDirectory(projectRoot);
  return fileList;
}
