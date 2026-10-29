<#
================================================================================
 OneGrid SRE demo — inject / reset / status for the three platform scenarios
================================================================================
 Breaks the OneGrid DEV site (pcpro) on purpose so Azure SRE Agent can detect,
 investigate and propose the fix. Every scenario is reversible and resettable.

   01 storage   Public network access on the OneGrid storage account is turned off
                (what the MCAPS StorageAccount_PublicNetwork_Modify policy does).
                Symptom: the site list and Aurora weather go empty (silent failure).
   02 deploy    pcpro is switched to a bad build (branch sre-demo/bad-build).
                Symptom: /api/fleet-health + /api/fleet-assets return HTTP 500.
   03 capacity  The Fabric capacity ogestu is suspended.
                Symptom: dashboards show "capacity paused".
                !! ogestu hosts ~19 workspaces (incl. production OneGrid and customer
                   demos). Pausing it affects all of them until reset.

 Safety: one scenario at a time (tracked by the tag sre-demo-active on the pcpro
 App Service, so it is visible to anyone, including the agent); every reset is safe
 to run repeatedly; `reset-all` restores everything.

 Usage:
   ./sre-demo.ps1                        # status of all scenarios + recent alerts
   ./sre-demo.ps1 inject storage         # break it
   ./sre-demo.ps1 reset storage          # fix it
   ./sre-demo.ps1 reset-all              # fix everything (safe any time)
================================================================================
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][ValidateSet("status", "inject", "reset", "reset-all")][string]$Action = "status",
  [Parameter(Position = 1)][ValidateSet("storage", "deploy", "capacity")][string]$Scenario,
  [switch]$Force   # inject even if another scenario is active
)
$ErrorActionPreference = "Stop"

$Sub         = "87bc8fc7-c4b7-4466-80b8-a7d5004b4f14"
$Rg          = "rg-onegrid-test"
$App         = "pcpro-onegrid-app-ujcb2qv6vi2ts"
$SiteUrl     = "https://$App.azurewebsites.net"
$DataStorage = "pcproujcb2qv6vi2ts"
$PkgBase     = "https://ogsredemocuyvme.blob.core.windows.net/packages"
$GoodPkg     = "$PkgBase/onegrid-good.zip"
$BadPkg      = "$PkgBase/onegrid-bad.zip"
$CapacityId  = "/subscriptions/$Sub/resourceGroups/rgpoc/providers/Microsoft.Fabric/capacities/ogestu"
$AppId       = "/subscriptions/$Sub/resourceGroups/$Rg/providers/Microsoft.Web/sites/$App"
$ActiveTag   = "sre-demo-active"

function Log($m, $c = "Cyan") { Write-Host "[$(Get-Date -f HH:mm:ss)] $m" -ForegroundColor $c }

function Get-Active {
  $tags = az resource show --ids $AppId --query tags -o json | ConvertFrom-Json
  if ($tags -and $tags.$ActiveTag) { return $tags.$ActiveTag } else { return $null }
}
function Set-Active([string]$value) {
  if ($value) { az resource tag --ids $AppId --is-incremental --tags "$ActiveTag=$value" -o none }
  else {
    $tags = az resource show --ids $AppId --query tags -o json | ConvertFrom-Json
    if ($tags -and $tags.$ActiveTag) {
      $kept = @($tags.PSObject.Properties | Where-Object { $_.Name -ne $ActiveTag } | ForEach-Object { "$($_.Name)=$($_.Value)" })
      if ($kept.Count) { az resource tag --ids $AppId --tags @kept -o none } else { az resource tag --ids $AppId --tags "" -o none }
    }
  }
}

function Get-HttpStatus([string]$path) {
  try { return (Invoke-WebRequest -UseBasicParsing "$SiteUrl$path" -TimeoutSec 120).StatusCode }
  catch { if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode } else { return 0 } }
}

function Get-CapacityState {
  (az rest --method get --url "https://management.azure.com$($CapacityId)?api-version=2023-11-01" --query properties.state -o tsv)
}

# ── per-scenario state ────────────────────────────────────────────────────────
function Get-ScenarioState([string]$s) {
  switch ($s) {
    "storage"  { $pna = az storage account show -n $DataStorage -g $Rg --query publicNetworkAccess -o tsv
                 return @{ broken = ($pna -ne "Enabled"); detail = "publicNetworkAccess=$pna" } }
    "deploy"   { $pkg = az webapp config appsettings list -n $App -g $Rg --query "[?name=='WEBSITE_RUN_FROM_PACKAGE'].value | [0]" -o tsv
                 $which = if ($pkg -eq $BadPkg) { "BAD build" } elseif ($pkg -eq $GoodPkg) { "good build" } else { "uploaded package ($pkg)" }
                 return @{ broken = ($pkg -eq $BadPkg); detail = $which } }
    "capacity" { $state = Get-CapacityState
                 return @{ broken = ($state -ne "Active"); detail = "ogestu=$state" } }
  }
}

