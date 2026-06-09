import React from "react";
import { Box, Text } from "ink";

export interface StatusColors {
  ok: string;
  warn: string;
  secondary: string;
  dim: string;
}

export interface StatusBarProps {
  working: boolean;
  agent: string;
  model: string;
  /** e.g. "12.6k tok · 30% saved". */
  context: string;
  /** e.g. "$0.045". */
  cost?: string;
  tabs: number;
  colors: StatusColors;
}

export function StatusBar({
  working,
  agent,
  model,
  context,
  cost,
  tabs,
  colors,
}: StatusBarProps): React.ReactElement {
  const sep = <Text color={colors.dim}>{"  │  "}</Text>;
  return (
    <Box>
      <Text color={working ? colors.warn : colors.ok}>● </Text>
      <Text color={colors.secondary}>{working ? "working" : "ready"}</Text>
      {sep}
      <Text color={colors.secondary}>{`${agent} · ${model}`}</Text>
      {sep}
      <Text color={colors.secondary}>{context}</Text>
      {cost ? (
        <>
          {sep}
          <Text color={colors.secondary}>{cost}</Text>
        </>
      ) : null}
      {sep}
      <Text color={colors.dim}>{`${tabs} tab${tabs === 1 ? "" : "s"}`}</Text>
    </Box>
  );
}
