import React from "react";
import { Box, Text } from "ink";

export interface ToolCardColors {
  rail: string;
  ok: string;
  err: string;
  action: string;
  dim: string;
}

export interface ToolCardProps {
  ok: boolean;
  /** Humanized action, e.g. "read README.md". */
  action: string;
  /** Short result summary, e.g. "268 lines". */
  summary?: string;
  /** Raw tool output; previewed and collapsed. */
  output?: string;
  previewLines?: number;
  colors: ToolCardColors;
}

/**
 * A bordered tool-call card: a status header (✓/✗ + action + summary) and a
 * truncated preview of the output body, with the remainder collapsed. Ink's
 * border box contains its content, so the frame never breaks on wrap.
 */
export function ToolCard({
  ok,
  action,
  summary,
  output,
  previewLines = 5,
  colors,
}: ToolCardProps): React.ReactElement {
  const body = (output ?? "").replace(/^\[[^\]]*output\]\n/, "").replace(/\s+$/, "");
  const lines = body ? body.split("\n") : [];
  const shown = lines.slice(0, previewLines);
  const extra = lines.length - shown.length;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={colors.rail} paddingX={1}>
      <Box>
        <Text color={ok ? colors.ok : colors.err}>{ok ? "✓" : "✗"} </Text>
        <Text color={colors.action}>{action}</Text>
        {summary ? <Text color={colors.dim}>{"  " + summary}</Text> : null}
      </Box>
      {shown.map((line, i) => (
        <Text key={i} color={colors.dim} wrap="truncate-end">
          {line.length > 0 ? line : " "}
        </Text>
      ))}
      {extra > 0 ? (
        <Text color={colors.dim}>{`… ${extra} more line${extra === 1 ? "" : "s"}`}</Text>
      ) : null}
    </Box>
  );
}
