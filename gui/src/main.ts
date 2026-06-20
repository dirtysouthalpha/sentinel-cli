import "./style.css";
import { diffLines } from "diff";
import { renderMarkdownHTML, renderStreamingHTML } from "./markdown";
import { diffBlocks } from "./render-diff";
import { resolveKey } from "./composer-keys";

// ---- protocol (mirror of src/server/protocol.ts) ----------------------------
type PermissionMode = "yolo" | "auto" | "gated" | "plan";
type StateSnapshot = {
  model: string; agent: string; theme: string; permissionMode: string;
  themes: { name: string; display: string }[]; models: string[]; agents: string[];
  sessions: { id: string; title: string; active: boolean }[];
  mcpTools: { server: string; tool: string; full: string }[];
  cost: { promptTokens: number; completionTokens: number; totalTokens: number; estimatedCostUSD: number; requests: number };
  providers: { name: string; available: boolean }[];
  // Optional fields added later (older engines may omit them).
  contextWindow?: number;
  commands?: { name: string; description: string }[];
  themeVars?: Record<string, string>;
  needsOnboarding?: boolean;
};
type ToolArgs = Record<string, unknown>;
type TodoItem = { content: string; status: "pending" | "in_progress" | "completed" };
type CheckpointItem = { id: string; tool: string; path: string; existed: boolean; timestamp: number };
type ConfigView = {
  providers: { name: string; hasKey: boolean; baseURL?: string; defaultModel?: string; builtin: boolean; available: boolean }[];
  models: string[];
  mcp: { name: string; command?: string[]; url?: string; enabled: boolean; connected: boolean }[];
};
// The full discriminated union — every variant must be handled in dispatch().
type ServerMessage =
  | { type: "hello"; version: string; state: StateSnapshot }
  | { type: "state"; state: StateSnapshot }
  | { type: "user"; text: string; contextCount?: number }
  | { type: "round_start"; round: number }
  | { type: "token"; text: string }
  | { type: "stream_end" }
  | { type: "usage"; promptTokens: number; completionTokens: number; totalTokens: number; estimatedCostUSD: number }
  | { type: "tool_start"; tool: string; name: string; args: ToolArgs; argsRaw: string }
  | { type: "tool_result"; name: string; ok: boolean; firstLine: string; full: string }
  | { type: "round_end"; round: number; willContinue: boolean }
  | { type: "permission_request"; tool: string; action?: string; path?: string; reason: string; diff?: string }
  | { type: "done"; stopReason: string; rounds: number }
  | { type: "system"; text: string }
  | { type: "error"; message: string }
  | { type: "checkpoints"; items: CheckpointItem[] }
  | { type: "todos"; items: TodoItem[] }
  | { type: "config"; config: ConfigView }
  | { type: "busy"; busy: boolean }
  | { type: "files"; items: string[] }
  | { type: "history"; messages: { role: "user" | "assistant" | "tool"; content: string; name?: string }[] };

// ---- connection params (injected by Tauri, or via ?port=&token= in dev) -----
const params = new URLSearchParams(location.search);
const w = window as any;
const PORT = w.__SENTINEL_PORT__ || params.get("port");
const TOKEN = w.__SENTINEL_TOKEN__ || params.get("token") || "";

// ---- app state --------------------------------------------------------------
let snap: StateSnapshot | null = null;
let busy = false;
let ws: WebSocket | null = null;
type Block =
  | { kind: "user"; text: string; contextCount?: number }
  | { kind: "assistant"; text: string; streaming?: boolean }
  | { kind: "tool"; tool: string; args: any; argsRaw: string; ok?: boolean; firstLine?: string; full?: string; running?: boolean; expanded?: boolean }
  | { kind: "system"; text: string }
  | { kind: "error"; text: string };
let blocks: Block[] = [];
// Auto-follow the chat bottom only when the user is already there, so scrolling
// up during a stream isn't yanked back down. (C2 scroll gate.)
let stick = true;
let pendingPerm: { tool: string; action?: string; path?: string; reason: string; diff?: string } | null = null;
let pendingToolArgs = "";
let todos: TodoItem[] = [];
let cfg: ConfigView | null = null;
let settingsTab: "providers" | "models" | "mcp" = "providers";
let round = 0;
// connection status drives the reconnect banner
type ConnStatus = "connecting" | "open" | "reconnecting" | "closed" | "noengine";
let connStatus: ConnStatus = "connecting";

const DEV = (import.meta as any).env?.DEV ?? false;

