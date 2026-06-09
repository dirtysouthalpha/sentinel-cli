import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ToolCard } from "../src/tui/ink/ToolCard.js";
import { Header } from "../src/tui/ink/Header.js";
import { StatusBar } from "../src/tui/ink/StatusBar.js";

const colors = {
  rail: "#8A8A86",
  ok: "#7FB685",
  err: "#C76B6B",
  action: "#D7D7D2",
  dim: "#8A8A86",
  accent: "#5FB3A1",
  primary: "#D7D7D2",
  secondary: "#8A8A86",
  warn: "#C9A26A",
};

describe("ToolCard", () => {
  it("renders a bordered card with header, body preview, and collapse hint", () => {
    const { lastFrame } = render(
      <ToolCard
        ok
        action="read README.md"
        summary="268 lines"
        output={"# Title\nline2\nline3\nline4\nline5\nline6\nline7"}
        previewLines={5}
        colors={colors}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("read README.md");
    expect(out).toContain("268 lines");
    expect(out).toContain("# Title");
    expect(out).toContain("more lines"); // 2 extra lines collapsed
    expect(out).toMatch(/[╭╮╰╯│]/); // real border characters
  });

  it("strips the compressor's [tool output] wrapper", () => {
    const { lastFrame } = render(
      <ToolCard ok action="read x" output={"[file output]\nhello"} colors={colors} />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("hello");
    expect(out).not.toContain("[file output]");
  });
});

describe("Header", () => {
  it("renders title, crumbs, and agent · model", () => {
    const { lastFrame } = render(
      <Header
        title="Session 1"
        crumbs={["home", "code", "my-project"]}
        agent="gsd"
        model="glm-4.6"
        colors={colors}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("Session 1");
    expect(out).toContain("my-project");
    expect(out).toContain("gsd · glm-4.6");
  });
});

describe("StatusBar", () => {
  it("renders state, mode, context, cost, and tabs", () => {
    const { lastFrame } = render(
      <StatusBar
        working={false}
        agent="gsd"
        model="glm-4.6"
        context="12.6k tok · 30% saved"
        cost="$0.045"
        tabs={1}
        colors={colors}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("ready");
    expect(out).toContain("12.6k tok");
    expect(out).toContain("$0.045");
    expect(out).toContain("1 tab");
  });
});
