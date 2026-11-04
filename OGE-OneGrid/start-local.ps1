<#
  start-local.ps1 — launch the OneGrid app locally (report-app, which also spawns
  the webapp SSR on :7702 and the chat agent on :7701, all served under :7700).

  Wires the same AI (Foundry) config the deployed site uses, so the in-app chat
  works locally via your `az login` session (the server falls back to the Azure
  CLI for a Cognitive Services token when it is not running on Azure).

  Usage:
    ./start-local.ps1            # start (assumes webapp is already built)
    ./start-local.ps1 -Build     # rebuild the webapp first, then start
    ./start-local.ps1 -NoChat    # start without the Foundry AI env (BYO GitHub Copilot only)
    ./start-local.ps1 -SreDemo   # also enable the SRE demo page, wired to the dev site's
                                 # Eventhouse, App Insights and alerts (read from pcpro at launch)
#>
[CmdletBinding()]
param(
  [switch]$Build,
  [switch]$NoChat,
  [switch]$SreDemo
)

$ErrorActionPreference = "Stop"
$root      = $PSScriptRoot
$webapp    = Join-Path $root "webapp"
$reportApp = Join-Path $root "report-app"

# ── core service env ────────────────────────────────────────────────────────
$env:REPORT_API_ENABLED = "1"
$env:REPORT_API_URL     = "http://127.0.0.1:7700"
$env:REPORT_PORT        = "7700"
$env:WEBAPP_PORT        = "7702"
$env:CHAT_AGENT_PORT    = "7701"
$env:GEOCATALOG_URI     = "https://placeholder.local/geocatalog"

# ── AI (Foundry) chat config — same resource as the deployed app ────────────
# The server uses your `az login` token locally (Cognitive Services OpenAI User).
if (-not $NoChat) {
  $env:AI_PROVIDER        = "foundry"
  $env:FOUNDRY_ENDPOINT   = "https://pcpro-oai-ujcb2qv6vi2ts.openai.azure.com"
  $env:FOUNDRY_DEPLOYMENT = "gpt-5-mini"
  $env:AZURE_AI_ENDPOINT  = "https://pcpro-oai-ujcb2qv6vi2ts.openai.azure.com"
  $env:AI_DEFAULT_MODEL   = "gpt-5-mini"
  # gpt-5-mini is a reasoning model — cap the reasoning budget so agent turns are snappy.
  $env:AI_REASONING_EFFORT = "minimal"

  # Fabric data targets for the agent's tools (DAX semantic model + Eventhouse KQL),
  # same as the deployed app so "chat with your data" works locally via your az token.
  # Locally we use the Direct Lake model (richer schema); your delegated az token can
  # executeQueries against it (only the deployed managed identity can't — prod uses the
  # Import model 1584f00a for that reason).
  $env:PBI_WORKSPACE  = "53a714a5-269b-4bd5-8338-5007436a1511"
  $env:PBI_DATASET    = "2e91e425-6997-4e5b-ae2b-44e7f3618bca"   # OneGridModel (Direct Lake)
  $env:KUSTO_CLUSTER  = "https://trd-rw9y7tqvw4h1a9v6n1.z5.kusto.fabric.microsoft.com"
  $env:KUSTO_DATABASE = "OneGridEH"
  $env:DATA_AGENT_WORKSPACE = "a9fefbc4-1e6f-4473-977c-87e776eecf74"

  # Warn (don't fail) if the Azure CLI is not logged in — chat will just say
  # "could not acquire a token" until you `az login`.
  try {
    $acct = az account show --query user.name -o tsv 2>$null
    if ($acct) { Write-Host "az: signed in as $acct" -ForegroundColor DarkGray }
    else { Write-Host "az: NOT logged in — run 'az login' for the chat to work" -ForegroundColor Yellow }
  } catch {
    Write-Host "az: CLI not found on PATH — chat needs 'az login' or a GitHub Copilot token" -ForegroundColor Yellow
  }
}