const $ = (sel: string, root: ParentNode = document) => root.querySelector(sel) as HTMLElement;
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
const el = (tag: string, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const accentFor = (theme: string) =>
  /matrix|forest|terminal/.test(theme) ? "matrix" :
  /cyan|tron|ocean/.test(theme) ? "cyan" :
  /blood|sunset|neon|magenta/.test(theme) ? "magenta" :
  /amber|paper|mono/.test(theme) ? "amber" : "blue";

// ---- shell ------------------------------------------------------------------
function shell() {
  const app = $("#app");
  app.innerHTML = `
    <div class="app">
      <div class="topbar">
        <div class="brand"><div class="brand-dot">S</div> Sentinel CLI</div>
        <div class="tabs" id="tabs"></div>
        <div class="spacer"></div>
        <div class="pill" id="palette-btn">⌘K  palette</div>
        <div class="pill" id="theme-btn">theme</div>
        <div class="pill" id="perm-btn">mode</div>
        <div class="pill" id="settings-btn">⚙ settings</div>
      </div>

      <div class="panel rail" id="rail"></div>
      <div class="panel sidebar" id="sidebar"></div>
      <div class="panel center">
        <div class="chat" id="chat"></div>
        <div class="composer-wrap">
          <div class="chips" id="chips"></div>
          <div class="attachment-tray" id="attachment-tray"></div>
          <div class="composer">
            <span class="prompt">❯</span>
            <textarea id="input" rows="1" placeholder="Ask Sentinel to fix, build, or explain…   /  @  ⌘K"></textarea>
            <div class="selects">
              <div class="sel" id="model-sel">glm-4.6</div>
              <div class="sel" id="agent-sel">gsd</div>
            </div>
            <button class="send" id="send">Send ➤</button>
            <div id="ac"></div>
          </div>
        </div>
      </div>
      <div class="panel right" id="right"></div>
    </div>`;

  $("#send").onclick = onSend;
  $("#palette-btn").onclick = () => openPalette();
  $("#theme-btn").onclick = () => openPalette("theme ");
  $("#perm-btn").onclick = cyclePerm;
  $("#settings-btn").onclick = () => openSettings();
  $("#model-sel").onclick = () => openPalette("model ");
  $("#agent-sel").onclick = () => openPalette("agent ");

  const input = $("#input") as HTMLTextAreaElement;
  input.addEventListener("input", () => { autosize(input); autocomplete(input); });
  input.addEventListener("keydown", onInputKey);
  // D2: image paste → capture as a data-URL attachment, show a thumbnail chip,
  // and send as a multimodal message. No more "save it and @mention" hint.
  input.addEventListener("paste", (ev: ClipboardEvent) => {
    const items = ev.clipboardData?.items;
    if (!items) return;
    for (const it of items) {
      if (it.type.startsWith("image/")) {
        const file = it.getAsFile();
        if (!file) continue;
        ev.preventDefault();
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          pendingAttachments.push({ dataUrl, name: file.name || `pasted-image-${pendingAttachments.length + 1}` });
          renderAttachmentChips();
          autosize(input);
        };
        reader.readAsDataURL(file);
        return;
      }
    }
  });
  renderChips();
  input.focus();

  // E1: global keymap (pure resolveKey) — palette / search / focus / cheatsheet.
  // Don't hijack typing: skip when focus is in the composer and the key isn't a
  // modifier combo (so '?' mid-sentence stays a question mark).
  document.addEventListener("keydown", (ev: KeyboardEvent) => {
    const action = resolveKey(ev);
    if (!action) return;
    const inComposer = document.activeElement === input;
    if (action === "cheatsheet" && inComposer && (input.value || "").length > 0) return;
    ev.preventDefault();
    if (action === "palette") openPalette("");
    else if (action === "focusComposer") input.focus();
    else if (action === "cheatsheet") showCheatsheet();
    else if (action === "search") toggleSearch();
  });

  // A simple in-chat find bar.
  const findBar = el("div", "findbar");
  findBar.id = "findbar";
  findBar.style.display = "none";
  findBar.innerHTML = `<input id="find-input" placeholder="Find in conversation…" style="flex:1;background:transparent;border:none;color:var(--text);outline:none"/><span id="find-count" style="color:var(--text-faint);font-size:12px"></span>`;
  (document.querySelector(".chat")?.parentElement || document.body).appendChild(findBar);
  const findInput = findBar.querySelector("#find-input") as HTMLInputElement;
  findInput.addEventListener("input", () => runFind(findInput.value));

  // Copy buttons in markdown code blocks (event delegation — works on re-render).
  const chat = document.getElementById("chat");
  if (chat) {
    chat.addEventListener("click", (ev) => {
      const btn = (ev.target as HTMLElement).closest("[data-copy]") as HTMLElement | null;
      if (!btn) return;
      const block = btn.closest(".md-code");
      const code = block?.querySelector("pre code") as HTMLElement | null;
      const text = code?.textContent ?? "";
      navigator.clipboard?.writeText(text).then(() => {
        const prev = btn.textContent;
        btn.textContent = "copied!";
        btn.classList.add("done");
        setTimeout(() => { btn.textContent = prev; btn.classList.remove("done"); }, 1200);
      }).catch(() => {});
    });
    // C2: track whether the user is at the bottom; only auto-scroll when so,
    // so scrolling up during a stream isn't yanked back down.
    chat.addEventListener("scroll", () => {
      const atBottom = chat.scrollTop + chat.clientHeight >= chat.scrollHeight - 4;
      stick = atBottom;
      const btn = document.getElementById("scroll-bottom");
      if (btn) btn.style.display = atBottom ? "none" : "block";
    });
    // Scroll-to-bottom button (shown only when not at the bottom).
    const sb = el("div", "scroll-bottom", "↓ latest");
    sb.id = "scroll-bottom";
    sb.style.display = "none";
    sb.addEventListener("click", () => {
      stick = true;
      chat.scrollTop = chat.scrollHeight;
      sb.style.display = "none";
    });
    (chat.parentElement || chat).appendChild(sb);
  }
}

function autosize(t: HTMLTextAreaElement) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 160) + "px"; }
/** Insert text at the textarea caret, advancing the caret past it. */
function insertAtCaret(t: HTMLTextAreaElement, text: string): void {
  const s = t.selectionStart ?? t.value.length;
  const e = t.selectionEnd ?? t.value.length;
  t.value = t.value.slice(0, s) + text + t.value.slice(e);
  const pos = s + text.length;
  t.selectionStart = t.selectionEnd = pos;
}

// ---- rendering --------------------------------------------------------------
/** Inject the engine theme palette as CSS vars on :root, mapping the engine's
 *  colorsToCSS names to the GUI's own var names so 16 themes render distinctly
 *  (not collapsed to 5 accent buckets) and light/paper actually look light. */
function applyThemeVars(vars: Record<string, string>): void {
  const root = document.documentElement.style;
  const v = (k: string): string => vars[k] || "";
  // Direct engine names where the GUI already uses them.
  root.setProperty("--accent", v("--accent-primary"));
  root.setProperty("--bg", v("--bg-primary"));
  root.setProperty("--bg-2", v("--bg-secondary"));
  root.setProperty("--text", v("--text-primary"));
  root.setProperty("--text-dim", v("--text-secondary"));
  root.setProperty("--text-faint", v("--text-tertiary"));
  root.setProperty("--border", v("--border-color"));
  root.setProperty("--good", v("--success"));
  root.setProperty("--bad", v("--error"));
  root.setProperty("--warn", v("--warning"));
  // Derive --accent-rgb (used for rgba glows) from the accent hex.
  const hex = v("--accent-primary").replace("#", "");
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    root.setProperty("--accent-rgb", `${r}, ${g}, ${b}`);
    root.setProperty("--glow", `rgba(${r}, ${g}, ${b}, 0.5)`);
  }
}

// ---- onboarding wizard (first run) -----------------------------------------
// Mirror of the engine's PROVIDERS catalog (src/core/onboarding.ts) — the GUI
// can't import engine TS cleanly (separate tsconfig), so the picker choices are
// inlined. Keep in sync with onboarding.ts if you change the catalog.
const OB_PROVIDERS = [
  { id: "zai", label: "Z.ai / Zhipu GLM", blurb: "Best value for coding. Recommended.", models: ["zai/glm-4.6", "zai/glm-4.5-air"], noKey: false, keyUrl: "https://open.bigmodel.cn" },
  { id: "anthropic", label: "Anthropic (Claude)", blurb: "Strongest coding models (paid).", models: ["anthropic/claude-sonnet", "anthropic/claude-haiku"], noKey: false, keyUrl: "https://console.anthropic.com/settings/keys" },
  { id: "openai", label: "OpenAI (GPT)", blurb: "GPT-4o family (paid).", models: ["openai/gpt-4o", "openai/gpt-4o-mini"], noKey: false, keyUrl: "https://platform.openai.com/api-keys" },
  { id: "ollama", label: "Ollama (local, free)", blurb: "Run models locally — no key, no cost.", models: ["ollama/llama3"], noKey: true },
  { id: "claude-router", label: "Claude via OAuth router (keyless)", blurb: "Ride a Claude Max subscription — no API key.", models: ["anthropic/claude-sonnet", "anthropic/claude-haiku"], noKey: true },
];

let obStep: "provider" | "key" | "model" = "provider";
let obProvider: typeof OB_PROVIDERS[number] | null = null;
let obKey = "";
let obModel = "";

