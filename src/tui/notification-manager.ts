/**
 * Notifications / Toast Messages for background tasks and alerts
 */

import blessed from "blessed";
import { themeEngine } from "./themes/engine.js";

export type NotificationType = "info" | "success" | "warning" | "error" | "progress";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  duration?: number; // ms to auto-dismiss, 0 = persistent
  timestamp: number;
  action?: { label: string; callback: () => void };
}

export class NotificationManager {
  private toasts: blessed.Widgets.BoxElement[] = [];
  private notifications: Notification[] = [];
  private maxToasts = 3;
  private toastWidth = 50;

  constructor(private parent: blessed.Widgets.Screen) {}

  notify(options: Omit<Notification, "id" | "timestamp">): string {
    const notification: Notification = {
      ...options,
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: Date.now(),
    };

    this.notifications.push(notification);
    this.showToast(notification);

    // Auto-dismiss if duration is set
    if (options.duration && options.duration > 0) {
      setTimeout(() => this.dismiss(notification.id), options.duration);
    }

    return notification.id;
  }

  info(title: string, message: string, duration = 5000): string {
    return this.notify({ type: "info", title, message, duration });
  }

  success(title: string, message: string, duration = 3000): string {
    return this.notify({ type: "success", title, message, duration });
  }

  warning(title: string, message: string, duration = 5000): string {
    return this.notify({ type: "warning", title, message, duration });
  }

  error(title: string, message: string, duration = 8000): string {
    return this.notify({ type: "error", title, message, duration });
  }

  progress(title: string, message: string): string {
    return this.notify({ type: "progress", title, message, duration: 0 });
  }

  dismiss(id: string) {
    const idx = this.notifications.findIndex(n => n.id === id);
    if (idx === -1) return;

    this.notifications.splice(idx, 1);

    // Remove toast
    const toast = this.toasts.find(t => t.data?.id === id);
    if (toast) {
      this.removeToast(toast);
    }
  }

  dismissAll() {
    for (const toast of [...this.toasts]) {
      this.removeToast(toast);
    }
    this.notifications = [];
  }

  private showToast(notification: Notification) {
    const c = themeEngine.getBlessedColors();

    // Remove oldest toast if at max
    if (this.toasts.length >= this.maxToasts) {
      this.removeToast(this.toasts[0]);
    }

    const toast = blessed.box({
      parent: this.parent,
      right: 1,
      top: 1 + this.toasts.length * 4,
      width: this.toastWidth,
      height: 3,
      border: { type: "line" },
      style: {
        bg: c.bgPrimary,
        fg: c.textPrimary,
        border: { fg: this.getTypeColor(notification.type) },
      },
    });

    toast.data = { id: notification.id };

    const icon = this.getTypeIcon(notification.type);
    const color = this.getTypeColor(notification.type);

    const content = blessed.text({
      parent: toast,
      top: 0,
      left: 1,
      width: "100%-2",
      height: "100%",
      content: `{${color}-fg}${icon} {bold}${notification.title}{/}\n{${c.textSecondary}-fg}${this.truncate(notification.message, this.toastWidth - 4)}{/}`,
      tags: true,
      style: { bg: c.bgPrimary },
    });

    // Click to dismiss
    toast.on("click", () => this.dismiss(notification.id));

    // Show toast with animation (fade in)
    toast.show();
    this.toasts.push(toast);
    this.parent.render();
  }

  private removeToast(toast: blessed.Widgets.BoxElement) {
    const idx = this.toasts.indexOf(toast);
    if (idx !== -1) {
      this.toasts.splice(idx, 1);
    }

    toast.destroy();

    // Reposition remaining toasts
    this.toasts.forEach((t, i) => {
      t.top = 1 + i * 4;
    });

    this.parent.render();
  }

  private getTypeIcon(type: NotificationType): string {
    const icons = {
      info: "ℹ️",
      success: "✓",
      warning: "⚠️",
      error: "✗",
      progress: "▶",
    };
    return icons[type];
  }

  private getTypeColor(type: NotificationType): string {
    const c = themeEngine.getBlessedColors();
    const colors = {
      info: c.cyan,
      success: c.lime,
      warning: c.amber,
      error: c.error,
      progress: c.magenta,
    };
    return colors[type] || c.textPrimary;
  }

  private truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - 1) + "…";
  }

  // Show notification history
  showHistory() {
    const c = themeEngine.getBlessedColors();

    const overlay = blessed.box({
      parent: this.parent,
      left: "center",
      top: "center",
      width: "70%",
      height: "70%",
      border: { type: "line" },
      style: {
        bg: c.bgPrimary,
        fg: c.textPrimary,
        border: { fg: c.accent || c.cyan },
      },
    });

    const title = blessed.text({
      parent: overlay,
      top: 0,
      left: 1,
      width: "100%-2",
      height: 1,
      content: `{${c.cyan}-fg}{bold}Notification History{/} {${c.textTertiary}-fg}(Esc to close){/}`,
      tags: true,
    });

    let content = "";
    for (const notif of this.notifications.slice(-20).reverse()) {
      const icon = this.getTypeIcon(notif.type);
      const color = this.getTypeColor(notif.type);
      const time = new Date(notif.timestamp).toLocaleTimeString();

      content += `{${color}-fg}${icon}{/} {${c.textPrimary}-fg}${notif.title}{/}\n`;
      content += `{${c.textTertiary}-fg}  ${time} · ${notif.message}{/}\n\n`;
    }

    if (this.notifications.length === 0) {
      content = `{${c.textTertiary}-fg}No notifications yet.{/}`;
    }

    const box = blessed.box({
      parent: overlay,
      top: 2,
      left: 1,
      width: "100%-2",
      height: "100%-3",
      content,
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      mouse: true,
      scrollbar: {
        ch: " ",
        style: { bg: c.border },
      },
      style: {
        bg: c.bgPrimary,
        fg: c.textPrimary,
      },
    });

    overlay.key(["escape"], () => {
      overlay.destroy();
      this.parent.render();
    });

    overlay.show();
    overlay.setFront();
    this.parent.render();
  }
}