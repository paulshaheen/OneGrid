<#
================================================================================
 OneGrid full-solution provisioner — runs INSIDE the ARM deployment
 (Microsoft.Resources/deploymentScripts, kind = AzurePowerShell).
================================================================================
 The Fabric operational plane (workspace/lakehouse/eventhouse/KQL/eventstream/
 notebooks/pipeline/semantic model/report), the AI Foundry account, and the
 chat/web-app Container App are NOT ARM resource types. Instead of re-porting that
 logic, this script stands them up by running OneGrid's own battle-tested
 orchestrator (planetary-computer-pro-poc/infra/deploy.ps1) headless, under the
 deployment's user-assigned managed identity, wired to the PCP backend this template built.

 It:
   1. installs the toolchain the orchestrator needs (git + az CLI) if missing;
   2. logs the az CLI in as the deployment identity (az login --identity);
   3. clones the OneGrid repo (shallow, LFS skipped — data is cloud-seeded);
   4. writes config.json from the ARM params + PCP outputs passed as env vars;
   5. runs ./deploy.ps1 -Only <phases mapped from the selected components>;
   6. returns the resulting workspace / app ids as deployment outputs.

 All inputs arrive as environment variables set by the Bicep deploymentScripts
 resource. This script is intentionally idempotent: deploy.ps1 reuses existing
 items by name, so re-running is safe.

 HONESTY: this path cannot be validated end-to-end without a live Azure + Fabric
 tenant. The first real deployment is the validation pass. Documented prereqs
 (Fabric tenant "service principals can create workspaces" setting, capacity
 admin, Managed Identity Operator on the identity) still apply.
================================================================================
#>
$ErrorActionPreference = 'Stop'
function Log($m, $c = 'Cyan') { Write-Host "[$(Get-Date -f HH:mm:ss)] $m" -ForegroundColor $c }

# Force UTF-8 so the Python-based az CLI can print its success glyphs without dying.
$env:PYTHONUTF8 = '1'; $env:PYTHONIOENCODING = 'utf-8'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

# --- 1. Toolchain: git + az CLI (the AzurePowerShell image has pwsh + Az modules) --
function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

if (-not (Have 'git')) {
  Log 'installing git...'
  & bash -c 'export DEBIAN_FRONTEND=noninteractive; (sudo apt-get update -y && sudo apt-get install -y git) 2>/dev/null || (apt-get update -y && apt-get install -y git)'
}
if (-not (Have 'az')) {
  Log 'installing az CLI...'
  & bash -c 'curl -sL https://aka.ms/InstallAzureCLIDeb | (sudo bash 2>/dev/null || bash)'
}
if (-not (Have 'git')) { throw 'git is required but could not be installed in the deployment container.' }
if (-not (Have 'az'))  { throw 'az CLI is required but could not be installed in the deployment container.' }

# --- 2. Log the az CLI in as the deployment identity ------------------------------
# The script service already ran Connect-AzAccount -Identity for Az PowerShell, but
# deploy.ps1 shells out to the az CLI, which needs its own login.
Log 'az login --identity...'
if ($env:IDENTITY_CLIENT_ID) {
  & az login --identity --username $env:IDENTITY_CLIENT_ID --allow-no-subscriptions --only-show-errors | Out-Null
} else {
  & az login --identity --allow-no-subscriptions --only-show-errors | Out-Null
}
if ($env:SUBSCRIPTION_ID) { & az account set --subscription $env:SUBSCRIPTION_ID --only-show-errors 2>$null | Out-Null }

# Register the Fabric resource provider. A subscription with a zero Fabric regional
# quota (BadRequest: RegionalQuota 0) is usually one where Microsoft.Fabric was never
# registered — registering it grants the default capacity-unit quota. Idempotent + fast
# when already registered. Best-effort: never fail the run just for this.
try {
  $fabricState = (& az provider show --namespace Microsoft.Fabric --query registrationState -o tsv 2>$null)
  if ($fabricState -ne 'Registered') {
    Log "registering Microsoft.Fabric resource provider (current: $fabricState)..."
    & az provider register --namespace Microsoft.Fabric --only-show-errors 2>$null | Out-Null
  } else { Log 'Microsoft.Fabric resource provider already registered' }
} catch { Log "Microsoft.Fabric provider registration skipped: $($_.Exception.Message)" 'Yellow' }


# --- 3. Clone the OneGrid orchestrator + accelerator content ----------------------
$repo = if ($env:ONEGRID_REPO) { $env:ONEGRID_REPO } else { 'https://github.com/paulshaheen/OneGrid.git' }
$ref  = if ($env:ONEGRID_REF)  { $env:ONEGRID_REF }  else { 'main' }
$work = Join-Path ([IO.Path]::GetTempPath()) 'onegrid'
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
Log "cloning $repo ($ref)..."
$env:GIT_LFS_SKIP_SMUDGE = '1'   # data is cloud-seeded from the release bundle, not LFS
& git clone --depth 1 --branch $ref $repo $work

# Locate the orchestrator. The OneGrid monorepo keeps it at
# planetary-computer-pro-poc/infra/deploy.ps1; a flat/standalone repo keeps it at root.
$deployScript = @(
  (Join-Path $work 'planetary-computer-pro-poc/infra/deploy.ps1'),
  (Join-Path $work 'deploy.ps1')
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $deployScript) { throw "clone did not produce deploy.ps1 (looked for planetary-computer-pro-poc/infra/deploy.ps1 and ./deploy.ps1) under $work" }
$deployDir = Split-Path -Parent $deployScript
Log "orchestrator: $deployScript"

