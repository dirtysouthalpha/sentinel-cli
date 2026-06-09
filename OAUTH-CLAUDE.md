# Claude over OAuth (subscription) — Sentinel + anthropic-oauth-router

Use your Claude Pro/Max subscription with Sentinel — **no metered API key** — by
routing through the local OAuth proxy. Combined with headroom context
compression (already wired into Sentinel), you get cheap, high-context Claude.

## How the pieces fit

- **anthropic-oauth-router** (Python, in `_ref/anthropic-oauth-router`): a local
  proxy on `127.0.0.1:8080` that authenticates via Claude Code's OAuth flow and
  transparently forwards to `api.anthropic.com` using your subscription token.
- **Sentinel**: points its `anthropic` provider's `baseURL` at the proxy.
- **headroom** (`src/ai/compression.ts`): shrinks the context before each turn
  (the "% saved" in the status bar).

Stacked: OAuth (subscription access) -> headroom (fewer tokens) -> model router.

## 1. Start the proxy

```powershell
cd _ref\anthropic-oauth-router
pip install -r requirements.txt
python cli.py serve                 # proxy on 127.0.0.1:8080 — leave it running
```

In a second terminal, authenticate:

```powershell
cd _ref\anthropic-oauth-router
python cli.py authenticate          # opens your browser; log in with Claude
```

(`authenticate` now drives the running server, so the PKCE verifier and the
`/callback` share one process and the login actually completes.)

## 2. Point Sentinel at the proxy

In your project `sentinel.json` (or `.sentinel/config.json`):

```json
{
  "model": "anthropic/claude-sonnet-4-20250514",
  "provider": {
    "anthropic": {
      "apiKey": "oauth-proxy",
      "baseURL": "http://localhost:8080/v1/anthropic"
    }
  }
}
```

- `apiKey` is a placeholder — Sentinel requires a non-empty value, but the proxy
  strips it and injects your real OAuth bearer token.
- `baseURL` routes every request through the proxy. The proxy now normalizes the
  path, so Sentinel's `/v1/messages` is forwarded correctly (no `/v1` doubling).

## 3. Use it

```
sentinel
```

Pick a Claude model your subscription includes. Compression is automatic.

## OpenAI as well

The proxy also exposes `http://localhost:8080/v1/openai`. Once you've
authenticated an OpenAI token, point an `openai`/`custom` provider's `baseURL`
there.

## What changed in the router (review with `git diff` inside `_ref/anthropic-oauth-router`)

1. **Path normalization** in `proxy_anthropic` / `proxy_openai` — clients may
   append either `/messages` or `/v1/messages` without producing `/v1/v1/...`.
   (Sentinel appends `/v1/messages`; this is what previously broke.)
2. **Strip the client `x-api-key`** before forwarding — the injected OAuth bearer
   is authoritative.
3. **`cli.py authenticate`** now calls the running server's `/oauth/start`
   instead of a throwaway process whose verifier could never match the callback.

## Troubleshooting

- `401 No valid token` — run `python cli.py authenticate` again.
- Connection refused — the proxy isn't running (`python cli.py serve`).
- Model errors — confirm the Claude model is part of your subscription.

## Next steps we discussed

- A `sentinel /connect claude` command that launches the proxy and runs the
  OAuth flow in one step.
- Make the `anthropic` provider proxy-aware so no placeholder `apiKey` is needed.
- Surface token expiry / auto-refresh in the status bar.
