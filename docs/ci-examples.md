# CI Integration Examples

Sentinel CLI's headless mode (`sentinel run`) is designed for non-interactive use in CI/CD pipelines, pre-commit hooks, and scripted automation.

## Quick Reference

| Flag | Purpose |
|---|---|
| `--json` | Stream NDJSON events to stdout |
| `--permission-mode yolo\|auto\|gated` | Control tool-approval behavior |
| `--yes` | Auto-approve all prompts |
| `--max-steps N` | Cap the number of agent rounds |
| `--model provider/model` | Override the default model |

**Exit codes:**

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Error |
| `3` | Max rounds reached |
| `130` | Aborted (SIGINT) |

---

## 1. GitHub Actions

```yaml
name: Sentinel Security Review

on:
  pull_request:
    branches: [main]

jobs:
  sentinel-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Sentinel CLI
        run: npm install -g @anthropic/sentinel-cli

      - name: Run security review
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          sentinel run "review the code for security issues" \
            --json \
            --yes \
            --permission-mode yolo \
            2>sentinel-errors.log

          echo "Exit code: $?"

      - name: Check exit code
        if: failure()
        run: |
          echo "::error::Sentinel security review failed"
          cat sentinel-errors.log
```

### With NDJSON parsing

```yaml
name: Sentinel Review (Parsed)

on:
  pull_request:
    branches: [main]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Sentinel CLI
        run: npm install -g @anthropic/sentinel-cli

      - name: Run review and capture results
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          sentinel run "review the code for security issues" \
            --json \
            --yes \
            --permission-mode yolo \
            > sentinel-output.ndjson

      - name: Parse results
        if: always()
        run: |
          node .github/scripts/parse-sentinel.mjs sentinel-output.ndjson
```

`.github/scripts/parse-sentinel.mjs`:

```js
import { readFileSync } from "fs";

const file = process.argv[2];
const lines = readFileSync(file, "utf-8").trim().split("\n");

for (const line of lines) {
  const event = JSON.parse(line);

  if (event.type === "error") {
    console.error(`::error::${event.message}`);
  }

  if (event.type === "tool_result") {
    console.log(`Tool: ${event.tool}`);
    console.log(event.output);
  }

  if (event.type === "done") {
    console.log("Review complete.");
  }
}
```

---

## 2. Pre-commit Hook

### Bash (Linux / macOS)

Save as `.git/hooks/pre-commit` and make executable (`chmod +x`):

```bash
#!/usr/bin/env bash

set -euo pipefail

# Get staged files for context
staged=$(git diff --cached --name-only --diff-filter=ACM | head -50)

if [ -z "$staged" ]; then
  exit 0
fi

echo "Running Sentinel lint check on staged files..."

sentinel run "check for lint errors in these staged files: $staged" \
  --yes \
  --max-steps 5

exit_code=$?

case $exit_code in
  0)
    echo "Sentinel: No issues found."
    exit 0
    ;;
  3)
    echo "Sentinel: Max steps reached — check results above."
    exit 1
    ;;
  *)
    echo "Sentinel: Review failed with exit code $exit_code."
    exit 1
    ;;
esac
```

### PowerShell (Windows)

Save as `.git\hooks\pre-commit` (no extension) or use a pre-commit framework:

```powershell
$ErrorActionPreference = "Stop"

$staged = git diff --cached --name-only --diff-filter=ACM | Select-Object -First 50

if (-not $staged) {
  exit 0
}

$stagedList = $staged -join ", "
Write-Host "Running Sentinel lint check on staged files..."

sentinel run "check for lint errors in these staged files: $stagedList" `
  --yes `
  --max-steps 5

$exitCode = $LASTEXITCODE

switch ($exitCode) {
  0 {
    Write-Host "Sentinel: No issues found."
    exit 0
  }
  3 {
    Write-Host "Sentinel: Max steps reached - check results above."
    exit 1
  }
  default {
    Write-Host "Sentinel: Review failed with exit code $exitCode."
    exit 1
  }
}
```

