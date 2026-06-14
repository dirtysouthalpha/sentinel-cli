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
    async run(ctx) {
      ctx.addSystem(usageTracker.render());
      return;
    },
  },
  {
    name: "export",
    async run(ctx) {
      handleExportCommand(ctx.slashCtx(), ctx.args);
      return;
    },
  },
  {
    name: "branch",
    async run(ctx) {
      handleBranchCommand(ctx.slashCtx());
      return;
    },
  },
  {
    name: "tabs",
    async run(ctx) {
      handleTabsCommand(ctx.slashCtx(), ctx.args);
      return;
    },
  },
  {
    name: "workspace",
    aliases: ["ws"],
    async run(ctx) {
      handleWorkspaceCommand(ctx.slashCtx(), ctx.args);
      return;
    },
  },
  {
    name: "team",
    async run(ctx) {
      handleTeamCommand(ctx.slashCtx(), ctx.args);
      return;
    },
  },
];
