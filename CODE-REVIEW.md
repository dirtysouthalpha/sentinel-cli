---
status: issues_found
date: 2026-06-09
scope: full codebase (src/**, 92 files reviewed)
depth: standard
reviewers: 3 (tui, ai/tools/mcp, core/server/cli)
findings:
  critical: 6
  warning: 27
  info: 13
  total: 46
---

# Sentinel CLI — Code Review

Reviewed via `/gsd-code-review` (adapted: no GSD phase exists, so the full `src/` tree was
reviewed by three parallel `gsd-code-reviewer` agents at standard depth).

## Critical

### C-01: Command injection via search pattern (RCE through a "read-only" tool)
**File:** `src/tools/search.ts:52,64`
The grep search interpolates the model-supplied `pattern` (and `include`) directly into a
shell command for both PowerShell (`Select-String -Pattern "${pattern}"`) and bash
(`grep -E "${pattern}"`). Inside bash double-quotes, `$(...)` is still evaluated, so a
pattern like `$(rm -rf ~)` executes arbitrary commands; on Windows a `"` breaks out of the
quoted argument. Patterns can originate from prompt-injected file/web content.
**Fix:** Pass `pattern`/`include` as a separate argument array (no shell), or escape/validate first.

### C-02: API keys saved by `sentinel setup` are never read by the provider layer
**File:** `src/commands/setup.ts:54-60` (also 79, 100, 124, 149); `src/ai/provider.ts:51-93`
The setup wizard persists keys as `provider.<name>.options.apiKey`, but `initializeFromConfig`
passes each entry to provider constructors that read flat `config.apiKey`. Keys configured via
the official onboarding path are silently ignored — providers report "No API key" unless an
env var happens to be set. The GUI's `config-store.ts` writes the flat shape, so the two
writers produce incompatible configs.
**Fix:** Normalize in `initializeFromConfig` (e.g. `{ ...cfg, ...(cfg.options ?? {}) }`) or write the flat shape from setup/connect.

### C-03: Path traversal in marketplace skill install — arbitrary `.md` write from remote registry
**File:** `src/core/marketplace.ts:194`
`installEntry` writes to `join(skillsDir, \`${entry.id}.md\`)` where `entry.id` comes from a
remote registry and is only checked as a non-empty string. An id like `../../CLAUDE` escapes
`.sentinel/skills/` and overwrites any `.md` in or above the project — including `CLAUDE.md`,
which is injected into every future system prompt (persistent prompt injection). `sync.ts` has
`safeFilename()` for exactly this; marketplace.ts doesn't use it.
**Fix:** Sanitize the filename stem or verify `resolve(dest)` stays under `skillsDir` before writing.

### C-04: Ctrl+C clears `isProcessing` while the agentic run is still alive — two concurrent runs corrupt shared state
**File:** `src/tui/app.ts:553-560, 1426-1429`
The Ctrl+C handler sets `isProcessing = false` right after `this.ac?.abort()`, but
`AgentRunner.run` only checks the signal between rounds/tools and never passes it to
`provider.chatStream` (`src/core/agent-runner.ts:124`), so the aborted run keeps streaming.
The user can submit a new message, starting a second `chatWithAI` that shares `this.ac`,
`this.stream`, `this.streamRaw`, and `this.pendingToolArgs` with the first run — interleaved
transcripts, wrong tool cards, and a run Ctrl+C can no longer stop.
**Fix:** Let the run's own `finally` clear `isProcessing`; propagate the AbortSignal into `chatStream`.

### C-05: `/quit` and Ctrl+Q exit without `destroy()` — drops un-flushed session data, orphans MCP children
**File:** `src/tui/app.ts:819-823, 1652-1655`
Both quit paths destroy the screen and `process.exit(0)` directly, skipping `this.destroy()`
which flushes dirty sessions (`sessionManager.shutdown()`; autosave only runs every 30s) and
disconnects MCP servers. Quitting right after a turn silently drops up to 30 seconds of
session history; the `cli.ts` cleanup handler only covers SIGINT/SIGTERM.
**Fix:** Route both handlers through `this.destroy()` before exiting.

### C-06: `/pipeline` and `/ship` runs cannot be cancelled, but Ctrl+C reports "Cancelled."
**File:** `src/tui/app.ts:1440-1506, 1515-1586` (vs. 555-560)
`runPipelineDelegated` and `runGsdDelegated` never create `this.ac` and pass no AbortSignal to
`subagentTool.execute`. Ctrl+C during a pipeline aborts nothing, prints "Cancelled.", and
unlocks the input — the user believes the autonomous run (possibly editing files in yolo mode)
stopped, and can start a concurrent chat run on top of it.
**Fix:** Create an AbortController in both runners, thread its signal into subagent executions, and only report "Cancelled." when something was aborted.

## Warnings

### W-01: Global→project config merge is shallow — global provider keys silently dropped
**File:** `src/core/config.ts:60-63`
`deepMerge(DEFAULT_CONFIG, { ...globalConfig, ...projectConfig })` spreads shallowly first, so
any top-level key in the project file (`provider`, `permissions`, `mcp`, `skills`) wholesale
replaces the global object. A project `sentinel.json` with `provider: { zai: {...} }` erases
globally configured anthropic/openai keys. CLAUDE.md documents the layering as deep-merged.
**Fix:** `deepMerge(deepMerge({ ...DEFAULT_CONFIG }, globalConfig), projectConfig)`.

### W-02: `getInstallRoot()` breaks on install paths with spaces (and lowercase drive letters)
**File:** `src/cli.ts:45-49`
`new URL("..", import.meta.url).pathname` percent-encodes spaces (`%20`) and the regex
`/^\/([A-Z]:)/` misses lowercase drives. A global npm install under `C:\Users\John Doe\...`
yields a nonexistent path, so all builtin skills/commands/agents (including the default `gsd`
agent prompt) silently fail to load.
**Fix:** Use `fileURLToPath(new URL("..", import.meta.url))` from `node:url`.

### W-03: `&` in GUI URL splits the Windows `start` command — auto-open sends a token-less URL
**File:** `src/server/gui-launcher.ts:62`
`spawn("cmd", ["/c", "start", "", url])` passes the unquoted URL `...?port=N&token=HEX` to
cmd.exe, which treats `&` as a command separator: the browser opens `...?port=N` (no token)
and the auto-opened GUI is rejected with `1008 bad token` on every Windows launch.
**Fix:** Escape for cmd (`url.replace(/&/g, "^&")`) or open via `rundll32 url.dll,FileProtocolHandler`.

### W-04: Pending permission request deadlocks the serve connection; resolver can be overwritten
**File:** `src/server/serve.ts:131-132, 140, 167-172, 352-356`
If the client disconnects or cancels mid-ask, `ws.on("close")` only calls `ac.abort()` — the
stored `permResolver` promise never resolves, so `runner.run` hangs and `busy` stays true
forever. Two concurrent permission requests also overwrite the resolver, stranding the first.
**Fix:** On close/cancel, resolve the pending resolver with `false`; reject overlapping requests.

### W-05: Context compaction drops the real system prompt on Anthropic
**File:** `src/ai/context.ts:112-119`
`compact()` inserts a `role: "system"` summary into the message list; the Anthropic provider
assigns `system` from each system message in order, so the summary overwrites the real system
prompt — after the first auto-compaction the agent loses its instructions. Compaction can also
sever an assistant(tool_calls)→tool pair, producing an OpenAI 400.
**Fix:** Keep the summary as a non-system role and preserve tool-call/result pairing.

### W-06: Path-traversal guard uses prefix match without separator
**File:** `src/tools/file.ts:26`; `src/tools/patch.ts:23`
`resolved.startsWith(resolve(projectRoot))` treats a sibling directory with a shared prefix
(`/home/u/app` vs `/home/u/app-secrets`) as "inside" the project.
**Fix:** Compare against `resolve(projectRoot) + path.sep`, or use `path.relative` and reject `..` results.

### W-07: Git tool interpolates action/args into a shell command
**File:** `src/tools/git.ts:16`
`git ${action}${extraArgs}` runs via `exec` with no escaping; `action` like `status; <cmd>`
executes arbitrary commands through a tool that presents as constrained.
**Fix:** Allow-list git subcommands; pass arguments without shell interpolation.

### W-08: Web tool has no URL validation (SSRF)
**File:** `src/tools/web.ts:26`
URLs are fetched with no scheme/host restrictions, allowing requests to localhost, internal
services, or cloud metadata endpoints (`169.254.169.254`) via prompt injection.
**Fix:** Allow http/https only; block private/loopback/link-local hosts.

### W-09: Browser screenshot writes to an arbitrary path
**File:** `src/tools/browser.ts:80-83`
`filePath` from tool args goes straight to `page.screenshot({ path })` with no containment —
the model can write a PNG anywhere on disk.
**Fix:** Resolve against project root; reject escaping paths.

### W-10: Browser actions operate on the wrong page after navigate
**File:** `src/tools/browser.ts:54-55, 63-65`
`navigate`/`scrape` create a new page, but `click`/`type`/`screenshot`/`waitFor` always use
`pages[0]` (the initial blank page). After navigation, actions silently target `about:blank`.
**Fix:** Track and reuse a single active `Page` across actions.

### W-11: Hook commands run config strings through the shell with model-controlled tool args in env
**File:** `src/core/hooks.ts:89-101`
`exec(cmd, { shell })` with `SENTINEL_TOOL_ARGS` carrying raw tool arguments; a hook like
`echo $SENTINEL_TOOL_ARGS` lets a malicious payload break into shell execution.
**Fix:** Run with `shell:false`/argv array, or escape/redact the env payload.

### W-12: Tab-rename modal double-feeds keystrokes into the main input; Enter submits the title as a chat message
**File:** `src/tui/tab-rename-modal.ts:116`; `src/tui/app.ts:499, 543-545`
The modal listens on `screen.program` keypress while `setupRawInput()`'s stdin handler stays
active. Typing a tab name also edits the hidden main buffer; Enter both confirms the rename
and `submit()`s the title to the AI (a real, billed agent turn in yolo mode).
**Fix:** Suppress `onInputChunk` while a modal is open.

### W-13: `askPermission` overwrites `pendingPermission`, hanging concurrent requests
**File:** `src/tui/app.ts:1317-1319`
With gated mode and parallel pipeline steps, two guarded tool calls can ask simultaneously;
the first resolver is silently discarded and never settles, deadlocking that step.
**Fix:** Queue permission requests instead of a single overwritable field.

### W-14: Escape sequences split across stdin chunks leak literal `[A` characters into the input
**File:** `src/tui/app.ts:515-529`
A chunk ending in bare ESC (common over SSH/ConPTY) is treated as a lone escape; continuation
bytes `[A` arriving next are inserted as text — the exact leak the comment claims was fixed.
**Fix:** Buffer incomplete ESC/CSI prefixes and prepend to the next chunk.

### W-15: Multi-line paste fires `submit()` on every embedded newline
**File:** `src/tui/app.ts:543-545, 578-583`
Each `\n` in a pasted chunk is treated as Enter: the first line is sent as a prompt
immediately; the rest mangles the buffer. No bracketed-paste mode is enabled.
**Fix:** Enable bracketed paste (`\x1b[?2004h`) and treat `200~`/`201~` as a single insert.

### W-16: `/clear` never clears the conversation context
**File:** `src/tui/app.ts:825-831`
Only `transcript`/`stream` are reset; `ContextManager.clear()` is never called, so the model
still receives the entire prior conversation — full token cost and "remembered" content.
**Fix:** Call `contextManager.clear()` in the `/clear` branch.

### W-17: Tab switch zeroes token/request counters but seeds dollars
**File:** `src/tui/app.ts:1625-1631, 444-452`
`/cost` reports "0 tokens, 0 requests" alongside non-zero cost; original tab's tallies lost.
**Fix:** Persist and restore full token counters per session.

### W-18: Hardcoded $3/$15 pricing disagrees with the real pricing module
**File:** `src/tui/app.ts:481-487`; `src/server/serve.ts:482-484`
`updateCost` and serve both hardcode Sonnet-class rates while `estimateCostUSD` (per-model)
feeds `/usage` — two sources of truth, one wrong for every non-Claude model including the
default `zai/glm-4.6`.
**Fix:** Use `estimateCostUSD(state.get("currentModel"), ...)` in both places.

### W-19: Compression cache keyed by 32-bit hash can return wrong output
**File:** `src/ai/compression.ts:13-21, 72`
On a djb2 collision, `compressToolOutput` returns an unrelated cached output, silently feeding
the model incorrect data.
**Fix:** Use SHA-256 (or compare original content) for the cache key.

### W-20: Subagent recursion bound is advisory, not enforced
**File:** `src/core/subagent.ts:258-260`; `src/cli.ts:267-272`
The child runner omits the subagent tool from `toolDefs`, but its executor still intercepts
`subagent` calls (reachable via the fenced-block fallback parser), allowing another nesting level.
**Fix:** Reject `subagent` calls when nesting depth ≥ 1.

### W-21: `applyBundle` writes imported skills/workflows verbatim (prompt-injection on next load)
**File:** `src/core/sync.ts:215-230`
Imported bundle skill bodies become loadable `.md` skills fed to the agent as instructions; no
size cap, validation, or confirmation.
**Fix:** Validate/limit imported content; confirm with a listing before applying.

### W-22: Config singleton ignores `projectRoot` after first call
**File:** `src/core/config.ts:164-169`
`getConfigManager(projectRoot)` honors the argument only on first invocation; `serve`/`run
--project X` may load config from the wrong directory.
**Fix:** Re-point the manager when a different root is supplied.

### W-23: `globToRegExp` `**` collapse index math is off by one
**File:** `src/core/permissions.ts:78-89`
Patterns like `**/secrets` don't collapse the slash as intended, weakening edit-permission gating.
**Fix:** Fix the post-increment index check when consuming `**`.

### W-24: `validatePath` over-blocks and under-blocks
**File:** `src/utils/validation.ts:12-17`
`includes("..")` rejects `my..file.txt`; `startsWith("/")` misses `C:\` absolute paths.
Currently unused, but wrong if relied upon.
**Fix:** Resolve and compare with `path.relative` like `permissions.ts inProject`.

### W-25: `redact` misses common secret key shapes
**File:** `src/core/redact.ts:35`
Keys like `pat`/`credential` and values under 6 chars aren't redacted; sync export relies on this.
**Fix:** Broaden key list (`CREDENTIAL|PAT|AUTH`), align with sync's `SECRET_KEY_RE`.

### W-26: Tab-bar click hit-testing drifts (zero-width separator); titles unescaped
**File:** `src/tui/tab-bar.ts:62-66`
Hit-testing assumes a 1-column separator that renders zero width — clicking a later tab
selects the wrong one. Titles containing `{` corrupt the bar.
**Fix:** Use a real separator char and escape `tab.title`.

### W-27: Todo entries missing required `status` are silently defaulted
**File:** `src/core/todos.ts:65`
Schema marks `status` required but parsing defaults it to `"pending"` — the model gets no
signal its output was malformed.
**Fix:** Reject entries lacking an explicit `status`.

## Info

### I-01: Six TUI modules are dead code with latent bugs
**File:** `src/tui/chat-panel.ts`, `connect.ts`, `sidebar.ts`, `status-bar.ts`, `file-explorer.ts`, `ink/theme.ts`
Never imported anywhere; contain stray-`}` tag typos, an `undefined` deref in connect.ts:315-320,
unmasked API-key input, version-string drift, and unsubscribed state listeners.
**Fix:** Delete or wire in and fix.

### I-02: Fallback tool parser ignores documented ```bash blocks
**File:** `src/tools/tool-executor.ts:195`
Only ```` ```tool ```` fences are parsed; CLAUDE.md documents ```` ```bash ```` too.

### I-03: OpenAI stream can emit tool calls with empty names
**File:** `src/ai/providers/openai-compat.ts:178-184`
Entries initialized by a delta but never named are returned with `name: ""` (the Anthropic path filters these).

### I-04: `redact` global-flag regexes rely on manual `lastIndex` resets
**File:** `src/core/redact.ts:43-44, 59-61`

### I-05: `loadAllSessions` silently caps at 20 sessions
**File:** `src/core/session-manager.ts:217`

### I-06: `StateManager.slice` keeps a private value copy that can desync from the map
**File:** `src/core/state.ts:129-131`

### I-07: `truncate` underflows for `maxLength < 3`
**File:** `src/utils/formatting.ts:1-4`

### I-08: Dead code — `truncateArgs` in app.ts, unused `parts` in search.ts, unused `wrappedCleanup` in tab-rename-modal.ts
**File:** `src/tui/app.ts:1588-1595`; `src/tools/search.ts:8`; `src/tui/tab-rename-modal.ts:118-122`

### I-09: `showSlashMenu` renders registry command descriptions unescaped
**File:** `src/tui/app.ts:802-808`

### I-10: `/tabs close` reports success even for pinned sessions that refuse to close
**File:** `src/tui/app.ts:1263-1275`; `src/core/session-manager.ts:110-113`

### I-11: serve.ts duplicates hardcoded pricing (folded into W-18)
**File:** `src/server/serve.ts:482-484`

### I-12: chat-panel.ts banner says "v0.1.0" vs app VERSION "0.3.0" (part of I-01)

### I-13: Tab-rename modal removes its keypress listener twice when both destroy events fire (part of I-08)
