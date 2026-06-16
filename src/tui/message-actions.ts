/**
 * Interactive message actions - Copy, Reprompt, Edit, Branch, Save, Pin
 */

import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";

export interface MessageAction {
  id: string;
  label: string;
  icon: string;
  action: () => void | Promise<void>;
}

export class MessageActions {
  private overlay?: blessed.Widgets.BoxElement;
  private currentMessage: { role: string; content: string; timestamp?: number } | null = null;
  private actions: MessageAction[] = [];

  constructor(private parent: blessed.Widgets.Screen) {}

  showActions(message: { role: string; content: string; timestamp?: number }) {
    this.currentMessage = message;
    this.actions = this.getActionsForMessage(message);
    this.createUI();
    this.renderActions();
    this.overlay!.show();
    this.overlay!.setFront();
    this.parent.render();
  }

  hideActions() {
    if (this.overlay) {
      this.overlay.hide();
      this.parent.render();
    }
  }

  private getActionsForMessage(message: { role: string; content: string }): MessageAction[] {
    const actions: MessageAction[] = [
      {
        id: "copy",
        label: "Copy",
        icon: "📋",
        action: () => this.copyMessage(),
      },
      {
        id: "edit",
        label: "Edit",
        icon: "✏️",
        action: () => this.editMessage(),
      },
    ];

    if (message.role === "assistant" || message.role === "user") {
      actions.push({
        id: "reprompt",
        label: "Reprompt",
        icon: "🔄",
        action: () => this.reprompt(),
      });
    }

    actions.push(
      {
        id: "branch",
        label: "Branch",
        icon: "🌳",
        action: () => this.branch(),
      },
      {
        id: "save",
        label: "Save",
        icon: "💾",
        action: () => this.save(),
      },
      {
        id: "pin",
        label: "Pin",
        icon: "📌",
        action: () => this.pin(),
      }
    );

    return actions;
  }

  private createUI() {
    if (this.overlay) return;

    const c = themeEngine.getBlessedColors();

    this.overlay = blessed.box({
      parent: this.parent,
      left: "center",
      top: "center",
      width: "50%",
      height: "12",
      hidden: true,
      border: { type: "line" },
      style: {
        bg: c.bgPrimary,
        fg: c.textPrimary,
        border: { fg: c.accent || c.cyan },
      },
    });

    const title = blessed.text({
      parent: this.overlay,
      top: 0,
      left: 1,
      width: "100%-2",
      height: 1,
      content: `{${c.cyan}-fg}{bold}Message Actions{/} {${c.textTertiary}-fg}(Esc to close){/}`,
      tags: true,
    });

    this.overlay.key(["escape"], () => this.hideActions());
  }

  private renderActions() {
    if (!this.overlay) return;

    const c = themeEngine.getBlessedColors();
    let y = 2;

    for (const action of this.actions) {
      const text = blessed.text({
        parent: this.overlay,
        top: y,
        left: 2,
        width: "100%-4",
        height: 1,
        content: `{${c.textPrimary}-fg}${action.icon} {${c.accent}-fg}[${action.label[0]}]{/} ${action.label.slice(1)}{/}`,
        tags: true,
        style: { bg: c.bgPrimary },
        clickable: true,
      });

      text.on("click", () => {
        this.hideActions();
        action.action();
      });

      // Keyboard shortcut
      this.overlay.key([action.label[0].toLowerCase(), action.label[0].toUpperCase()], () => {
        this.hideActions();
        action.action();
      });

      y += 1;
    }
  }

  private copyMessage() {
    if (!this.currentMessage) return;

    try {
      process.stdout.write(`\x1b]52;c;${Buffer.from(this.currentMessage.content).toString("base64")}\x07`);
      this.parent.emit("message-copied");
    } catch (err) {
      // Silent fail
    }
  }

  private editMessage() {
    if (!this.currentMessage) return;
    this.parent.emit("message-edit", this.currentMessage);
  }

  private reprompt() {
    if (!this.currentMessage || this.currentMessage.role !== "user") return;
    this.parent.emit("message-reprompt", this.currentMessage);
  }

  private branch() {
    if (!this.currentMessage) return;
    this.parent.emit("message-branch", this.currentMessage);
  }

  private save() {
    if (!this.currentMessage) return;
    this.parent.emit("message-save", this.currentMessage);
  }

  private pin() {
    if (!this.currentMessage) return;
    this.parent.emit("message-pin", this.currentMessage);
  }
}