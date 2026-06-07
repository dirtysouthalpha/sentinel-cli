import "./style.css";
import { diffLines } from "diff";

// ---- protocol (mirror of src/server/protocol.ts) ----------------------------
type StateSnapshot = {
  model: string; agent: string; theme: string; permissionMode: string;
  themes: { name: string; display: string }[]; models: string[]; agents: string[];
  sessions: { id: string; title: string; active: boolean }[];
  mcpTools: { server: string; tool: string; full: string }[];
  cost: { promptTokens: number; completionTokens: number; totalTokens: number; estimatedCostUSD: number; requests: number };
  providers: { name: string; available: boolean }[];
};
type ServerMessage = any;

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
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; streaming?: boolean }
  | { kind: "tool"; tool: string; args: any; argsRaw: string; ok?: boolean; firstLine?: string; full?: string; running?: boolean }
  | { kind: "system"; text: string }
  | { kind: "error"; text: string };
const blocks: Block[] = [];
let pendingPerm: { tool: string; action?: string; path?: string; reason: string } | null = null;
let pendingToolArgs = "";

const $ = (sel: string, root: ParentNode = document) => root.querySelector(sel) as HTMLElement;
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
      </div>

      <div class="panel rail" id="rail"></div>
      <div class="panel sidebar" id="sidebar"></div>
      <div class="panel center">
        <div class="chat" id="chat"></div>
        <div class="composer-wrap">
          <div class="chips" id="chips"></div>
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
  $("#model-sel").onclick = () => openPalette("model ");
  $("#agent-sel").onclick = () => openPalette("agent ");

  const input = $("#input") as HTMLTextAreaElement;
  input.addEventListener("input", () => { autosize(input); autocomplete(input); });
  input.addEventListener("keydown", onInputKey);
  renderChips();
  input.focus();
}

function autosize(t: HTMLTextAreaElement) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 160) + "px"; }

// ---- rendering --------------------------------------------------------------
function renderAll() {
  if (!snap) return;
  document.documentElement.dataset.accent = accentFor(snap.theme);
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

const AGENT_ICONS: Record<string, string> = { gsd: "⚡", code: "‹›", ask: "?", plan: "◇", debug: "🐞", architect: "▱" };
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
  const pct = Math.min(100, Math.round((tokens / 120000) * 100));
  const k1 = el("div", "kv"); k1.append(el("span", "", "tokens")); k1.append(el("span", "v", tokens.toLocaleString())); cu.append(k1);
  const k2 = el("div", "kv"); k2.append(el("span", "", "cost")); k2.append(el("span", "v", "$" + snap!.cost.estimatedCostUSD.toFixed(4))); cu.append(k2);
  const g = el("div", "gauge"); const i = el("i"); i.style.width = pct + "%"; g.append(i); cu.append(g);
  cu.append(el("div", "kv", `<span>window</span><span class="v">${pct}%</span>`));
  r.append(cu);
  // tools / mcp
  const tools = el("div", "card");
  tools.append(el("div", "ch", "⚒ Top Agents · MCP"));
  const builtins = ["file", "bash", "search", "git", "web", "patch"];
  for (const b of builtins) { const kv = el("div", "kv"); kv.append(el("span", "", b)); kv.append(el("span", "v", "built-in")); tools.append(kv); }
  for (const m of snap!.mcpTools.slice(0, 6)) { const kv = el("div", "kv"); kv.append(el("span", "", m.tool)); kv.append(el("span", "v", "mcp:" + m.server)); tools.append(kv); }
  r.append(tools);
  // status
  const st = el("div", "card");
  st.append(el("div", "ch", "◉ Status"));
  const line = el("div", "status-line");
  line.append(el("span", "d" + (busy ? " busy" : "")));
  line.append(el("span", "", (busy ? "working" : "ready") + " · " + snap!.agent + " · " + snap!.permissionMode));
  st.append(line);
  r.append(st);
}

function projectName() { return (w.__SENTINEL_PROJECT__ as string) || "project"; }

const CHIPS = ["/fix", "/review", "/build", "/test", "/explain", "/refactor", "/secure", "/optimize"];
function renderChips() {
  const c = $("#chips"); c.innerHTML = "";
  for (const ch of CHIPS) { const e = el("div", "chip", ch); e.onclick = () => { const i = $("#input") as HTMLTextAreaElement; i.value = ch + " "; i.focus(); }; c.append(e); }
}

// ---- chat blocks ------------------------------------------------------------
function renderChat() {
  const chat = $("#chat"); chat.innerHTML = "";
  if (blocks.length === 0 && !pendingPerm) {
    chat.append(el("div", "welcome", `<div class="big">Welcome to <b>Sentinel</b></div><p>Describe a bug or feature, or start a slash command. The agent reads files, runs commands, and edits code — gated by your permission mode.</p>`));
    return;
  }
  for (const b of blocks) chat.append(renderBlock(b));
  if (pendingPerm) chat.append(renderPerm());
  chat.scrollTop = chat.scrollHeight;
}

