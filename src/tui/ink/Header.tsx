import React from "react";
import { Box, Text } from "ink";

export interface HeaderColors {
  accent: string;
  primary: string;
  dim: string;
}

export interface HeaderProps {
  title: string;
  /** Path crumbs, e.g. ["home", "code", "my-project"]. */
  crumbs: string[];
  agent: string;
  model: string;
  colors: HeaderColors;
}

export function Header({ title, crumbs, agent, model, colors }: HeaderProps): React.ReactElement {
  return (
    <Box>
      <Text color={colors.accent}>● </Text>
      <Text color={colors.primary} bold>
        {title}
      </Text>
      <Text>{"   "}</Text>
      {crumbs.map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <Text color={colors.dim}>{" › "}</Text> : null}
          <Text color={i === 0 ? colors.accent : colors.dim}>{c}</Text>
        </React.Fragment>
      ))}
      <Text>{"   "}</Text>
      <Text color={colors.dim}>{`${agent} · ${model}`}</Text>
    </Box>
  );
}
