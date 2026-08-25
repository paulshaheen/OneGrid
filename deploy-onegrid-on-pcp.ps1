<#
================================================================================
 OneGrid on Planetary Computer Pro — one deploy, one config, one tracker
================================================================================
 Ties the two halves of the solution together:

   1. Planetary Computer Pro (PCP) is THE backend. Its RG-scoped Bicep
      (planetary-computer-pro-poc/deploy/azure/main.bicep) provisions the
      GeoCatalog, sample storage (+ model-outputs), Azure OpenAI, optional Aurora,
      and the web app — unchanged. With -DeployPcp this wrapper runs it with the
      OneGrid Fabric-plane seam enabled (deployFabricPlane=true).

   2. OneGrid is purely additive. This wrapper reads PCP's deployment OUTPUTS
      (fabricPlaneConfig) and threads them into OneGrid's config.json, then runs
      OneGrid's deploy.ps1 to provision the Fabric plane: the OneLake shortcut to
      PCP's model-outputs container, the geo_point_in_polygon hazard join +
      composite-risk tables, and the chat agent pointed at PCP's Azure OpenAI.

 Fabric is not ARM-provisionable, so the Fabric work necessarily runs here (Fabric
 REST via deploy.ps1) rather than in the Bicep template. GeoCatalog stays the
 authoritative STAC/imagery source; OneLake holds only the analytical hazard copy.

 Prereqs: az CLI logged in (az login), an EXISTING Microsoft Fabric capacity
 (F-SKU/Trial), and — for the OneLake shortcut — a Fabric cloud connection to PCP's
 storage account (pass its GUID via -ConnectionId).

 Examples:
   # Deploy PCP (with the seam) AND the OneGrid Fabric plane in one go:
   ./deploy-onegrid-on-pcp.ps1 -ResourceGroup rg-pcp -DeployPcp `
       -Location westeurope -FabricCapacityId <capacityGuid> -ConnectionId <connGuid>

   # PCP already deployed — just complete the Fabric plane from its outputs:
   ./deploy-onegrid-on-pcp.ps1 -ResourceGroup rg-pcp -DeploymentName pcp-main `
       -ConnectionId <connGuid>
================================================================================
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $ResourceGroup,
  # Name of the PCP ARM deployment to read outputs from. Defaults to 'main' or the
  # deployment created by -DeployPcp.
  [string] $DeploymentName = 'main',
  # Run the PCP Bicep first (with deployFabricPlane=true) before wiring OneGrid.
  [switch] $DeployPcp,
  [string] $Location = 'westeurope',
  # Existing Fabric capacity (resource id or GUID). Required with -DeployPcp; otherwise
  # taken from PCP outputs when present.
  [string] $FabricCapacityId,
  # GUID of a Fabric cloud connection to PCP's storage account (for the OneLake shortcut).
  [string] $ConnectionId,
  # Restrict the OneGrid run to specific phases (default: the full accelerator).
  [string[]] $Only,
  [string] $PcpDir     = "$PSScriptRoot/planetary-computer-pro-poc/deploy/azure",
  [string] $OneGridDir = "$PSScriptRoot/OGE-OneGrid",
  # The OneGrid orchestrator (deploy.ps1) + its config.sample.json now live under
  # planetary-computer-pro-poc/infra after the infra/app split. The app source
  # (report-app + webapp + chatagent) is auto-detected by deploy.ps1 at ../../OGE-OneGrid.
  [string] $InfraDir   = "$PSScriptRoot/planetary-computer-pro-poc/infra",
  [string] $ConfigPath = "$PSScriptRoot/planetary-computer-pro-poc/infra/config.json"
)
$ErrorActionPreference = 'Stop'
function Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }

az account show 1>$null 2>$null; if ($LASTEXITCODE -ne 0) { throw "Run 'az login' first." }