function renderOnboarding(): void {
  let root = document.getElementById("onboarding") as HTMLElement | null;
  if (!root) {
    root = el("div", "onboarding");
    root.id = "onboarding";
    document.body.appendChild(root);
  }
  root.innerHTML = "";
  root.append(el("div", "ob-logo", "◆ Sentinel"));
  root.append(el("div", "ob-title", "Get started in 30 seconds"));
  root.append(el("div", "ob-sub", "Pick a provider to power your agent. Change anytime with /setup."));

  if (obStep === "provider") {
    const list = el("div", "ob-list");
    for (const p of OB_PROVIDERS) {
      const row = el("div", "ob-opt");
      row.append(el("div", "ob-opt-name", p.label + (p.id === "zai" ? "  ← recommended" : "")));
      row.append(el("div", "ob-opt-blurb", p.blurb));
      row.onclick = () => {
        obProvider = p;
        obModel = p.models[0];
        if (p.noKey) {
          if (p.models.length > 1) { obStep = "model"; renderOnboarding(); }
          else finishOnboarding();
        } else {
          obStep = "key"; renderOnboarding();
        }
      };
      list.append(row);
    }
    root.append(list);
  } else if (obStep === "key" && obProvider) {
    root.append(el("div", "ob-step", `②  Enter your ${obProvider.label} API key`));
    if (obProvider.keyUrl) root.append(el("div", "ob-sub", `Get one: ${obProvider.keyUrl}`));
    const inp = document.createElement("input");
    inp.type = "password"; inp.className = "ob-input"; inp.value = obKey;
    inp.placeholder = "paste your API key (stored in the OS keyring, not on disk)";
    inp.oninput = () => { obKey = inp.value; };
    root.append(inp);
    const row = el("div", "ob-actions");
    const back = el("button", "btn", "← Back"); back.onclick = () => { obStep = "provider"; renderOnboarding(); };
    const next = el("button", "btn primary", "Continue →"); next.onclick = () => { obStep = "model"; renderOnboarding(); };
    row.append(back, next); root.append(row); setTimeout(() => inp.focus(), 0);
  } else if (obStep === "model" && obProvider) {
    root.append(el("div", "ob-step", "③  Pick a starter model"));
    const list = el("div", "ob-list");
    for (const m of obProvider.models) {
      const row = el("div", "ob-opt" + (m === obModel ? " sel" : ""));
      row.append(el("div", "ob-opt-name", m));
      row.onclick = () => { obModel = m; finishOnboarding(); };
      list.append(row);
    }
    root.append(list);
    const back = el("button", "btn", "← Back"); back.onclick = () => { obStep = obProvider!.noKey ? "provider" : "key"; renderOnboarding(); };
    root.append(back);
  }
}

function finishOnboarding(): void {
  if (!obProvider) return;
  const p = obProvider;
  const out: { providerId: string; model: string; apiKey?: string; baseURL?: string } = {
    providerId: p.id, model: obModel,
  };
  if (!p.noKey && obKey.trim()) out.apiKey = obKey.trim();
  if (p.id === "claude-router") out.baseURL = "http://127.0.0.1:8080/v1/anthropic";
  send({ type: "configure", ...out });
  obStep = "provider"; obProvider = null; obKey = ""; obModel = "";
}

function renderAll() {
  if (!snap) return;
  // Full theme palette from the engine (falls back to the accent buckets if absent).
  const tv = (snap as { themeVars?: Record<string, string> }).themeVars;
  if (tv && Object.keys(tv).length) applyThemeVars(tv);
  document.documentElement.dataset.accent = accentFor(snap.theme);
  // First-run onboarding intercept: if the engine says no provider is usable,
  // show the wizard instead of the normal chrome.
  if ((snap as { needsOnboarding?: boolean }).needsOnboarding) {
    renderOnboarding();
    return;
  }
  const ob = document.getElementById("onboarding");
  if (ob) ob.remove();
  renderTabs(); renderRail(); renderSidebar(); renderRight();
  ($("#model-sel")).textContent = snap.model.split("/").pop() || snap.model;
  ($("#agent-sel")).textContent = snap.agent;
}

function renderTabs() {
  const t = $("#tabs"); t.innerHTML = "";
  for (const s of snap!.sessions) {
    const tab = el("div", "tab" + (s.active ? " active" : ""));
    tab.append(el("span", "", esc(s.title)));
    const x = el("span", "x", "✕"); x.onclick = (e) => { e.stopPropagation(); send({ type: "session", action: "close", id: s.id }); };
    tab.append(x);
    tab.onclick = () => send({ type: "session", action: "switch", id: s.id });
    t.append(tab);
  }
  const plus = el("div", "pill", "+"); plus.onclick = () => send({ type: "session", action: "new" }); t.append(plus);
}

const AGENT_ICONS: Record<string, string> = { gsd: "⚡", code: "‹›", ask: "?", plan: "◇", debug: "🐞", architect: "▱", orchestrator: "✦" };
function renderRail() {
  const r = $("#rail"); r.innerHTML = "";
  r.append(el("div", "logo", "S"));
  for (const a of snap!.agents) {
    const ico = el("div", "ico" + (a === snap!.agent ? " active" : ""), AGENT_ICONS[a] || a[0].toUpperCase());
    ico.title = a;
    ico.onclick = () => send({ type: "setAgent", agent: a });
    r.append(ico);
  }
}

function renderSidebar() {
  const s = $("#sidebar"); s.innerHTML = "";
  s.append(el("div", "side-head", "Workspace"));
  s.append(el("div", "project", esc(projectName())));
  s.append(el("div", "side-head", "Sessions"));
  const list = el("div", "list");
  for (const ses of snap!.sessions) {
    const row = el("div", "row" + (ses.active ? " active" : ""));
    row.append(el("span", "ico", "▸"));
    row.append(el("span", "", esc(ses.title)));
    row.onclick = () => send({ type: "session", action: "switch", id: ses.id });
    list.append(row);
  }
  s.append(list);
  s.append(el("div", "side-head", "Agents"));
  const al = el("div", "list");
  for (const a of snap!.agents) {
    const row = el("div", "row" + (a === snap!.agent ? " active" : ""));
    row.append(el("span", "ico", AGENT_ICONS[a] || "•"));
    row.append(el("span", "", a));
    row.onclick = () => send({ type: "setAgent", agent: a });
    al.append(row);
  }
  s.append(al);
}

function renderRight() {
  const r = $("#right"); r.innerHTML = "";
  // model router
  const mr = el("div", "card");
  mr.append(el("div", "ch", "⟿ Model Router"));
  for (const p of snap!.providers) {
    const kv = el("div", "kv");
    kv.append(el("span", "", p.name));
    kv.append(el("span", "v", p.available ? "● ready" : "○ no key"));
    (kv.lastChild as HTMLElement).style.color = p.available ? "var(--good)" : "var(--text-faint)";
    mr.append(kv);
  }
  const mk = el("div", "kv"); mk.append(el("span", "", "active")); mk.append(el("span", "v", esc(snap!.model))); mr.append(mk);
  r.append(mr);
  // context usage
  const cu = el("div", "card");
  cu.append(el("div", "ch", "◷ Context · Cost"));
  const tokens = snap!.cost.totalTokens;
  // Use the engine-reported context window (StateSnapshot.contextWindow) instead
  // of a hardcoded 120000 that didn't match the engine's 84000 cap.
  const window = (snap as { contextWindow?: number }).contextWindow ?? 84000;
  const pct = Math.min(100, Math.round((tokens / window) * 100));
  const k1 = el("div", "kv"); k1.append(el("span", "", "tokens")); k1.append(el("span", "v", tokens.toLocaleString())); cu.append(k1);
  const k2 = el("div", "kv"); k2.append(el("span", "", "cost")); k2.append(el("span", "v", "$" + snap!.cost.estimatedCostUSD.toFixed(4))); cu.append(k2);
  const g = el("div", "gauge"); const i = el("i"); i.style.width = pct + "%"; g.append(i); cu.append(g);
  cu.append(el("div", "kv", `<span>window</span><span class="v">${pct}%</span>`));
  r.append(cu);
  // todos / checklist — updated live by every `todos` server message
  if (todos.length) r.append(renderTodos());
  // tools / mcp
  const tools = el("div", "card");
  tools.append(el("div", "ch", "⚒ Top Agents · MCP"));
  const builtins = ["file", "bash", "search", "git", "web", "patch"];
  for (const b of builtins) { const kv = el("div", "kv"); kv.append(el("span", "", b)); kv.append(el("span", "v", "built-in")); tools.append(kv); }
  // prefer config view (carries connection state); fall back to the snapshot list
  if (cfg && cfg.mcp.length) {
    for (const m of cfg.mcp.slice(0, 8)) {
      const kv = el("div", "kv");
      kv.append(el("span", "", esc(m.name)));
      const v = el("span", "v", m.enabled ? (m.connected ? "● connected" : "○ off") : "disabled");
      (v as HTMLElement).style.color = m.connected ? "var(--good)" : "var(--text-faint)";
      kv.append(v); tools.append(kv);
    }
  } else {
    for (const m of snap!.mcpTools.slice(0, 6)) { const kv = el("div", "kv"); kv.append(el("span", "", esc(m.tool))); kv.append(el("span", "v", "mcp:" + esc(m.server))); tools.append(kv); }
  }
  r.append(tools);
  // status
  const st = el("div", "card");
  st.append(el("div", "ch", "◉ Status"));
  const line = el("div", "status-line");
  line.append(el("span", "d" + (busy ? " busy" : "")));
  const work = busy ? (round > 0 ? `working · round ${round}` : "working") : "ready";
  line.append(el("span", "", work + " · " + snap!.agent + " · " + snap!.permissionMode));
  st.append(line);
  r.append(st);
}

