# Installing Sentinel

After install you launch it from any terminal by typing **`sentinel`**.

**Requirement:** [Node.js 20 or newer](https://nodejs.org). Check with `node -v`.

---

## Option A — One-click on Windows (works right now, before publishing)

Builds from this folder and registers the `sentinel` command globally.

1. Double-click **`install.bat`**.
2. Wait for it to finish (`npm install` → build → global install).
3. Open a **new** terminal and run:

   ```
   sentinel
   ```

If global install fails with a permissions error, right-click `install.bat` → **Run as administrator**.

> Prefer the terminal? Same thing without the double-click:
> ```powershell
> powershell -ExecutionPolicy Bypass -File install.ps1
> ```

---

## Option B — From npm (after you publish; see below)

Once the package is on npm, anyone (including you, on any machine) installs it with one line:

```
npm i -g sentinelcli
sentinel
```

---

## First run

Set up a provider API key (Z.ai, Anthropic, OpenAI, Gemini, or local Ollama):

```
sentinel setup
```

## Updating

- **From source:** `git pull` then double-click `install.bat` again.
- **From npm:** `npm i -g sentinelcli@latest`

## Uninstalling

Double-click **`uninstall.bat`**, or run:

```
npm uninstall -g sentinelcli
```

Your project files in this folder are not affected.

---

## Publishing to npm (maintainer steps)

Publishing needs **your** npm credentials, so it can't be automated for you. One-time setup, then it's two commands per release.

**Before the first publish — confirm the repo URL.** `package.json` currently points `repository`/`homepage`/`bugs` at `github.com/dirtysouthalpha/sentinel-cli`. Edit those if your GitHub repo differs (or delete them).

1. **Log in** (needs a free account from npmjs.com):

   ```
   npm login
   ```

2. **Publish.** `prepublishOnly` runs `npm run build` automatically, so `dist/` is always fresh:

   ```
   npm publish
   ```

   `sentinelcli` is an unscoped public name, so no extra flags are needed. (If npm prompts for a one-time password, that's your 2FA code.)

3. **Verify:**

   ```
   npm view sentinelcli
   npm i -g sentinelcli      # try the real thing
   sentinel --version
   ```

### Cutting later releases

Bump the version (this creates a git tag too), then publish:

```
npm version patch     # or: minor | major
npm publish
```

### What ships

Only `dist/` (minus source maps), `config/`, `README.md`, and `LICENSE` — about 168 kB packed. Verify any time with:

```
npm pack --dry-run
```
