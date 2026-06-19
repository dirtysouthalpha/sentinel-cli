# Changelog

All notable changes to Sentinel CLI are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/) and this project adheres to
[Semantic Versioning](https://semver.org/).

## [2.0.0] — 2026-06-18

The "codebase intelligence" release. Closes the four gaps that separated
Sentinel from the 2026 leaders (opencode, Claude Code, Aider): LSP structural
awareness, real model-driven compaction, parallel multi-agent teams with
git-worktree isolation, and first-class vision/multimodal. Plus Ponytail
(lazy-senior-dev discipline) on by default at ultra.

### Codebase Intelligence (new)
- **LSP structural awareness.** New `lsp` tool + `LSPManager` spawn language
  servers per language and give the agent real go-to-definition,
  find-all-references, and diagnostics instead of grep-only navigation.
  Graceful degradation: no server configured → falls back to search, never
  throws. Config: `lsp: { typescript: { command, args } }`.
- **Model-driven compaction.** `compactWithSummarizer` is now wired into the
  live agent loop. On overflow, the model produces a real semantic summary
  (preserving decisions, files touched, outcomes) instead of a lossy concat.
  Falls back to the concat path if the summarizer is absent or fails.
- **Parallel multi-agent teams.** `runTeam` fans N tasks out across isolated
  git worktrees (each on its own branch), runs them concurrently, merges
  branches back sequentially, and cleans up. Merge conflicts are reported, not
  force-resolved. Replaces the v1.2 `team.ts` CRUD stub.
- **Git-worktree isolation.** Pure argv builders + `WorktreeManager` over an
  injectable git runner. Parallel agents can no longer race on a shared tree.

### Vision / Multimodal (new)
- **GUI image paste.** Paste an image into the composer → thumbnail chip
  preview (removable) → sent as a multimodal message. No more "save it and
  @mention the path."
- **TUI image @-mention.** `@shot.png` in the TUI loads the image as an
  attachment; non-image mentions still pass to `expandMentions` as text.
- **`attachmentFromDataUrl` / `extractImageMentions`** — pure helpers backing
  both paths.

### Ponytail (new, default ON at ultra)
- Integrated the [Ponytail](https://github.com/DietrichGebert/ponytail) skill
  suite (MIT, DietrichGebert): lazy-senior-dev discipline with a YAGNI ladder
  (stdlib → native → existing dep → one line → minimum). Five builtin skills:
  `ponytail`, `ponytail-review`, `ponytail-audit`, `ponytail-debt`,
  `ponytail-help`.
- **On by default at "ultra"** in the system prompt — the YAGNI ladder governs
  every response. Override in config: `{ "ponytail": { "enabled": false } }`
  or `{ "level": "lite" }`.

### Autonomy
- Agent authors reusable skills via `create_skill` when it hits a repeatable
  sub-task no tool covers.
- `open_url` launches the user's REAL browser for OAuth/login flows.
- Failed tool calls now nudge the agent to research the error (web/search)
  instead of getting stuck.
- Subagent delegation to named specialist agents (orchestrator pattern).
- Parallel tool dispatch within a round (order-preserving).

### Security
- **Cross-platform keyring** (libsecret/Keychain/DPAPI/encrypted-file) with
  env-first secret resolution; legacy plaintext keys scrubbed.
- **Bubblewrap sandbox** for bash on Linux, default-on for autopilot.
- Redaction of secrets from tool output at the trust boundary.
- Browser tool: SSRF guard, screenshot path containment, wrong-page fix.
- WS origin allow-list; atomic config writes; `git config` restricted to
  read-only forms; headless `sentinel run` defaults to gated (not yolo).

### TUI
- Word-motion + kill-line editing keys (Ctrl+A/E/W/U/K, Meta+B/F/D).
- In-conversation search (Ctrl+F), `?` cheatsheet overlay, `/out` full output.
- Markdown rendering: headings, tables, task-lists, lists, blockquotes, hr.
- `/clear` now wipes conversation context, not just the render buffer.
- 20 themes including 5 new cyberpunk×tron themes (vaporwave, synthwave,
  outrun, glitch, hologram).
- Body memoization skips redundant chat re-tokenization.

### GUI
- Incremental `renderChat` (diffBlocks) + stick-to-bottom scroll gate — no
  more full-rebuild flicker.
- Message edit + regenerate; `@`-mention file autocomplete.
- Full theme-palette propagation via CSS variables (no more 16→5 collapse).
- GFM tables, task-list checkboxes, strikethrough.
- Global keymap + cheatsheet + in-chat find.
- First-run onboarding wizard.
- App-window mode (`sentinel gui --window` / `sentinelwindow`).
- Expandable tool cards; real `file:write` diffs.

### Onboarding
- Shared first-run state machine + provider catalog.
- GUI wizard + TUI first-run guide + friendly headless provider help.

### Production
- CI workflow: lint + test + build on push/PR.
- `puppeteer` made optional (dynamic import); bundle 13.9MB → 390KB.

### Tests
- **682 tests** across 90 files (up from ~613 in v1.2). Every new capability
  follows the pure-helper-first pattern: a tested pure module, then a thin
  binding.

---

## [1.2.0] — 2026-06-17

Baseline hardening release: security (keyring, sandbox, redaction, SSRF,
atomic writes, WS origin), TUI/GUI UX overhaul (20 themes, markdown rendering,
search, cheatsheet, incremental render, edit/regenerate, @-mention,
onboarding), autonomy (create_skill, open_url, error→research nudge,
subagent specialists, parallel tool dispatch), and the compaction-strategy
module (cohesive units + summarize seam).