function renderTodos(): HTMLElement {
  const card = el("div", "card todos-card");
  const done = todos.filter((t) => t.status === "completed").length;
  card.append(el("div", "ch", `☑ Todos · ${done}/${todos.length}`));
  for (const t of todos) {
    const row = el("div", "todo " + t.status);
    const mark = t.status === "completed" ? "✓" : t.status === "in_progress" ? "▸" : "○";
    row.append(el("span", "tk", mark));
    row.append(el("span", "tx", esc(t.content)));
    card.append(row);
  }
  return card;
}

function projectName() { return (w.__SENTINEL_PROJECT__ as string) || "project"; }

const CHIPS = ["/fix", "/review", "/build", "/test", "/explain", "/refactor", "/secure", "/optimize"];
function renderChips() {
  const c = $("#chips"); c.innerHTML = "";
  for (const ch of CHIPS) { const e = el("div", "chip", ch); e.onclick = () => { const i = $("#input") as HTMLTextAreaElement; i.value = ch + " "; i.focus(); }; c.append(e); }
}

// ---- chat blocks ------------------------------------------------------------
// Incremental render: track the previously-rendered block list + their DOM
// nodes so renderChat can PATCH (append new, drop replaced tail) instead of
// rebuilding the whole chat on every tool/system event. Kills the rise-animation
// re-fire flicker the old `innerHTML = ""` caused.
let prevBlocks: Block[] = [];
let prevNodes: HTMLElement[] = [];

function renderChat() {
  const chat = $("#chat");

  // Full rebuild only when there's nothing yet, or a non-patchable reset
  // (history replay cleared blocks). Otherwise patch via diffBlocks.
  if (prevBlocks.length === 0 || blocks.length === 0) {
    chat.innerHTML = "";
    prevNodes = [];
  } else {
    const d = diffBlocks(prevBlocks, blocks);
    if (d.replaceFrom < prevNodes.length) {
      // Drop DOM nodes from the divergence point (edit/regenerate replaced a tail).
      for (const node of prevNodes.slice(d.replaceFrom)) node.remove();
      prevNodes = prevNodes.slice(0, d.replaceFrom);
    }
    // Append only the new blocks.
    let appendIdx = prevNodes.length; // absolute index of each appended block
    for (const b of d.append as Block[]) {
      const node = renderBlock(b, appendIdx++);
      node.setAttribute("data-new", ""); // scope the rise animation to new nodes
      chat.append(node);
      prevNodes.push(node);
    }
  }

  // First-run welcome path.
  if (blocks.length === 0 && !pendingPerm) {
    chat.append(el("div", "welcome", `<div class="big">Welcome to <b>Sentinel</b></div><p>Describe a bug or feature, or start a slash command. The agent reads files, runs commands, and edits code — gated by your permission mode.</p>`));
    prevBlocks = blocks.slice();
    return;
  }

  // If the prefix was a full rebuild (above), append everything fresh.
  if (prevNodes.length === 0) {
    let lastAssistantBody: HTMLElement | null = null;
    for (let bi = 0; bi < blocks.length; bi++) {
      const b = blocks[bi];
      const node = renderBlock(b, bi);
      node.setAttribute("data-new", "");
      if (b === streaming) lastAssistantBody = node.querySelector(".body");
      chat.append(node);
      prevNodes.push(node);
    }
    streamEl = streaming ? lastAssistantBody : null;
  } else {
    // Re-capture the live streaming node (it may be among the kept nodes).
    let lastAssistantBody: HTMLElement | null = null;
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i] === streaming) lastAssistantBody = prevNodes[i]?.querySelector(".body") ?? null;
    }
    streamEl = streaming ? lastAssistantBody : null;
  }

  if (pendingPerm) chat.append(renderPerm());
  if (stick) chat.scrollTop = chat.scrollHeight;
  // Strip the new-node marker next frame so a later re-add re-animates.
  requestAnimationFrame(() => {
    for (const node of prevNodes) node.removeAttribute("data-new");
  });
  prevBlocks = blocks.slice();
}

function renderBlock(b: Block, index: number): HTMLElement {
  if (b.kind === "user") {
    const node = wrap("user", "You", `<div class="body">${esc(b.text)}</div>`);
    // Per-turn edit: re-send this prompt, truncating the context back to where
    // it was before this turn ran. contextCount = context length at send time.
    if (b.contextCount != null) {
      const edit = el("span", "turn-act", "✎ edit");
      edit.addEventListener("click", () => {
        const next = prompt("Edit and re-send:", b.text);
        if (next === null || !next.trim()) return;
        // Drop everything from this user block onward in the GUI view too.
        blocks.splice(index);
        send({ type: "edit", text: next, truncateIndex: b.contextCount! });
        renderChat();
      });
      node.append(edit);
    }
    return node;
  }
  if (b.kind === "assistant") {
    const node = wrap("assistant", "Sentinel", `<div class="body">${renderMarkdownHTML(b.text)}${b.streaming ? '<span class="cursor"></span>' : ""}</div>`);
    // Regenerate: drop this assistant response + re-run the preceding user turn.
    if (!b.streaming && index === blocks.length - 1 && index > 0) {
      let userIdx = -1;
      for (let k = index - 1; k >= 0; k--) {
        if (blocks[k].kind === "user") { userIdx = k; break; }
      }
      const userBlock = userIdx >= 0 ? (blocks[userIdx] as { kind: "user"; text: string; contextCount?: number }) : null;
      if (userBlock && userBlock.contextCount != null) {
        const regen = el("span", "turn-act", "↻ regenerate");
        regen.addEventListener("click", () => {
          // Drop the assistant block so the GUI matches the truncated context.
          blocks.splice(userIdx);
          send({ type: "edit", text: userBlock.text, truncateIndex: userBlock.contextCount! });
          renderChat();
        });
        node.append(regen);
      }
    }
    return node;
  }
  if (b.kind === "system") return wrap("", "", `<div class="body" style="color:var(--text-faint);font-size:13px">${esc(b.text)}</div>`);
  if (b.kind === "error") return wrap("", "", `<div class="body" style="color:var(--bad)">✗ ${esc(b.text)}</div>`);
  return renderTool(b);
}
function wrap(cls: string, who: string, inner: string): HTMLElement {
  const e = el("div", "block " + cls);
  if (who) e.append(el("div", "who", `<span class="dot"></span>${esc(who)}`));
  const body = document.createElement("div");
  body.innerHTML = inner;
  while (body.firstChild) e.append(body.firstChild);
  return e;
}

