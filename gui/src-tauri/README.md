# Sentinel GUI — native desktop shell (Tauri v2)

This wraps the `gui/` web frontend in a native window. On launch the Rust shell
spawns the Sentinel engine (`node dist/cli.js serve`), reads its `{port, token}`
handshake, and injects them into the webview — so the same frontend that runs in
the browser (`sentinel gui`) runs here in a native window driving the real engine.

## Prerequisites
- **Rust** toolchain — https://rustup.rs
- **Node** on PATH, and the CLI built once at the repo root: `npm install && npm run build`
- Platform webview: Windows has WebView2 built in; macOS/Linux need the system webview (see Tauri prereqs).

## Run (dev)
```bash
cd gui
npm install                 # installs @tauri-apps/cli + frontend deps
npm run tauri dev           # starts Vite + the native window + the engine
```
`tauri dev` runs the Vite dev server (per `tauri.conf.json` → `beforeDevCommand`)
and the Rust shell spawns the engine automatically.

## Build (installer)
```bash
cd gui
npm run tauri build         # bundles the app for your OS into src-tauri/target/release/bundle
```
Replace the placeholder icons first: `npm run tauri icon path/to/icon.png`.

## Configuration (env)
- `SENTINEL_ENGINE` — full path to `dist/cli.js` (default: discovered by walking up from the app/cwd).
- `SENTINEL_PROJECT` — project root the agent operates in (default: current dir).

## Notes
- The engine is a **local-only** WebSocket (`127.0.0.1`) with a per-launch token.
- A fully self-contained installer would bundle Node as a sidecar binary; today
  the shell uses the Node already on your machine (fine for dev/personal use).
- This Rust scaffold targets Tauri v2 conventions; if your installed Tauri minor
  version differs, the `WebviewWindowBuilder` API may need a tiny tweak.