# ── SRE demo: share the dev site's Eventhouse, App Insights and alert config ─
# Scenario 05 needs localhost and pcpro on the same data: the alert reads pcpro's App
# Insights, and the SRE Agent investigates (and creates the work order) through pcpro's
# MCP server, which reads pcpro's Eventhouse. Settings are read at launch, never stored.
if ($SreDemo) {
  $sreApp = "pcpro-onegrid-app-ujcb2qv6vi2ts"; $sreRg = "rg-onegrid-test"
  $wanted = @("SRE_DEMO_ENABLED", "SRE_DEMO_KEY", "SRE_DEMO_SUBSCRIPTION", "SRE_DEMO_RESOURCE_GROUP", "SRE_DEMO_APP",
    "SRE_DEMO_DATA_STORAGE", "SRE_DEMO_GOOD_PACKAGE", "SRE_DEMO_BAD_PACKAGE", "SRE_DEMO_CAPACITY_ID", "SRE_DEMO_AGENT_URL",
    "APPLICATIONINSIGHTS_CONNECTION_STRING", "KUSTO_CLUSTER", "KUSTO_DATABASE", "PBI_WORKSPACE", "PBI_DATASET")
  $settings = az webapp config appsettings list -g $sreRg -n $sreApp -o json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or -not $settings) { throw "Could not read $sreApp app settings (az login with access to $sreRg is required)." }
  foreach ($s in $settings) { if ($wanted -contains $s.name -and $s.value) { Set-Item -Path "env:$($s.name)" -Value $s.value } }
  $missing = $wanted | Where-Object { -not (Test-Path "env:$_") }
  if ($missing) { throw "pcpro is missing SRE demo settings: $($missing -join ', ')" }
  # Lets the SRE page link straight to the agent's investigation thread, and page the agent.
  $agentSetting = $settings | Where-Object name -eq "SRE_DEMO_AGENT_ID" | Select-Object -First 1
  $env:SRE_DEMO_AGENT_ID = if ($agentSetting.value) { $agentSetting.value } else {
    "/subscriptions/$env:SRE_DEMO_SUBSCRIPTION/resourceGroups/rg-onegrid-sre/providers/Microsoft.App/agents/onegrid-sre-agent" }
  $triggerSetting = $settings | Where-Object name -eq "SRE_DEMO_AGENT_TRIGGER_URL" | Select-Object -First 1
  if ($triggerSetting.value) { $env:SRE_DEMO_AGENT_TRIGGER_URL = $triggerSetting.value }
  $sensorTrigger = $settings | Where-Object name -eq "SRE_DEMO_SENSOR_TRIGGER_URL" | Select-Object -First 1
  if ($sensorTrigger.value) { $env:SRE_DEMO_SENSOR_TRIGGER_URL = $sensorTrigger.value }
  Write-Host "SRE demo: wired to $sreApp (Eventhouse $env:KUSTO_CLUSTER)" -ForegroundColor DarkGray
}

# ── optional rebuild ────────────────────────────────────────────────────────
if ($Build) {
  Write-Host "Building webapp…" -ForegroundColor Cyan
  Push-Location $webapp
  try {
    $env:APP_BASE_PATH = "/webapp"
    & node node_modules/vite/bin/vite.js build
    if ($LASTEXITCODE -ne 0) { throw "webapp build failed (exit $LASTEXITCODE)" }
  } finally { Pop-Location }
}

# ── free the ports ──────────────────────────────────────────────────────────
foreach ($p in 7700, 7701, 7702) {
  $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
  if ($conns) {
    $conns | Select-Object -Expand OwningProcess -Unique | ForEach-Object {
      try { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } catch {}
    }
  }
}
Start-Sleep -Seconds 1

# ── launch report-app (spawns webapp + chat agent as children) ──────────────
Write-Host "Starting report-app on :7700…" -ForegroundColor Cyan
$proc = Start-Process node -ArgumentList "server/index.js" -WorkingDirectory $reportApp -PassThru
Write-Host "report-app PID $($proc.Id)" -ForegroundColor DarkGray

# ── wait for readiness ──────────────────────────────────────────────────────
$ready = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 2
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:7700/api/status" -UseBasicParsing -TimeoutSec 4
    if ($r.StatusCode -eq 200) { $ready = $true; break }
  } catch { }
}

if ($ready) {
  Write-Host ""
  Write-Host "OneGrid is up:" -ForegroundColor Green
  Write-Host "  App (Command Center):  http://localhost:7700/webapp/app"
  Write-Host "  Asset Explorer:        http://localhost:7700/webapp/app/asset-explorer"
  Write-Host "  Control Room:          http://localhost:7700/webapp/app/control-room"
  Write-Host "  Report app:            http://localhost:7700/"
  if ($SreDemo) { Write-Host "  SRE demo:              http://localhost:7700/webapp/app/sre" }
} else {
  Write-Host "report-app did not report ready on :7700 within ~80s. Check the process output." -ForegroundColor Red
  exit 1
}
