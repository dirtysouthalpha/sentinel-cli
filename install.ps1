# Sentinel CLI - one-click installer (Windows / PowerShell)
# Builds from source and registers the global `sentinel` command.
# Run it by double-clicking install.bat, or:  powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Say($msg, $color = "Gray") { Write-Host $msg -ForegroundColor $color }

Say ""
Say "  ===========================================" "Cyan"
Say "    Sentinel CLI  -  installer" "Cyan"
Say "  ===========================================" "Cyan"
Say ""

# 1) Is Node installed?
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Say "  [X] Node.js was not found on your PATH." "Red"
  Say "      Install Node 20+ from https://nodejs.org , reopen your terminal, then re-run." "Yellow"
  exit 1
}

# 2) Is it new enough?
$ver = (& node -v).TrimStart("v")
$major = [int]($ver.Split(".")[0])
if ($major -lt 20) {
  Say "  [X] Node v$ver found, but Sentinel needs Node 20 or newer." "Red"
  Say "      Update from https://nodejs.org then re-run." "Yellow"
  exit 1
}
Say "  [ok] Node v$ver" "Green"

# 3) Install dependencies
Say "  ->  Installing dependencies (npm install) ..." "Yellow"
npm install
if ($LASTEXITCODE -ne 0) { Say "  [X] 'npm install' failed (see output above)." "Red"; exit 1 }

# 4) Build dist/
Say "  ->  Building (npm run build) ..." "Yellow"
npm run build
if ($LASTEXITCODE -ne 0) { Say "  [X] 'npm run build' failed (see output above)." "Red"; exit 1 }

# 5) Register the global 'sentinel' command
Say "  ->  Registering the 'sentinel' command (npm install -g .) ..." "Yellow"
npm install -g .
if ($LASTEXITCODE -ne 0) {
  Say "  [X] Global install failed." "Red"
  Say "      Tip: re-run this installer from a terminal opened 'As administrator'," "Yellow"
  Say "      or run  npm install -g .  yourself from this folder." "Yellow"
  exit 1
}

Say ""
Say "  ===========================================" "Green"
Say "    Done!  Open a NEW terminal and run:" "Green"
Say "        sentinel" "Cyan"
Say "  ===========================================" "Green"
Say ""
Say "  First run? Set up a provider API key with:   sentinel setup" "Gray"
Say ""
