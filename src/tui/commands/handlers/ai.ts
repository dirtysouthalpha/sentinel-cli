import type { CommandSpec } from "../context.js";
import { parsePipeline, type Pipeline } from "../../../core/pipeline-engine.js";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { providerManager } from "../../../ai/provider.js";
import { state } from "../../../core/state.js";
import { loadAttachment } from "../../../core/attachments.js";
import { buildVisionMessage } from "../../../core/vision.js";

export const aiCommands: CommandSpec[] = [
  {
    name: "pipeline",
    async run(ctx) {
      const sub = (ctx.args[0] || "").toLowerCase();
      const rawPath = ctx.args.slice(1).join(" ").trim();
      if (sub !== "run" || !rawPath) {
        ctx.addSystem("Usage: /pipeline run <path.json>");
        return;
      }
      const filePath = isAbsolute(rawPath) ? rawPath : resolve(ctx.projectRoot, rawPath);
      let pipeline: Pipeline;
      try {
        pipeline = parsePipeline(readFileSync(filePath, "utf8"));
      } catch (err) {
        ctx.addError(
          `Pipeline load failed: ${err instanceof Error ? err.message : String(err)}`
        );
        return;
      }
      await ctx.runPipeline(pipeline);
      return;
    },
  },
  {
    name: "ship",
    async run(ctx) {
      const task = ctx.args.join(" ").trim();
      if (!task) {
        ctx.addSystem("Usage: /ship <task>  — autonomously plan, implement, test, review, and fix");
        return;
      }
      await ctx.runGsd(task);
      return;
    },
  },
  {
    name: "ask-prime",
    async run(ctx) {
      const question = ctx.args.join(" ").trim();
      if (!question) {
        ctx.addSystem("Usage: /ask-prime <question>");
        return;
      }
      const prime = providerManager.getProvider("sentinel-prime");
      if (!prime || !prime.isAvailable()) {
        ctx.addError(
          "Sentinel Prime not configured — add a `sentinel-prime` provider in config."
        );
        return;
      }
      try {
        const res = await prime.chat([{ role: "user", content: question }], {
          model: "hermes-agent",
        });
        ctx.addSystem(res.content || "(no answer)");
      } catch (err) {
        ctx.addError(`Sentinel Prime error: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    },
  },
  {
    name: "describe",
    async run(ctx) {
      const imagePath = ctx.args[0];
      if (!imagePath) {
        ctx.addSystem('Usage: /describe <imagePath> [prompt]');
        return;
      }
      const prompt = ctx.args.slice(1).join(" ").trim() || "Describe this image in detail.";

      let att;
      try {
        att = loadAttachment(resolve(ctx.projectRoot, imagePath));
      } catch (err) {
        ctx.addError(err instanceof Error ? err.message : String(err));
        return;
      }

      const [providerName, ...modelParts] = state.get("currentModel").split("/");
      const modelName = modelParts.join("/") || undefined;
      const provider = providerManager.getProvider(providerName);
      if (!provider) {
        ctx.addError(`No provider "${providerName}". Try /providers`);
        return;
      }
      if (!provider.isAvailable()) {
        ctx.addError(`No API key for "${providerName}". Type /connect`);
        return;
      }

      ctx.addSystem(`Describing ${att.name} with ${state.get("currentModel")}...`);
      try {
        const res = await provider.chat([buildVisionMessage(prompt, [att])], {
          model: modelName,
        });
        ctx.addSystem(res.content || "(no description)");
      } catch (err) {
        ctx.addError(`Vision error: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    },
  },
];
