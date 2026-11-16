<#
  AgentCraft x OneGrid demo, all on localhost (spec: docs/agentcraft-onegrid-demo-spec.md).

  Starts three things:
    1. OneGrid on :7700 (start-local.ps1 -SreDemo), with the MCP server enabled.
    2. The onegrid-asset agent on :8089 (AgentCraft's foundry_ops host, model in foundryOGE/proj-default).
    3. The AgentCraft showcase on :4181 (Asset Health at /?view=assets) with the Live: OneGrid source on.

  .\agentcraft-demo.ps1                 # start everything (reuses OneGrid if it is already up)
  .\agentcraft-demo.ps1 -Reset          # only clear Riverside agent proposals (between rehearsals)
  .\agentcraft-demo.ps1 -Stop           # stop the agent and the showcase (OneGrid keeps running)

  Needs: az login (MngEnvMCAP920491), Git for Windows (bash), uv, Node, and the AgentCraft clone with dependencies
  installed (npm ci, uv sync --project libraries --python 3.12, workspace libraries built).
  The MCP key is read from pcpro's app settings at launch and only held in process environment variables.
#>
param(
  [string]$AgentCraft = (Join-Path $env:TEMP 'agentcraft'),
  [string]$FoundryEndpoint = 'https://foundryoge.services.ai.azure.com/api/projects/proj-default',
  [switch]$Reset,
  [switch]$Stop
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$app = 'pcpro-onegrid-app-ujcb2qv6vi2ts'; $rg = 'rg-onegrid-test'

function Free-Port([int]$port) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}
function Setting([string]$name) { az webapp config appsettings list -g $rg -n $app --query "[?name=='$name'].value | [0]" -o tsv }

if ($Stop) { 8089, 8790, 4181 | ForEach-Object { Free-Port $_ }; Write-Host 'Stopped the agent and the showcase.'; return }

$env:KUSTO_CLUSTER = Setting 'KUSTO_CLUSTER'; $env:KUSTO_DATABASE = Setting 'KUSTO_DATABASE'
python (Join-Path $here 'data\riverside\load_riverside.py') --reset-proposals
if ($Reset) { return }

if (-not (Test-Path (Join-Path $AgentCraft 'agentcraft-showcase-app\agent\crafted\onegrid-asset\configuration.yaml'))) {
  throw "AgentCraft clone with the onegrid-live branch not found at $AgentCraft (pass -AgentCraft <path>)."
}
$key = Setting 'SRE_MCP_KEY'
if (-not $key) { throw "Could not read SRE_MCP_KEY from $app (az login to MngEnvMCAP920491)." }

# 1. OneGrid
if (-not (Get-NetTCPConnection -LocalPort 7700 -State Listen -ErrorAction SilentlyContinue)) {
  Write-Host 'Starting OneGrid on :7700...' -ForegroundColor Cyan
  $env:SRE_MCP_KEY = $key
  & (Join-Path $here 'start-local.ps1') -SreDemo | Out-Null
} else { Write-Host 'OneGrid already running on :7700 (restart it with SRE_MCP_KEY set if MCP answers 404).' -ForegroundColor DarkGray }

# 2. Agent on :8089
Free-Port 8089
Write-Host 'Starting the onegrid-asset agent on :8089...' -ForegroundColor Cyan
$agentCmd = "`$env:ONEGRID_MCP_KEY='$key'; `$env:PYTHONUTF8='1'; Set-Location '$AgentCraft'; " +
  "uv run --locked --project libraries python -B -m foundry_ops.agents serve agentcraft-showcase-app/agent/crafted/onegrid-asset " +
  "--credential cli --endpoint $FoundryEndpoint --port 8089 *> `"$env:TEMP\onegrid-agent.log`""
Start-Process pwsh -ArgumentList '-NoProfile', '-Command', $agentCmd -WindowStyle Hidden

# 3. Showcase on :4181
8790, 4181 | ForEach-Object { Free-Port $_ }
Write-Host 'Starting the AgentCraft showcase on :4181...' -ForegroundColor Cyan
$bash = 'C:\Program Files\Git\bin\bash.exe'
$showcase = (Join-Path $AgentCraft 'agentcraft-showcase-app') -replace '\\', '/'
$bashCmd = "export PYTHONUTF8=1 PYTHONIOENCODING=utf-8 npm_config_script_shell='C:/Program Files/Git/bin/bash.exe' " +
  "SHOWCASE_ONEGRID_LOCAL_URL=http://127.0.0.1:8089; cd '$showcase' && ./serve.sh --no-live > /tmp/ac-serve.log 2>&1"
Start-Process $bash -ArgumentList '-lc', "`"$bashCmd`"" -WindowStyle Hidden

$deadline = (Get-Date).AddMinutes(5)
do { Start-Sleep 5; $ok = (Test-NetConnection 127.0.0.1 -Port 4181 -InformationLevel Quiet -WarningAction SilentlyContinue) -and
       (Test-NetConnection 127.0.0.1 -Port 8089 -InformationLevel Quiet -WarningAction SilentlyContinue) } while (-not $ok -and (Get-Date) -lt $deadline)
if (-not $ok) { throw "Agent or showcase did not come up; see $env:TEMP\onegrid-agent.log and /tmp/ac-serve.log (Git Bash)." }
Write-Host ''
Write-Host 'Ready:' -ForegroundColor Green
Write-Host '  AgentCraft Asset Health:  http://127.0.0.1:4181/?view=assets   (toggle Live: OneGrid)'
Write-Host '  OneGrid approvals:        http://localhost:7700/webapp/app/sre (Agent proposals panel)'