# ---------------------------------------------------------------------------------
# 1) Optionally deploy the PCP backend with the Fabric-plane seam enabled.
# ---------------------------------------------------------------------------------
if ($DeployPcp) {
  if (-not $FabricCapacityId) { throw "-FabricCapacityId is required with -DeployPcp (a Fabric workspace can't be created without a capacity)." }
  Step "Deploying Planetary Computer Pro backend (deployFabricPlane=true)"
  az group create -n $ResourceGroup -l $Location -o none
  $DeploymentName = "pcp-onegrid-$(Get-Date -f yyyyMMddHHmmss)"
  az deployment group create -g $ResourceGroup -n $DeploymentName `
    --template-file (Join-Path $PcpDir 'main.bicep') `
    --parameters location=$Location deployFabricPlane=true fabricCapacityId=$FabricCapacityId `
    -o none
  if ($LASTEXITCODE -ne 0) { throw "PCP deployment failed." }
  Write-Host "  PCP deployment '$DeploymentName' complete." -ForegroundColor Green
}

# ---------------------------------------------------------------------------------
# 2) Read PCP outputs and derive the OneGrid config (the fabricPlaneConfig fragment).
# ---------------------------------------------------------------------------------
Step "Reading PCP deployment outputs ($DeploymentName)"
$outputsJson = az deployment group show -g $ResourceGroup -n $DeploymentName --query properties.outputs -o json
if ($LASTEXITCODE -ne 0 -or -not $outputsJson) { throw "Could not read outputs from deployment '$DeploymentName' in '$ResourceGroup'." }
$outputs = $outputsJson | ConvertFrom-Json

if (-not $outputs.fabricPlaneConfig -or -not $outputs.fabricPlaneConfig.value) {
  throw "Deployment '$DeploymentName' has no fabricPlaneConfig output. Re-deploy PCP with deployFabricPlane=true (and deploySampleStorage=true)."
}
$fpc = $outputs.fabricPlaneConfig.value
if ($FabricCapacityId) { $fpc.fabric.capacityId = $FabricCapacityId }
if (-not $fpc.fabric.capacityId) { throw "No Fabric capacity id available. Pass -FabricCapacityId." }
if ($ConnectionId) { $fpc.pcp.connectionId = $ConnectionId }

Write-Host "  Foundry endpoint : $($fpc.pcp.openAiEndpoint)" -ForegroundColor Gray
Write-Host "  Storage account  : $($fpc.pcp.storageAccountName) (container '$($fpc.pcp.modelOutputsContainer)')" -ForegroundColor Gray
Write-Host "  GeoCatalog URI   : $($fpc.pcp.geoCatalogUri)" -ForegroundColor Gray
if (-not $fpc.pcp.connectionId) {
  Write-Host "  NOTE: no Fabric cloud connection supplied (-ConnectionId). The KQL join still" -ForegroundColor Yellow
  Write-Host "        deploys, but the OneLake shortcut to model-outputs will be skipped until" -ForegroundColor Yellow
  Write-Host "        you set pcp.connectionId. Create one in Fabric > Manage connections." -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------------
# 3) Merge into OneGrid config.json (start from existing config.json or the sample).
# ---------------------------------------------------------------------------------
Step "Writing OneGrid config ($ConfigPath)"
$seed = if (Test-Path $ConfigPath) { $ConfigPath } else { Join-Path $InfraDir 'config.sample.json' }
$cfg = Get-Content $seed -Raw | ConvertFrom-Json

$cfg.location = $Location
if (-not $cfg.fabric) { $cfg | Add-Member -NotePropertyName fabric -NotePropertyValue ([pscustomobject]@{}) -Force }
$cfg.fabric.capacityId = $fpc.fabric.capacityId
if ($fpc.fabric.workspaceName) { $cfg.fabric.workspaceName = $fpc.fabric.workspaceName }
$cfg | Add-Member -NotePropertyName reuseExistingFoundry -NotePropertyValue $fpc.reuseExistingFoundry -Force
$cfg | Add-Member -NotePropertyName pcp -NotePropertyValue $fpc.pcp -Force

[IO.File]::WriteAllText($ConfigPath, ($cfg | ConvertTo-Json -Depth 20), (New-Object System.Text.UTF8Encoding($false)))
Write-Host "  config written." -ForegroundColor Green

# ---------------------------------------------------------------------------------
# 4) Run the OneGrid Fabric-plane deploy (Fabric REST). Single progress trail.
# ---------------------------------------------------------------------------------
Step "Provisioning OneGrid Fabric plane"
$deploy = Join-Path $InfraDir 'deploy.ps1'
$deployArgs = @{ ConfigPath = $ConfigPath }
if ($Only) { $deployArgs.Only = $Only }
& $deploy @deployArgs

Step "Done"
Write-Host "PCP backend + OneGrid Fabric plane deployed. GeoCatalog remains the authoritative" -ForegroundColor Green
Write-Host "imagery/STAC source; OneLake holds the analytical hazard copy for the geo join." -ForegroundColor Green
