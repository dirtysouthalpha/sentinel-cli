import type { CommandSpec } from "../context.js";
import { usageTracker } from "../../../core/usage-tracker.js";
import { sessionManager } from "../../../core/session-manager.js";
import {
  handleExportCommand,
  handleBranchCommand,
  handleTabsCommand,
  handleWorkspaceCommand,
  handleTeamCommand,
} from "../../slash-handlers.js";

export const sessionCommands: CommandSpec[] = [
  {
    name: "compact",
    description: "Compress context (save tokens)",
    group: "session",
    async run(ctx) {
      const cm = ctx.getContextManager();
      const before = cm.getMessageCount();
      cm.compact();
      const after = cm.getMessageCount();
      ctx.addSystem(`Compacted: ${before} → ${after} messages.`);
      const activeId = sessionManager.getActiveSessionId();
      if (activeId) sessionManager.markDirty(activeId);
      return;
    },
  },
  {
    name: "context",
    description: "Show conversation size (messages + token estimate)",
    group: "session",
    async run(ctx) {
      const cm = ctx.getContextManager();
      const msgs = cm.getMessages();
      const totalChars = msgs.reduce((sum, m) => sum + m.content.length, 0);
      ctx.addSystem(
        [
          "Context:",
          `  Messages: ${msgs.length}`,
          `  Size: ~${Math.ceil(totalChars / 4)} tokens`,
          "  Auto-compacts as it fills.",
        ].join("\n")
      );
      return;
    },
  },
  {
    name: "cost",
    description: "Session cost breakdown",
    group: "session",
    async run(ctx) {
      const cost = ctx.getCost();
      ctx.addSystem(
        [
          "Session cost:",
          `  Prompt:     ${cost.promptTokens.toLocaleString()} tokens`,
          `  Completion: ${cost.completionTokens.toLocaleString()} tokens`,
          `  Total:      ${cost.totalTokens.toLocaleString()} tokens`,
          `  Requests:   ${cost.requests}`,
          `  Est. cost:  $${cost.estimatedCostUSD.toFixed(4)}`,
        ].join("\n")
      );
      return;
    },
  },
  {
    name: "usage",
    description: "Usage metrics: tokens, cost, per-tool table",
    group: "session",
    async run(ctx) {
      ctx.addSystem(usageTracker.render());
      return;
    },
  },
  {
    name: "export",
    description: "Export this session's transcript to a file",
    usage: "[md|html] [path]",
    group: "session",
    async run(ctx) {
      handleExportCommand(ctx.slashCtx(), ctx.args);
      return;
    },
  },
  {
    name: "branch",
    description: "Duplicate this session into a new tab",
    group: "session",
    async run(ctx) {
      handleBranchCommand(ctx.slashCtx());
      return;
    },
  },
  {
    name: "tabs",
    description: "List and switch session tabs",
    usage: "...",
    group: "session",
    async run(ctx) {
      handleTabsCommand(ctx.slashCtx(), ctx.args);
      return;
    },
  },
  {
    name: "workspace",
    aliases: ["ws"],
    description: "Multi-repo roots: list | add | remove | use",
    usage: "...",
    group: "extensions",
    async run(ctx) {
      handleWorkspaceCommand(ctx.slashCtx(), ctx.args);
      return;
    },
  },
  {
    name: "team",
    description: "Shared team: info | name <n> | registry <url> | add | remove",
    usage: "...",
    group: "extensions",
    async run(ctx) {
      handleTeamCommand(ctx.slashCtx(), ctx.args);
      return;
    },
  },
];
