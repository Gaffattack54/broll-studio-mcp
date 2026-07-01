# B-Roll Studio MCP - one-line installer for Windows.
# Installs Node, Git, and Claude Code (if missing), installs this MCP package,
# and registers it in Claude Code at user scope.
#
# One-liner (set your key first):
#   $env:BROLL_API_KEY='brs_live_xxxxx'; irm https://raw.githubusercontent.com/Gaffattack54/broll-studio-mcp/master/install.ps1 | iex
#
# Get a key at: B-Roll Studio -> Settings -> API keys -> Create key.
param(
  [string]$ApiKey = $env:BROLL_API_KEY,
  [string]$ApiBase = "https://broll-studio-ten.vercel.app",
  [string]$Package = "github:Gaffattack54/broll-studio-mcp"
)

$ErrorActionPreference = "Stop"

# Allow npm.ps1 / node scripts to run in THIS process (some machines default to
# Restricted). Process scope only — nothing persistent, no admin needed.
try { Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force } catch {}

function Update-Path {
  $machine = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [System.Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}
function Have($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }
function Step($m) { Write-Host "`n>> $m" -ForegroundColor Cyan }

if (-not $ApiKey -or -not $ApiKey.StartsWith("brs_live_")) {
  Write-Host "[X] No API key. Set it first, then re-run:" -ForegroundColor Red
  Write-Host "    `$env:BROLL_API_KEY='brs_live_xxxxx'; irm https://raw.githubusercontent.com/Gaffattack54/broll-studio-mcp/master/install.ps1 | iex" -ForegroundColor Yellow
  return
}

# 1. Node
if (Have node) { Step "Node already installed ($(node --version))" }
else { Step "Installing Node.js LTS..."; winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-source-agreements --accept-package-agreements; Update-Path }

# 2. Git (npm needs it for a github: package)
if (Have git) { Step "Git already installed" }
else { Step "Installing Git..."; winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements; Update-Path }

# 3. Claude Code
if (Have claude) { Step "Claude Code already installed" }
else { Step "Installing Claude Code..."; Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression; Update-Path }

# The native Claude installer drops claude.exe in ~\.local\bin but may not put it
# on PATH. Add it for this session so `claude mcp add` below works.
$claudeBin = Join-Path $env:USERPROFILE ".local\bin"
if ((Test-Path $claudeBin) -and ($env:Path -notlike "*$claudeBin*")) { $env:Path = "$env:Path;$claudeBin" }

if (-not (Have node)) { Write-Host "[X] Node not on PATH yet. Close & reopen PowerShell, then re-run." -ForegroundColor Red; return }

# 4. Install the package (npm.cmd, not npm.ps1 — avoids execution-policy issues)
Step "Installing the B-Roll Studio MCP server..."
npm.cmd install -g $Package --no-audit --no-fund

# 5. Register in Claude Code (user scope, idempotent)
Step "Registering 'broll-studio' in Claude Code (user scope)..."
# Note: no `--` — PowerShell strips it before claude sees it. The bin has no
# args, so the command can be a plain positional.
claude mcp remove broll-studio -s user 2>$null
claude mcp add broll-studio broll-studio-mcp -s user -e "BROLL_API_KEY=$ApiKey" -e "BROLL_API_BASE=$ApiBase"

# 6. Verify
Step "Verifying..."
claude mcp list

Write-Host "`n[OK] Done. Open Claude Code in any project and ask it to search b-roll." -ForegroundColor Green