function renderTool(b: Extract<Block, { kind: "tool" }>): HTMLElement {
  const card = el("div", "tool");
  const head = el("div", "head");
  head.append(el("span", "name", "» " + esc(b.tool)));
  head.append(el("span", "args", esc(b.argsRaw || "")));
  if (b.running) head.append(el("span", "spin"));
  else head.append(el("span", "status " + (b.ok ? "ok" : "err"), b.ok ? "ok" : "err"));
  // Expand/collapse toggle for the output body.
  const hasBody = !!b.full && !b.running;
  if (hasBody) {
    const toggle = el("span", "expand", b.expanded ? "▾" : "▸");
    toggle.style.cursor = "pointer";
    toggle.addEventListener("click", () => {
      b.expanded = !b.expanded;
      // Re-render just this block in place to avoid a full chat rebuild.
      const fresh = renderTool(b);
      fresh.setAttribute("data-new", "");
      card.replaceWith(fresh);
      requestAnimationFrame(() => fresh.removeAttribute("data-new"));
    });
    head.append(toggle);
  }
  card.append(head);
  const d = computeDiff(b);
  if (d) card.append(d);
  else if (hasBody) {
    // Collapsed caps at 4000 chars; expanded shows everything.
    const text = b.expanded ? (b.full || "") : (b.full || "").slice(0, 4000);
    const suffix = !b.expanded && (b.full || "").length > 4000 ? "\n… (click ▸ to expand)" : "";
    card.append(el("div", "out", esc(text) + (suffix ? `<span class="more">${suffix}</span>` : "")));
  }
  return card;
}

function computeDiff(b: Extract<Block, { kind: "tool" }>): HTMLElement | null {
  const a = b.args || {};
  let oldText: string | null = null, newText: string | null = null;
  if (b.tool === "patch") { oldText = a.oldText ?? ""; newText = a.newText ?? ""; }
  else if (b.tool === "file" && a.action === "edit") { oldText = a.searchLines ? (Array.isArray(a.searchLines) ? a.searchLines.join("\n") : String(a.searchLines)) : ""; newText = a.replaceText ?? ""; }
  else if (b.tool === "file" && a.action === "write") { oldText = ""; newText = a.content ?? ""; }
  if (oldText === null || newText === null) return null;
  const parts = diffLines(String(oldText), String(newText));
  const wrap = el("div", "diff");
  let lines = 0;
  for (const p of parts) {
    const cls = p.added ? "add" : p.removed ? "del" : "ctx";
    const prefix = p.added ? "+" : p.removed ? "-" : " ";
    for (const ln of p.value.replace(/\n$/, "").split("\n")) {
      if (lines++ > 40) { wrap.append(el("div", "ln ctx", "  … more")); return wrap; }
      wrap.append(el("div", "ln " + cls, esc(prefix + " " + ln)));
    }
  }
  return wrap;
}

function renderPerm(): HTMLElement {
  const p = pendingPerm!;
  const card = el("div", "perm");
  card.append(el("div", "t", `⚠ Allow <b>${esc(p.tool)}${p.action ? "(" + esc(p.action) + ")" : ""}</b>${p.path ? " on " + esc(p.path) : ""}?  <span style="color:var(--text-faint);font-size:12px">(${esc(p.reason)})</span>`));
  // v2.5: show the actual diff for file mutations.
  if (p.diff) {
    const pre = el("pre", "perm-diff");
    // Color +/- lines green/red.
    pre.innerHTML = esc(p.diff)
      .split("\n")
      .map((l) => l.startsWith("+") ? `<span style="color:var(--good)">${esc(l)}</span>` : l.startsWith("-") ? `<span style="color:var(--bad)">${esc(l)}</span>` : esc(l))
      .join("\n");
    card.append(pre);
  }
  const btns = el("div", "btns");
  const yes = el("button", "btn primary", "Allow"); yes.onclick = () => { send({ type: "permission", allow: true }); pendingPerm = null; renderChat(); };
  const no = el("button", "btn danger", "Deny"); no.onclick = () => { send({ type: "permission", allow: false }); pendingPerm = null; renderChat(); };
  btns.append(yes, no); card.append(btns);
  return card;
}

// ---- composer + send --------------------------------------------------------
// Pending image attachments (from paste). Each is a data-URL + name; sent with
// the next non-empty message, then cleared.
interface PendingAttachment { dataUrl: string; name: string; }
let pendingAttachments: PendingAttachment[] = [];

function renderAttachmentChips() {
  const tray = $("#attachment-tray");
  if (!tray) return;
  if (pendingAttachments.length === 0) { tray.innerHTML = ""; return; }
  tray.innerHTML = pendingAttachments.map((a, i) =>
    `<span class="att-chip" data-i="${i}">
      <img src="${a.dataUrl}" alt="${escapeHtml(a.name)}" />
      <span class="att-name">${escapeHtml(a.name)}</span>
      <button class="att-remove" data-i="${i}" title="remove">×</button>
    </span>`
  ).join("");
  tray.querySelectorAll<HTMLButtonElement>(".att-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      pendingAttachments.splice(Number(btn.dataset.i), 1);
      renderAttachmentChips();
    });
  });
}

function onInputKey(e: KeyboardEvent) {
  if (acOpen()) { if (handleAcKey(e)) return; }
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); }
  if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); openPalette(); }
}
function onSend() {
  const i = $("#input") as HTMLTextAreaElement;
  const text = i.value.trim();
  if (!text) return;
  if (busy) { send({ type: "cancel" }); return; }
  // Grab + clear pending attachments so they go with THIS message only.
  const attachments = pendingAttachments.slice();
  pendingAttachments = [];
  renderAttachmentChips();
  i.value = ""; autosize(i); closeAc();
  if (text.startsWith("/")) {
    const [name, ...args] = text.slice(1).split(/\s+/);
    send({ type: "command", name, args });
  } else if (attachments.length > 0) {
    send({ type: "send", text, attachments });
  } else send({ type: "send", text });
}

