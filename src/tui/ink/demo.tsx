import React from "react";
import { render, Box, Text } from "ink";
import { Header } from "./Header.js";
import { StatusBar } from "./StatusBar.js";
import { ToolCard } from "./ToolCard.js";
import { palette } from "./theme.js";

/**
 * A static preview of the Ink renderer so the look can be evaluated before the
 * full app is wired to the agent loop. Run with: `sentinel ink`.
 */
function Demo(): React.ReactElement {
  const p = palette();
  const card = { rail: p.rail, ok: p.ok, err: p.err, action: p.primary, dim: p.secondary };
  return (
    <Box flexDirection="column" paddingX={1}>
      <Header
        title="Session 1"
        crumbs={["home", "code", "my-project"]}
        agent="gsd"
        model="glm-4.6"
        colors={{ accent: p.accent, primary: p.primary, dim: p.secondary }}
      />

      <Box marginTop={1}>
        <Text color={p.accent}>you</Text>
      </Box>
      <Text color={p.primary}>run the tests, then show me what summarizeToolResult does</Text>

      <Box marginTop={1}>
        <Text color={p.ok}>● sentinel</Text>
      </Box>
      <ToolCard
        ok
        action="bash npx vitest run"
        summary="47 files"
        output={"✓ Test Files  47 passed (47)\n✓ Tests       360 passed (360)\nDuration 27.1s"}
        colors={card}
      />
      <ToolCard
        ok
        action="read src/tui/format.ts"
        summary="112 lines"
        output={
          "export function summarizeToolResult(name, args, ok, output) {\n" +
          "  const out = output.replace(/^\\[[^\\]]*output\\]\\n/, \"\");\n" +
          "  if (!ok) return firstLine(out) || \"failed\";\n" +
          "  switch (name) {\n" +
          "    case \"file\": return `${countLines(out)} lines`;\n" +
          "    case \"search\": return `${countLines(out)} matches`;"
        }
        colors={card}
      />
      <Box marginTop={1}>
        <Text color={p.primary}>
          It counts lines for reads, parses +/− diff stats for edits, and strips the
          compressor&apos;s wrapper. All tests pass.
        </Text>
      </Box>

      <Box marginTop={1}>
        <StatusBar
          working={false}
          agent="gsd"
          model="glm-4.6"
          context="38.4k tok · 30% saved"
          cost="$0.21"
          tabs={1}
          colors={{ ok: p.ok, warn: p.warn, secondary: p.secondary, dim: p.secondary }}
        />
      </Box>
    </Box>
  );
}

export function runInkDemo(): void {
  const { waitUntilExit } = render(<Demo />);
  void waitUntilExit();
}