function Invoke-Inject([string]$s) {
  switch ($s) {
    "storage" {
      Log "Disabling public network access on $DataStorage (mimics the MCAPS policy)..." Yellow
      az storage account update -n $DataStorage -g $Rg --public-network-access Disabled -o none
    }
    "deploy" {
      Log "Deploying the BAD build to $App (run-from-package -> onegrid-bad.zip)..." Yellow
      az webapp config appsettings set -n $App -g $Rg -o none --settings `
        "WEBSITE_RUN_FROM_PACKAGE=$BadPkg" "WEBSITE_RUN_FROM_PACKAGE_BLOB_MI_RESOURCE_ID=SystemAssigned"
      az webapp restart -n $App -g $Rg   # the setting change alone does not always remount the package
    }
    "capacity" {
      Log "Suspending Fabric capacity ogestu (affects every workspace on it)..." Yellow
      az rest --method post --url "https://management.azure.com$CapacityId/suspend?api-version=2023-11-01" -o none
    }
  }
}

function Invoke-Reset([string]$s) {
  switch ($s) {
    "storage" {
      Log "Re-enabling public network access on $DataStorage..."
      az storage account update -n $DataStorage -g $Rg --public-network-access Enabled -o none
    }
    "deploy" {
      Log "Rolling $App back to the known-good build..."
      az webapp config appsettings set -n $App -g $Rg -o none --settings `
        "WEBSITE_RUN_FROM_PACKAGE=$GoodPkg" "WEBSITE_RUN_FROM_PACKAGE_BLOB_MI_RESOURCE_ID=SystemAssigned"
      az webapp restart -n $App -g $Rg
    }
    "capacity" {
      if ((Get-CapacityState) -ne "Active") {
        Log "Resuming Fabric capacity ogestu..."
        az rest --method post --url "https://management.azure.com$CapacityId/resume?api-version=2023-11-01" -o none
      }
    }
  }
}

function Test-Recovered([string]$s) {
  switch ($s) {
    "storage"  { return -not (Get-ScenarioState "storage").broken }
    "deploy"   { return (Get-HttpStatus "/api/fleet-health") -eq 200 -and (Get-HttpStatus "/api/fleet-assets") -eq 200 }
    "capacity" {
      if ((Get-CapacityState) -ne "Active") { return $false }
      try { return -not (Invoke-RestMethod "$SiteUrl/api/status" -TimeoutSec 120).capacityPaused } catch { return $false }
    }
  }
}

function Show-Status {
  $active = Get-Active
  Log ("Active scenario: " + ($(if ($active) { $active } else { "none" })))
  foreach ($s in "storage", "deploy", "capacity") {
    $st = Get-ScenarioState $s
    $mark = if ($st.broken) { "BROKEN " } else { "healthy" }
    Write-Host ("  {0,-9} {1}  {2}" -f $s, $mark, $st.detail) -ForegroundColor $(if ($st.broken) { "Red" } else { "Green" })
  }
  $alerts = az rest --method get --url "https://management.azure.com/subscriptions/$Sub/providers/Microsoft.AlertsManagement/alerts" `
    --uri-parameters "api-version=2019-05-05-preview" "targetResourceGroup=$Rg" "timeRange=1d" `
    --query "value[?starts_with(name, 'sre-demo')].{name:name, state:properties.essentials.monitorCondition, fired:properties.essentials.startDateTime}" -o json | ConvertFrom-Json
  Log "SRE demo alerts (last 24h):"
  if ($alerts) { $alerts | Sort-Object fired -Descending | ForEach-Object { Write-Host ("  {0,-38} {1,-9} {2}" -f $_.name, $_.state, $_.fired) } }
  else { Write-Host "  none" }
}

az account set --subscription $Sub | Out-Null

switch ($Action) {
  "status" { Show-Status }
  "inject" {
    if (-not $Scenario) { throw "Specify a scenario: storage | deploy | capacity" }
    $active = Get-Active
    if ($active -and -not $active.StartsWith("$Scenario@") -and -not $Force) {
      throw "Scenario '$active' is already active. Reset it first (./sre-demo.ps1 reset-all) or pass -Force."
    }
    Set-Active "$Scenario@$((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mmZ'))"
    Invoke-Inject $Scenario
    Log "Injected '$Scenario'. Alerts typically fire within 5 minutes. Reset with: ./sre-demo.ps1 reset $Scenario" Green
  }
  "reset" {
    if (-not $Scenario) { throw "Specify a scenario: storage | deploy | capacity" }
    Invoke-Reset $Scenario
    $ok = $false
    for ($i = 0; $i -lt 30 -and -not $ok; $i++) { Start-Sleep 10; $ok = Test-Recovered $Scenario }
    if ($ok) { Log "'$Scenario' recovered." Green } else { Log "'$Scenario' not verified yet — check ./sre-demo.ps1 status" Yellow }
    $active = Get-Active
    if ($active -and $active.StartsWith("$Scenario@")) { Set-Active "" }
  }
  "reset-all" {
    foreach ($s in "storage", "deploy", "capacity") { Invoke-Reset $s }
    Set-Active ""
    Start-Sleep 20
    Show-Status
  }
}
