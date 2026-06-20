---
name: fork
description: Fork the current session at a turn index — create a new session branched from that point. Explore alternatives without losing the trunk. Usage: /fork [turn-index] (default: fork at the latest turn).
agent: ask
---

# SESSION FORK

Fork the current conversation at the specified turn index (or the latest turn if no index is given). This creates a NEW session containing a copy of all messages up to that point, letting you explore a different path without losing the original.

The forked session gets the title "(fork)" appended. The original session is untouched — switch back to it any time with the tab bar.

If no argument is given, forks at the latest turn (effectively duplicating the session for a fresh direction).
