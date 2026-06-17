import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";
import { TabDef, createTabBar } from "./tab-bar.js";
import { showTabRenameModal } from "./tab-rename-modal.js";
import { sessionManager, Session } from "../core/session-manager.js";
import { state } from "../core/state.js";

export class TabManager {
  private tabBar: blessed.Widgets.BoxElement & { updateTabs?: (tabs: TabDef[]) => void };
  private screen: blessed.Widgets.Screen;
  private onSwitch: (session: Session) => void;
  private onClose: (sessionId: string) => void;
  private onCreate: () => void;

  constructor(options: {
    screen: blessed.Widgets.Screen;
    onSwitch: (session: Session) => void;
    onClose: (sessionId: string) => void;
    onCreate: () => void;
  }) {
    this.screen = options.screen;
    this.onSwitch = options.onSwitch;
    this.onClose = options.onClose;
    this.onCreate = options.onCreate;

    this.tabBar = createTabBar({
      screen: this.screen,
      onTabSelect: (id) => this.switchTab(id),
    }) as blessed.Widgets.BoxElement & { updateTabs?: (tabs: TabDef[]) => void };
  }

  getTabBar(): blessed.Widgets.BoxElement {
    return this.tabBar;
  }

  refresh(): void {
    const sessions = sessionManager.getAllSessions();
    const activeId = sessionManager.getActiveSessionId();

    const tabs: TabDef[] = sessions.map((s) => ({
      id: s.id,
      title: s.title,
      active: s.id === activeId,
      pinned: s.pinned,
      modified: false,
    }));

    this.tabBar.updateTabs?.(tabs);
  }

  switchTab(sessionId: string): void {
    const session = sessionManager.getSession(sessionId);
    if (!session) return;
    const activeId = sessionManager.getActiveSessionId();
    if (activeId === sessionId) return;

    sessionManager.setActiveSession(sessionId);
    this.onSwitch(session);
    this.refresh();
  }

  closeTab(sessionId: string): void {
    this.onClose(sessionId);
    this.refresh();
  }

  createTab(): void {
    this.onCreate();
    this.refresh();
  }

  nextTab(): void {
    const sessions = sessionManager.getAllSessions();
    const activeId = sessionManager.getActiveSessionId();
    const idx = sessions.findIndex((s) => s.id === activeId);
    const nextIdx = (idx + 1) % sessions.length;
    this.switchTab(sessions[nextIdx].id);
  }

  previousTab(): void {
    const sessions = sessionManager.getAllSessions();
    const activeId = sessionManager.getActiveSessionId();
    const idx = sessions.findIndex((s) => s.id === activeId);
    const prevIdx = (idx - 1 + sessions.length) % sessions.length;
    this.switchTab(sessions[prevIdx].id);
  }

  switchToIndex(index: number): void {
    const sessions = sessionManager.getAllSessions();
    if (index >= 0 && index < sessions.length) {
      this.switchTab(sessions[index].id);
    }
  }

  renameTab(sessionId: string): void {
    const session = sessionManager.getSession(sessionId);
    if (!session) return;

    const existingTitles = sessionManager.getAllSessions()
      .map((s) => s.title)
      .filter((t) => t !== session.title);

    showTabRenameModal({
      screen: this.screen,
      currentTitle: session.title,
      existingTitles,
      onConfirm: (newTitle) => {
        sessionManager.renameSession(sessionId, newTitle);
        this.refresh();
      },
      onCancel: () => {},
    });
  }

  renameCurrentTab(): void {
    const activeId = sessionManager.getActiveSessionId();
    if (activeId) this.renameTab(activeId);
  }

  togglePin(sessionId: string): void {
    sessionManager.togglePin(sessionId);
    this.refresh();
  }

  togglePinCurrent(): void {
    const activeId = sessionManager.getActiveSessionId();
    if (activeId) this.togglePin(activeId);
  }
}