---

## 3. GitLab CI

```yaml
stages:
  - review

sentinel-review:
  stage: review
  image: node:20
  before_script:
    - npm install -g @anthropic/sentinel-cli
  script:
    - |
      sentinel run "review the code for security issues" \
        --json \
        --yes \
        --permission-mode yolo \
        --max-steps 20 \
        > sentinel-output.ndjson

    - |
      echo "Parsing Sentinel results..."
      node scripts/parse-sentinel.mjs sentinel-output.ndjson
  variables:
    ANTHROPIC_API_KEY: $ANTHROPIC_API_KEY
  artifacts:
    when: always
    paths:
      - sentinel-output.ndjson
    expire_in: 7 days
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```

### With MR comment posting

```yaml
sentinel-mr-comment:
  stage: review
  image: node:20
  before_script:
    - npm install -g @anthropic/sentinel-cli
  script:
    - |
      sentinel run "review the code and output a markdown summary" \
        --json \
        --yes \
        --permission-mode yolo \
        > sentinel-output.ndjson

    - |
      SUMMARY=$(node -e "
        const fs = require('fs');
        const lines = fs.readFileSync('sentinel-output.ndjson','utf-8').trim().split('\n');
        const tokens = lines
          .map(l => JSON.parse(l))
          .filter(e => e.type === 'token')
          .map(e => e.text)
          .join('');
        console.log(tokens);
      ")

    - |
      curl --fail \
        --header "PRIVATE-TOKEN: ${GITLAB_TOKEN}" \
        --data-urlencode "body=${SUMMARY}" \
        "${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/merge_requests/${CI_MERGE_REQUEST_IID}/notes"
  variables:
    GITLAB_TOKEN: $GITLAB_BOT_TOKEN
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```

---

## 4. Programmatic Usage (Node.js)

### Streaming NDJSON in real time

```js
import { spawn } from "child_process";

function sentinelRun(prompt, flags = []) {
  return new Promise((resolve, reject) => {
    const args = ["run", prompt, "--json", ...flags];
    const proc = spawn("sentinel", args, { stdio: ["ignore", "pipe", "pipe"] });

    const events = [];
    let buffer = "";

    proc.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        events.push(event);
        handleEvent(event);
      }
    });

    proc.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
    });

    proc.on("close", (code) => {
      // flush remaining buffer
      if (buffer.trim()) {
        const event = JSON.parse(buffer);
        events.push(event);
        handleEvent(event);
      }
      resolve({ exitCode: code, events });
    });

    proc.on("error", reject);
  });
}

function handleEvent(event) {
  switch (event.type) {
    case "round_start":
      console.log(`[Round ${event.round}]`);
      break;
    case "token":
      process.stdout.write(event.text);
      break;
    case "tool_start":
      console.log(`\n  -> Tool: ${event.tool}`);
      break;
    case "tool_result":
      console.log(`  <- Result: ${event.output?.slice(0, 200)}...`);
      break;
    case "round_end":
      console.log();
      break;
    case "error":
      console.error(`ERROR: ${event.message}`);
      break;
    case "done":
      console.log("\nDone.");
      break;
  }
}

// Usage
const { exitCode, events } = await sentinelRun(
  "review src/ for security issues",
  ["--yes", "--permission-mode", "yolo", "--max-steps", "10"]
);

if (exitCode !== 0) {
  console.error(`Sentinel exited with code ${exitCode}`);
  process.exit(exitCode);
}
```

### Consuming a saved NDJSON file

```js
import { readFileSync } from "fs";

const events = readFileSync("sentinel-output.ndjson", "utf-8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));

// Collect all error events
const errors = events.filter((e) => e.type === "error");
if (errors.length > 0) {
  console.error(`${errors.length} error(s) found:`);
  for (const err of errors) {
    console.error(`  - ${err.message}`);
  }
  process.exit(1);
}

// Collect full text output
const text = events
  .filter((e) => e.type === "token")
  .map((e) => e.text)
  .join("");

console.log(text);
```