// ---- autocomplete -----------------------------------------------------------
let acItems: { label: string; insert: string }[] = [], acSel = 0;
function acOpen() { return acItems.length > 0; }
function autocomplete(i: HTMLTextAreaElement) {
  const v = i.value, caret = i.selectionStart;
  const token = v.slice(0, caret).split(/\s/).pop() || "";
  acItems = [];
  if (token.startsWith("/")) {
    const q = token.slice(1).toLowerCase();
    // Source the command list from the engine's catalog (StateSnapshot.commands)
    // so autocomplete can't drift from what the engine actually accepts. Fall
    // back to a static list before the first state snapshot arrives.
    const fromEngine = (snap as { commands?: { name: string }[] } | null)?.commands?.map((c) => c.name) ?? [];
    const fallback = [...CHIPS.map((c) => c.slice(1)), "ship", "docgen", "migrate", "analyze", "compact", "clear", "undo", "checkpoints", "commit", "pr", "branch", "diff"];
    const cmds = fromEngine.length ? fromEngine : fallback;
    acItems = [...new Set(cmds)].filter((c) => c.startsWith(q)).slice(0, 8).map((c) => ({ label: "/" + c, insert: "/" + c + " " }));
  } else if (token.startsWith("@")) {
    // Query the engine for project files matching the text after @. The reply
    // (files message) populates acItems asynchronously.
    acItems = [];
    send({ type: "listFiles", query: token.slice(1) });
  } else if (token.startsWith("mcp") && snap) {
    acItems = snap.mcpTools.filter((t) => t.full.includes(token)).slice(0, 8).map((t) => ({ label: t.full, insert: t.full + " " }));
  }
  acSel = 0; renderAc();
}
function renderAc() {
  const ac = $("#ac"); ac.innerHTML = "";
  if (!acItems.length) return;
  const box = el("div", "ac");
  acItems.forEach((it, idx) => {
    const o = el("div", "opt" + (idx === acSel ? " sel" : ""));
    o.append(el("span", "k", it.label));
    o.onclick = () => acceptAc(idx);
    box.append(o);
  });
  ac.append(box);
}
function handleAcKey(e: KeyboardEvent): boolean {
  if (e.key === "ArrowDown") { acSel = (acSel + 1) % acItems.length; renderAc(); e.preventDefault(); return true; }
  if (e.key === "ArrowUp") { acSel = (acSel - 1 + acItems.length) % acItems.length; renderAc(); e.preventDefault(); return true; }
  if (e.key === "Tab" || (e.key === "Enter" && acItems.length)) { acceptAc(acSel); e.preventDefault(); return true; }
  if (e.key === "Escape") { closeAc(); e.preventDefault(); return true; }
  return false;
}
function acceptAc(idx: number) {
  const i = $("#input") as HTMLTextAreaElement;
  const it = acItems[idx]; if (!it) return;
  const v = i.value, caret = i.selectionStart;
  const before = v.slice(0, caret), after = v.slice(caret);
  const start = before.lastIndexOf(before.split(/\s/).pop() || "");
  i.value = before.slice(0, start) + it.insert + after;
  i.focus(); closeAc();
}
function closeAc() { acItems = []; renderAc(); }

// ---- cheatsheet + search (E1) ----------------------------------------------
function showCheatsheet(): void {
  const existing = document.getElementById("cheatsheet");
  if (existing) { existing.remove(); return; }
  const lines = [
    ["⌘/Ctrl + K", "command palette"],
    ["⌘/Ctrl + F", "find in conversation"],
    ["⌘/Ctrl + L", "focus composer"],
    ["?", "this cheatsheet"],
    ["Enter / Shift+Enter", "send / newline"],
    ["@ / /", "mention a file / slash command"],
  ];
  const box = el("div", "cheatsheet");
  box.id = "cheatsheet";
  box.innerHTML = `<div class="ch">Keyboard shortcuts</div>` +
    lines.map(([k, d]) => `<div class="kv"><span class="k">${k}</span><span class="d">${d}</span></div>`).join("");
  document.body.appendChild(box);
  box.tabIndex = -1;
  box.focus();
  box.addEventListener("keydown", () => box.remove());
  box.addEventListener("click", (e) => { if (e.target === box) box.remove(); });
}

function toggleSearch(): void {
  const bar = document.getElementById("findbar");
  if (!bar) return;
  const open = bar.style.display !== "none";
  bar.style.display = open ? "none" : "flex";
  if (!open) {
    const inp = bar.querySelector("#find-input") as HTMLInputElement;
    inp.value = "";
    inp.focus();
    (bar.querySelector("#find-count") as HTMLElement).textContent = "";
  }
}