function renderBlock(b: Block): HTMLElement {
  if (b.kind === "user") return wrap("user", "You", `<div class="body">${esc(b.text)}</div>`);
  if (b.kind === "assistant") return wrap("assistant", "Sentinel", `<div class="body">${esc(b.text)}${b.streaming ? '<span class="cursor"></span>' : ""}</div>`);
  if (b.kind === "system") return wrap("", "", `<div class="body" style="color:var(--text-faint);font-size:13px">${esc(b.text)}</div>`);
  if (b.kind === "error") return wrap("", "", `<div class="body" style="color:var(--bad)">✗ ${esc(b.text)}</div>`);
  return renderTool(b);
}
function wrap(cls: string, who: string, inner: string): HTMLElement {
  const e = el("div", "block " + cls);
  if (who) e.append(el("div", "who", `<span class="dot"></span>${who}`));
  const body = document.createElement("div");
  body.innerHTML = inner;
  while (body.firstChild) e.append(body.firstChild);
  return e;
}

function renderTool(b: Extract<Block, { kind: "tool" }>): HTMLElement {
  const card = el("div", "tool");
  const head = el("div", "head");
  head.append(el("span", "name", "» " + b.tool));
  head.append(el("span", "args", esc(b.argsRaw || "")));
  if (b.running) head.append(el("span", "spin"));
  else head.append(el("span", "status " + (b.ok ? "ok" : "err"), b.ok ? "ok" : "err"));
  card.append(head);
  const d = computeDiff(b);
  if (d) card.append(d);
  else if (b.full && !b.running) card.append(el("div", "out", esc(b.full.slice(0, 4000))));
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
  const btns = el("div", "btns");
  const yes = el("button", "btn primary", "Allow"); yes.onclick = () => { send({ type: "permission", allow: true }); pendingPerm = null; renderChat(); };
  const no = el("button", "btn danger", "Deny"); no.onclick = () => { send({ type: "permission", allow: false }); pendingPerm = null; renderChat(); };
  btns.append(yes, no); card.append(btns);
  return card;
}

// ---- composer + send --------------------------------------------------------
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
  i.value = ""; autosize(i); closeAc();
  if (text.startsWith("/")) {
    const [name, ...args] = text.slice(1).split(/\s+/);
    send({ type: "command", name, args });
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
    const cmds = [...CHIPS.map((c) => c.slice(1)), "ship", "docgen", "migrate", "analyze", "compact", "clear", "undo", "checkpoints"];
    acItems = [...new Set(cmds)].filter((c) => c.startsWith(q)).slice(0, 8).map((c) => ({ label: "/" + c, insert: "/" + c + " " }));
  } else if (token.startsWith("@")) {
    acItems = []; // file completion handled by engine context; keep simple
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
  for (const c of [...CHIPS, "/ship", "/analyze", "/docgen", "/migrate"]) out.push({ label: c, cat: "command", ico: "›", run: () => { const [n, ...a] = c.slice(1).split(/\s+/); send({ type: "command", name: n, args: a }); } });
  for (const pm of ["yolo", "auto", "gated"]) out.push({ label: "permissions: " + pm, cat: "mode", ico: "🛡", run: () => send({ type: "setPermissionMode", mode: pm as any }) });
  for (const c of ["compact", "clear", "undo"]) out.push({ label: c, cat: "action", ico: "↺", run: () => send({ type: c } as any) });
  return out;
}
function cyclePerm() {
  if (!snap) return; const order = ["yolo", "auto", "gated"]; const next = order[(order.indexOf(snap.permissionMode) + 1) % 3];
  send({ type: "setPermissionMode", mode: next as any });
}

// ---- websocket --------------------------------------------------------------
function send(msg: any) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }

function connect() {
  if (!PORT) { $("#app").innerHTML = `<div style="display:grid;place-items:center;height:100%;color:#8295b6;font-family:monospace">No engine. Launch via the app, or open with ?port=&token=</div>`; return; }
  ws = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${TOKEN}`);
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  ws.onclose = () => { busy = false; if (snap) renderRight(); };
}

function onMessage(m: ServerMessage) {
  switch (m.type) {
    case "hello": snap = m.state; shell(); renderAll(); renderChat(); break;
    case "state": snap = m.state; renderAll(); break;
    case "busy": busy = m.busy; setSendBtn(); if (snap) renderRight(); break;
    case "user": blocks.push({ kind: "user", text: m.text }); renderChat(); break;
    case "round_start": break;
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
    case "permission_request": pendingPerm = { tool: m.tool, action: m.action, path: m.path, reason: m.reason }; renderChat(); break;
    case "usage": if (snap) { snap.cost.totalTokens += m.totalTokens; snap.cost.estimatedCostUSD = m.estimatedCostUSD; renderRight(); } break;
    case "system": blocks.push({ kind: "system", text: m.text }); renderChat(); break;
    case "error": endStream(); blocks.push({ kind: "error", text: m.message }); renderChat(); break;
    case "done": endStream(); break;
  }
}

let streaming: Extract<Block, { kind: "assistant" }> | null = null;
function appendToken(t: string) {
  if (!streaming) { streaming = { kind: "assistant", text: "", streaming: true }; blocks.push(streaming); }
  streaming.text += t; renderChat();
}
function endStream() { if (streaming) { streaming.streaming = false; streaming = null; renderChat(); } }
function setSendBtn() { const b = $("#send"); if (!b) return; b.textContent = busy ? "Stop ■" : "Send ➤"; b.classList.toggle("stop", busy); }

connect();