# --- 4. Compose config.json from ARM params + PCP outputs -------------------------
$rg = $env:TARGET_RESOURCE_GROUP
$reuseFoundry = [bool]$env:PCP_OPENAI_ENDPOINT   # if PCP already deployed Azure OpenAI, reuse it
$cfg = [ordered]@{
  subscriptionId = $env:SUBSCRIPTION_ID
  location       = $env:LOCATION
  fabric = [ordered]@{
    capacityId      = $env:FABRIC_CAPACITY_ID
    workspaceName   = $(if ($env:FABRIC_WORKSPACE) { $env:FABRIC_WORKSPACE } else { 'OneGrid' })
    lakehouseName   = 'lh_poc'
    eventhouseName  = 'pi-realtime-eventhouse'
    kqlDatabaseName = 'pi-realtime-db'
    factWindowDays  = 30
    siteCount       = 8
  }
  data       = [ordered]@{ bundleUrl = 'https://github.com/paulshaheen/OneGrid/releases/latest/download/onegrid-data.zip' }
  telemetry  = [ordered]@{ enabled = $false }
  reuseExistingFoundry = $reuseFoundry
  pcp = [ordered]@{
    storageAccountName    = $env:PCP_STORAGE_ACCOUNT_NAME
    storageAccountId      = $env:PCP_STORAGE_ACCOUNT_ID
    blobEndpoint          = $env:PCP_BLOB_ENDPOINT
    dfsEndpoint           = $env:PCP_DFS_ENDPOINT
    modelOutputsContainer = $(if ($env:PCP_MODEL_CONTAINER) { $env:PCP_MODEL_CONTAINER } else { 'model-outputs' })
    sampleContainer       = $env:PCP_SAMPLE_CONTAINER
    auroraEndpoint        = $env:PCP_AURORA_ENDPOINT
    auroraDeployed        = $env:PCP_AURORA_DEPLOYED
    shortcutName          = 'pcp_model_outputs'
    connectionId          = $env:FABRIC_CONNECTION_ID
    createConnection      = ($env:PCP_CREATE_CONNECTION -eq 'true')
    openAiEndpoint        = $env:PCP_OPENAI_ENDPOINT
    openAiAccountId       = $env:PCP_OPENAI_ACCOUNT_ID
    geoCatalogUri         = $env:PCP_GEOCATALOG_URI
    geoCatalogId          = $env:PCP_GEOCATALOG_ID
  }
  foundry = [ordered]@{
    resourceGroup = $rg
    accountName   = "$($env:NAME_PREFIX)-foundry"
    defaultModel  = 'gpt-4o'
    models        = @(
      [ordered]@{ deployment = 'gpt-4o'; model = 'gpt-4o'; version = '2024-11-20'; format = 'OpenAI'; capacity = 100 }
    )
  }
  chatAgent = [ordered]@{
    resourceGroup   = $rg
    appName         = if ($env:CHAT_AGENT_APP_NAME) { $env:CHAT_AGENT_APP_NAME } else { "$($env:NAME_PREFIX)-onegrid-app" }
    environmentName = "$($env:NAME_PREFIX)-onegrid-app-env"
  }
  governance = [ordered]@{ enabled = $false }
}
$cfgPath = Join-Path $deployDir 'config.json'
[IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json -Depth 12), (New-Object System.Text.UTF8Encoding($false)))
Log "config.json written (reuseExistingFoundry=$reuseFoundry, workspace=$($cfg.fabric.workspaceName))"

# --- 5. Run the orchestrator for the selected phases ------------------------------
$phases = ($env:ONEGRID_PHASES -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
Log "running deploy.ps1 -Only $($phases -join ',')"
Push-Location $deployDir
try {
  if ($phases.Count -gt 0) {
    & pwsh -NoProfile -File $deployScript -ConfigPath $cfgPath -Only $phases
  } else {
    & pwsh -NoProfile -File $deployScript -ConfigPath $cfgPath
  }
  $deployExit = $LASTEXITCODE
} finally { Pop-Location }
Log "deploy.ps1 exit=$deployExit"

# --- 6. Surface the resulting ids as deployment outputs ---------------------------
$state = @{}
$statePath = Join-Path $deployDir 'last-deploy-state.json'
if (Test-Path $statePath) {
  try { $state = Get-Content $statePath -Raw | ConvertFrom-Json } catch {}
}
$DeploymentScriptOutputs = @{
  phases      = ($phases -join ',')
  deployExit  = $deployExit
  workspaceId = $state.WorkspaceId
  lakehouseId = $state.LakehouseId
  kqlDatabase = $state.KqlDbId
  kustoUri    = $state.KustoUri
  appUrl      = $state.AppUrl
  foundryEndpoint = $state.FoundryEndpoint
}

# deploy.ps1 records non-fatal phase issues but exits non-zero if any occurred.
# Surface that as a script failure so the deployment reflects it, but only after
# outputs are set so the partial state is still visible.
if ($deployExit -and $deployExit -ne 0) {
  throw "deploy.ps1 finished with issues (exit $deployExit). See container logs for the per-phase summary."
}