/** Naive in-chat find: scan block text for the query, count matches, scroll. */
function runFind(query: string): void {
  const bar = document.getElementById("findbar");
  if (!bar) return;
  const count = bar.querySelector("#find-count") as HTMLElement;
  if (!query.trim()) { count.textContent = ""; return; }
  const q = query.toLowerCase();
  let hits = 0;
  let firstHitIndex = -1;
  blocks.forEach((b, i) => {
    const text = (b as { text?: string }).text || "";
    if (text.toLowerCase().includes(q)) {
      hits++;
      if (firstHitIndex < 0) firstHitIndex = i;
    }
  });
  count.textContent = hits > 0 ? `${hits} match${hits === 1 ? "" : "es"}` : "no matches";
  if (firstHitIndex >= 0) {
    const nodes = document.querySelectorAll<HTMLElement>("#chat .block");
    nodes[firstHitIndex]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

// ---- command palette --------------------------------------------------------
function openPalette(prefix = "") {
  if (!snap) return;
  const items = paletteItems();
  let query = prefix, sel = 0;
  const bg = el("div", "palette-bg");
  const box = el("div", "palette");
  const inp = el("input") as HTMLInputElement; inp.placeholder = "Search commands, models, agents, themes…"; inp.value = prefix;
  const results = el("div", "results");
  const close = () => bg.remove();
  const filtered = () => items.filter((it) => (it.label + it.cat).toLowerCase().includes(query.trim().toLowerCase()));
  const draw = () => {
    results.innerHTML = ""; const f = filtered(); sel = Math.max(0, Math.min(sel, f.length - 1));
    f.slice(0, 40).forEach((it, idx) => {
      const o = el("div", "opt" + (idx === sel ? " sel" : ""));
      o.append(el("span", "ico", it.ico || "›")); o.append(el("span", "", it.label)); o.append(el("span", "cat", it.cat));
      o.onclick = () => { it.run(); close(); };
      results.append(o);
    });
  };
  inp.oninput = () => { query = inp.value; sel = 0; draw(); };
  inp.onkeydown = (e) => {
    const f = filtered();
    if (e.key === "ArrowDown") { sel = (sel + 1) % f.length; draw(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { sel = (sel - 1 + f.length) % f.length; draw(); e.preventDefault(); }
    else if (e.key === "Enter") { f[sel]?.run(); close(); }
    else if (e.key === "Escape") close();
  };
  bg.onclick = (e) => { if (e.target === bg) close(); };
  box.append(inp); box.append(results); bg.append(box); document.body.append(bg); inp.focus(); draw();
}
function paletteItems() {
  const out: { label: string; cat: string; ico?: string; run: () => void }[] = [];
  for (const m of snap!.models) out.push({ label: m, cat: "model", ico: "◈", run: () => send({ type: "setModel", model: m }) });
  for (const a of snap!.agents) out.push({ label: a, cat: "agent", ico: "⚡", run: () => send({ type: "setAgent", agent: a }) });
  for (const t of snap!.themes) out.push({ label: t.display, cat: "theme", ico: "◐", run: () => send({ type: "setTheme", theme: t.name }) });
  for (const c of [...CHIPS, "/ship", "/analyze", "/docgen", "/migrate", "/commit", "/pr", "/branch", "/diff"]) out.push({ label: c, cat: "command", ico: "›", run: () => { const [n, ...a] = c.slice(1).split(/\s+/); send({ type: "command", name: n, args: a }); } });
  for (const pm of ["yolo", "auto", "gated"]) out.push({ label: "permissions: " + pm, cat: "mode", ico: "🛡", run: () => send({ type: "setPermissionMode", mode: pm as any }) });
  for (const c of ["compact", "clear", "undo"]) out.push({ label: c, cat: "action", ico: "↺", run: () => send({ type: c } as any) });
  return out;
}
function cyclePerm() {
  if (!snap) return; const order = ["yolo", "auto", "gated"]; const next = order[(order.indexOf(snap.permissionMode) + 1) % 3];
  send({ type: "setPermissionMode", mode: next as any });
}

// ---- settings ---------------------------------------------------------------
function openSettings() {
  send({ type: "getConfig" });
  if (document.querySelector(".settings-bg")) return;
  const bg = el("div", "palette-bg settings-bg");
  const box = el("div", "settings");
  const head = el("div", "settings-head");
  head.append(el("div", "title", "⚙ Settings"));
  const tabs = el("div", "settings-tabs");
  for (const t of ["providers", "models", "mcp"] as const) {
    const tb = el("div", "stab" + (settingsTab === t ? " active" : ""), t === "mcp" ? "MCP" : t[0].toUpperCase() + t.slice(1));
    tb.onclick = () => { settingsTab = t; box.querySelectorAll(".stab").forEach((e) => e.classList.remove("active")); tb.classList.add("active"); renderSettingsBody(); };
    tabs.append(tb);
  }
  head.append(tabs);
  const close = el("div", "pill", "✕"); close.onclick = () => bg.remove(); head.append(close);
  const body = el("div", "settings-body"); body.id = "settings-body";
  box.append(head, body);
  bg.append(box); document.body.append(bg);
  bg.onclick = (e) => { if (e.target === bg) bg.remove(); };
  renderSettingsBody();
}

function renderSettingsBody() {
  const body = document.querySelector("#settings-body") as HTMLElement | null;
  if (!body) return;
  body.innerHTML = "";
  if (!cfg) { body.append(el("div", "hint", "Loading…")); return; }
  if (settingsTab === "providers") renderProvidersTab(body);
  else if (settingsTab === "models") renderModelsTab(body);
  else renderMcpTab(body);
}

function inp(ph: string, val = "", pw = false): HTMLInputElement {
  const i = el("input") as HTMLInputElement; i.placeholder = ph; i.value = val; if (pw) i.type = "password"; return i;
}

function renderProvidersTab(body: HTMLElement) {
  body.append(el("div", "hint", "Set API keys, base URLs, and default models. Add a custom OpenAI-compatible API (e.g. your Hermes endpoint) at the bottom."));
  for (const p of cfg!.providers) {
    const card = el("div", "scard");
    const h = el("div", "scard-h");
    h.append(el("span", "", p.name + (p.builtin ? "" : " · custom")));
    h.append(el("span", "badge " + (p.available ? "ok" : "off"), p.available ? "ready" : "no key"));
    card.append(h);
    const key = inp(p.hasKey ? "key set — type to replace" : "API key", "", true);
    const url = inp("base URL (optional)", p.baseURL || "");
    const model = inp("default model (optional)", p.defaultModel || "");
    const save = el("button", "btn primary", "Save");
    save.onclick = () => {
      const msg: any = { type: "setProvider", name: p.name };
      if (key.value) msg.apiKey = key.value;
      if (url.value) msg.baseURL = url.value;
      if (model.value) msg.defaultModel = model.value;
      send(msg); key.value = "";
    };
    const row = el("div", "srow"); row.append(key, url, model, save); card.append(row);
    body.append(card);
  }
  const add = el("div", "scard");
  add.append(el("div", "scard-h", "+ Add custom API (OpenAI-compatible)"));
  const name = inp("name (e.g. hermes)");
  const url = inp("base URL (e.g. https://…/v1)");
  const key = inp("API key (optional)", "", true);
  const addBtn = el("button", "btn primary", "Add");
  addBtn.onclick = () => { const n = name.value.trim(); if (!n) return; const msg: any = { type: "setProvider", name: n }; if (url.value) msg.baseURL = url.value; if (key.value) msg.apiKey = key.value; send(msg); name.value = url.value = key.value = ""; };
  const row = el("div", "srow"); row.append(name, url, key, addBtn); add.append(row);
  body.append(add);
}

function renderModelsTab(body: HTMLElement) {
  body.append(el("div", "hint", "Models shown in the palette and selector. Format: provider/model (e.g. hermes/hermes-3)."));
  const list = el("div", "list");
  for (const m of cfg!.models) {
    const row = el("div", "srow-mini");
    row.append(el("span", "mono", m));
    const rm = el("button", "btn danger", "remove"); rm.onclick = () => send({ type: "removeModel", model: m });
    row.append(rm); list.append(row);
  }
  body.append(list);
  const i = inp("provider/model");
  const addBtn = el("button", "btn primary", "Add model"); addBtn.onclick = () => { const v = i.value.trim(); if (v) { send({ type: "addModel", model: v }); i.value = ""; } };
  const row = el("div", "srow"); row.append(i, addBtn); body.append(row);
}

function renderMcpTab(body: HTMLElement) {
  body.append(el("div", "hint", "MCP servers. Local: a command like  npx -y @scope/server.  Remote: a Streamable-HTTP URL."));
  const list = el("div", "list");
  for (const s of cfg!.mcp) {
    const row = el("div", "srow-mini");
    const nm = el("span", "", s.name + (s.connected ? " ●" : "")); nm.style.color = s.connected ? "var(--good)" : "var(--text-dim)";
    row.append(nm);
    row.append(el("span", "mono", (s.command ? s.command.join(" ") : s.url) || ""));
    const tog = el("button", "btn", s.enabled ? "on" : "off"); tog.onclick = () => send({ type: "toggleMcp", name: s.name, enabled: !s.enabled });
    const rm = el("button", "btn danger", "remove"); rm.onclick = () => send({ type: "removeMcp", name: s.name });
    row.append(tog, rm); list.append(row);
  }
  body.append(list);
  const add = el("div", "scard");
  add.append(el("div", "scard-h", "+ Add MCP server"));
  const name = inp("name");
  const cmd = inp("command (e.g. npx -y @modelcontextprotocol/server-everything)");
  const url = inp("remote URL (optional)");
  const addBtn = el("button", "btn primary", "Add");
  addBtn.onclick = () => {
    const n = name.value.trim(); if (!n) return;
    const msg: any = { type: "addMcp", name: n, enabled: true };
    if (cmd.value.trim()) msg.command = cmd.value.trim().split(/\s+/);
    if (url.value.trim()) msg.url = url.value.trim();
    send(msg); name.value = cmd.value = url.value = "";
  };
  const row = el("div", "srow"); row.append(name, cmd, url, addBtn); add.append(row);
  body.append(add);
}

// ---- websocket --------------------------------------------------------------
function send(msg: any) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }

let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const MAX_MSG_BYTES = 16 * 1024 * 1024; // 16MB guard against oversized frames

function setConn(status: ConnStatus) { connStatus = status; renderBanner(); }

function renderBanner() {
  let b = document.getElementById("conn-banner");
  const text =
    connStatus === "reconnecting" ? `Reconnecting to engine… (attempt ${reconnectAttempts})` :
    connStatus === "closed" ? "Disconnected from engine. Retrying…" :
    connStatus === "noengine" ? "No engine. Launch via the app, or open with ?port=&token=" :
    connStatus === "connecting" ? "Connecting to engine…" : "";
  if (!text) { if (b) b.remove(); return; }
  if (!b) { b = el("div", "conn-banner"); b.id = "conn-banner"; document.body.append(b); }
  b.className = "conn-banner " + connStatus;
  b.textContent = text;
}

function connect() {
  if (!PORT) {
    setConn("noengine");
    $("#app").innerHTML = `<div style="display:grid;place-items:center;height:100%;color:#8295b6;font-family:monospace">No engine. Launch via the app, or open with ?port=&token=</div>`;
    return;
  }
  setConn(reconnectAttempts > 0 ? "reconnecting" : "connecting");
  try {
    ws = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${TOKEN}`);
  } catch {
    scheduleReconnect();
    return;
  }
  ws.onopen = () => { reconnectAttempts = 0; setConn("open"); if (snap) send({ type: "getState" }); };
  ws.onmessage = (e) => {
    const data = typeof e.data === "string" ? e.data : "";
    if (!data || data.length > MAX_MSG_BYTES) return; // drop empty/oversized
    let m: ServerMessage;
    try { m = JSON.parse(data); } catch { if (DEV) console.warn("[sentinel] bad JSON frame", data.slice(0, 200)); return; }
    if (!m || typeof (m as any).type !== "string") return;
    dispatch(m);
  };
  ws.onerror = () => { /* onclose follows; surface there */ };
  ws.onclose = () => { busy = false; setSendBtn(); if (snap) renderRight(); scheduleReconnect(); };
}

function scheduleReconnect() {
  if (!PORT) return;
  if (reconnectTimer) return;
  setConn(reconnectAttempts === 0 ? "closed" : "reconnecting");
  const delay = Math.min(15000, 500 * Math.pow(2, reconnectAttempts)); // 0.5s → 15s cap
  reconnectAttempts++;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
}

/**
 * Single source of truth for every server -> client message. Exported so a test
 * can feed it each ServerMessage variant. Every variant in the protocol union is
 * handled here; unknown types are logged in dev and otherwise ignored.
 */
export function dispatch(m: ServerMessage) {
  switch (m.type) {
    case "hello": snap = m.state; shell(); renderAll(); renderChat(); break;
    case "state": snap = m.state; renderAll(); break;
    case "busy": busy = m.busy; if (!busy) round = 0; setSendBtn(); if (snap) renderRight(); break;
    case "user": blocks.push({ kind: "user", text: m.text, contextCount: m.contextCount }); renderChat(); break;
    case "round_start": round = m.round; if (snap) renderRight(); break;
    case "round_end": round = m.round; if (snap) renderRight(); break;
    case "token": appendToken(m.text); break;
    case "stream_end": endStream(); break;
    case "tool_start":
      pendingToolArgs = m.argsRaw;
      blocks.push({ kind: "tool", tool: m.name, args: m.args, argsRaw: m.argsRaw, running: true });
      renderChat(); break;
    case "tool_result": {
      for (let i = blocks.length - 1; i >= 0; i--) { const b = blocks[i]; if (b.kind === "tool" && b.running) { b.running = false; b.ok = m.ok; b.firstLine = m.firstLine; b.full = m.full; break; } }
      renderChat(); break;
    }
    case "permission_request": pendingPerm = { tool: m.tool, action: m.action, path: m.path, reason: m.reason, diff: m.diff }; renderChat(); break;
    case "usage": if (snap) { snap.cost.totalTokens += m.totalTokens; snap.cost.estimatedCostUSD = m.estimatedCostUSD; renderRight(); } break;
    case "system": blocks.push({ kind: "system", text: m.text }); renderChat(); break;
    case "error": endStream(); blocks.push({ kind: "error", text: m.message }); renderChat(); break;
    case "checkpoints": renderCheckpoints(m.items); break;
    case "todos": todos = m.items || []; if (snap) renderRight(); break;
    case "config": cfg = m.config; if (snap) renderRight(); renderSettingsBody(); break;
    case "done": endStream(); round = 0; if (snap) renderRight(); break;
    case "history": {
      // Rebuild the message list from a full conversation replay (sent on
      // getState / reconnect). Without this a transient WS drop blanks the
      // chat even though the engine still holds every turn.
      endStream();
      blocks = m.messages.map((msg) => {
        if (msg.role === "user") return { kind: "user", text: msg.content } as Block;
        if (msg.role === "assistant") return { kind: "assistant", text: msg.content } as Block;
        // Tool messages are stored as "[Tool: <name>]\n<text>"; surface name +
        // full text so the tool card renders correctly.
        const name = msg.name || "";
        const full = msg.content.replace(/^\[Tool: [^\]]+\]\n?/, "");
        return {
          kind: "tool",
          tool: name,
          args: {},
          argsRaw: "",
          ok: !full.startsWith("ERROR"),
          firstLine: full.split("\n")[0].slice(0, 200),
          full,
          running: false,
        } as Block;
      });
      renderChat();
      break;
    }
    case "files": {
      // D2: @-mention file autocomplete — populate the popup from the engine glob.
      // Only accept if the composer is still in an @-mention (avoids a stale reply
      // overwriting a menu the user has since left).
      const inp = $("#input") as HTMLTextAreaElement | null;
      const tok = inp ? (inp.value.slice(0, inp.selectionStart ?? inp.value.length).split(/\s/).pop() || "") : "";
      if (tok.startsWith("@")) {
        acItems = m.items.slice(0, 8).map((p) => ({ label: "@" + p, insert: "@" + p + " " }));
        acSel = 0;
        renderAc();
      }
      break;
    }
    default: {
      // Exhaustiveness: if a new ServerMessage variant is added, TS flags this.
      const _never: never = m;
      if (DEV) console.warn("[sentinel] unhandled server message", (_never as any)?.type, _never);
    }
  }
}

function renderCheckpoints(items: CheckpointItem[]) {
  if (!items.length) { blocks.push({ kind: "system", text: "No checkpoints." }); renderChat(); return; }
  const lines = items.map((c) => `${c.existed ? "edit" : "create"} ${c.tool} → ${c.path}`);
  blocks.push({ kind: "system", text: "Checkpoints:\n" + lines.join("\n") });
  renderChat();
}

let streaming: Extract<Block, { kind: "assistant" }> | null = null;
let streamEl: HTMLElement | null = null; // live DOM body of the streaming block
function appendToken(t: string) {
  if (!t) return;
  if (!streaming) { streaming = { kind: "assistant", text: "", streaming: true }; blocks.push(streaming); renderChat(); }
  streaming.text += t;
  // Update only the streaming node — avoids rebuilding the whole chat per token
  // (which caused flicker and re-triggered the rise animation on every block).
  if (streamEl && streamEl.isConnected) {
    streamEl.innerHTML = renderStreamingHTML(streaming.text) + '<span class="cursor"></span>';
    const chat = document.getElementById("chat");
    if (chat && stick) chat.scrollTop = chat.scrollHeight;
  } else {
    renderChat();
  }
}
function endStream() {
  if (streaming) { streaming.streaming = false; streaming = null; streamEl = null; renderChat(); }
}
function setSendBtn() { const b = $("#send"); if (!b) return; b.textContent = busy ? "Stop ■" : "Send ➤"; b.classList.toggle("stop", busy); }

// Wire the animated constellation background onto the dead <canvas id="bg-canvas">.
// Recolors with the active theme (reads --accent-rgb). Pauses when tab hidden.
import { initBackground } from "./background.js";
const bgCanvas = document.getElementById("bg-canvas") as HTMLCanvasElement | null;
if (bgCanvas) initBackground(bgCanvas);

connect();
