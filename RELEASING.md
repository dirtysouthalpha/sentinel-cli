# Releasing

`@dirtysouthalpha/sentinel-cli` ships to **npm** (scoped, public) and to **GitHub Releases**.
The package name is scoped because the unscoped `sentinelcli` is blocked by npm as too
similar to the existing `sentinel-cli`. The installed CLI command is still `sentinel`.

## One-time setup (for automated publishing)

1. Create an npm **Automation** token (npmjs.com → Access Tokens → Generate → *Automation*).
   Automation tokens bypass 2FA, which CI requires.
2. Add it to the repo: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `NPM_TOKEN`
   - Value: the token
3. That's it — `.github/workflows/publish.yml` publishes on every `vX.Y.Z` tag.

## Automated release (recommended)

```bash
# 1. Bump the version (updates package.json + lockfile, no git tag yet)
npm version patch            # or: minor | major | 1.2.0

# 2. Push the commit and the tag the bump created
git push origin main
git push origin "v$(node -p "require('./package.json').version")"
```

Pushing the `v*` tag triggers the workflow: it runs `npm ci`, `npm run lint`, `npm test`,
then `npm publish --access public --provenance`. Watch it under the repo's **Actions** tab.

Then cut the GitHub Release notes:

```bash
gh release create "v$(node -p "require('./package.json').version")" \
  --title "Sentinel CLI v$(node -p "require('./package.json').version")" \
  --notes "…release notes…"
```

## Manual publish (no CI)

```bash
npm run lint && npm test && npm run build   # prepublishOnly also builds
npm publish --access public                 # prompts for your 2FA OTP
```

If npm does **not** prompt for the OTP (some setups don't), pass it explicitly:

```bash
npm publish --access public --otp=123456
```

Or publish with an Automation token without an OTP (do NOT commit the token):

```bash
npm publish --access public --//registry.npmjs.org/:_authToken=YOUR_AUTOMATION_TOKEN
```

## Gotchas (learned the hard way)

- **Scoped name + `--access public`.** A scoped package defaults to *restricted*; the
  `--access public` flag (and the same in the workflow) is required to publish it publicly.
- **`bin` paths must not start with `./`.** npm silently strips a `bin` entry like
  `"./dist/cli.js"`, so the installed `sentinel` command would be missing. Keep it
  `"sentinel": "dist/cli.js"` (run `npm pkg fix` if unsure).
- **npm versions are immutable.** You can't republish a version — verify the tarball with
  `npm publish --dry-run` (check `bin`, no `.env`/secrets) before the real publish.
- **Propagation lag.** A brand-new scoped package can 404 on `npm view` for a few minutes
  after a successful publish; that's normal.

## Verify a release

```bash
npm view @dirtysouthalpha/sentinel-cli version
npm i -g @dirtysouthalpha/sentinel-cli && sentinel --help
```
