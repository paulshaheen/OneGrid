<#
  OneGrid Fabric plane — runs INSIDE the ARM deployment (Microsoft.Resources/deploymentScripts).

  Fabric workspaces, lakehouses, eventhouses, OneLake shortcuts and KQL are NOT ARM resource
  types, so they cannot be expressed as Bicep resources. This script is the in-template
  equivalent: it executes during the deployment (as the Fabric-plane user-assigned identity)
  and provisions the plane over the Fabric REST + Kusto management APIs — the same calls the
  standalone OneGrid deploy.ps1 makes, reduced to the additive PCP seam:

    * Fabric workspace (created on the supplied capacity)
    * Lakehouse (schema-enabled) + Eventhouse + KQL database
    * OneLake shortcut to PCP's model-outputs blob container (when a connection id is supplied)
    * The hazard-geometry table + geo_point_in_polygon join + composite-risk functions (KQL)

  All inputs arrive as environment variables set by the Bicep deploymentScripts resource.
  Outputs are surfaced back to the ARM deployment via $DeploymentScriptOutputs.
#>
$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

function Log($m, $c = 'White') { Write-Host $m -ForegroundColor $c }

# --- Auth: the deploymentScripts container runs as the assigned user identity ----------
# The script service calls Connect-AzAccount -Identity before this runs, so Az cmdlets pick
# up the Fabric-plane identity automatically. Az.Accounts 5.x (Az 14+) returns the token as a
# SecureString; earlier versions return a plain string. Normalize both so the pinned
# azPowerShellVersion can move without breaking auth.
function Get-PlainToken($resourceUrl) {
  $t = (Get-AzAccessToken -ResourceUrl $resourceUrl -AsSecureString -ErrorAction SilentlyContinue).Token
  if (-not $t) { $t = (Get-AzAccessToken -ResourceUrl $resourceUrl).Token }
  if ($t -is [System.Security.SecureString]) {
    return [System.Net.NetworkCredential]::new('', $t).Password
  }
  return $t
}

$fabricBase = 'https://api.fabric.microsoft.com/v1'
$fabricToken = Get-PlainToken 'https://api.fabric.microsoft.com'
$H = @{ Authorization = "Bearer $fabricToken"; 'Content-Type' = 'application/json' }

function FGet($path) { Invoke-RestMethod -Uri "$fabricBase/$path" -Headers $H }

# Fabric item creates are often long-running (202 + Operation-Location). Post, then poll the
# operation to completion and return the resulting resource.
function FPost($path, $body) {
  $json = ($body | ConvertTo-Json -Depth 25)
  $resp = Invoke-WebRequest -Uri "$fabricBase/$path" -Method Post -Headers $H `
            -Body ([Text.Encoding]::UTF8.GetBytes($json)) -UseBasicParsing
  if ($resp.StatusCode -eq 202) {
    $op = $resp.Headers['Operation-Location']; if (-not $op) { $op = $resp.Headers['Location'] }
    for ($i = 0; $i -lt 60 -and $op; $i++) {
      Start-Sleep -Seconds 5
      $st = Invoke-RestMethod -Uri $op -Headers $H
      if ($st.status -in @('Succeeded', 'Completed')) {
        try { return Invoke-RestMethod -Uri "$op/result" -Headers $H } catch { return $st }
      }
      if ($st.status -in @('Failed', 'Cancelled', 'Deduped')) { throw "Fabric op $($st.status): $($st.error.message)" }
    }
  }
  if ($resp.Content) { return ($resp.Content | ConvertFrom-Json) }
  return $null
}

# --- Workspace (reuse by name, else create) + capacity assignment ----------------------
# Per the Fabric Create Workspace REST API, capacityId can be supplied directly in the
# create body (https://learn.microsoft.com/rest/api/fabric/core/workspaces/create-workspace);
# we also keep an explicit assignToCapacity call to cover the reuse-existing-workspace path.
$wsName = $env:FABRIC_WORKSPACE
Log "workspace: $wsName" Cyan
# Accept a full capacity resource id or a bare GUID (the API wants the GUID).
$capGuid = ''
if ($env:FABRIC_CAPACITY_ID) {
  $capGuid = if ($env:FABRIC_CAPACITY_ID -match '/capacities/') { ($env:FABRIC_CAPACITY_ID -split '/')[-1] } else { $env:FABRIC_CAPACITY_ID }
}
$ws = (FGet 'workspaces').value | Where-Object { $_.displayName -eq $wsName } | Select-Object -First 1
if (-not $ws) {
  $createBody = @{ displayName = $wsName }
  if ($capGuid) { $createBody.capacityId = $capGuid }
  $ws = FPost 'workspaces' $createBody
}
$wsId = $ws.id
if ($capGuid) {
  try { FPost "workspaces/$wsId/assignToCapacity" @{ capacityId = $capGuid } | Out-Null; Log "  capacity assigned" Green }
  catch { Log "  capacity assign warning: $($_.Exception.Message)" Yellow }
}
Log "  workspaceId=$wsId" Green

# --- Lakehouse (schema-enabled) --------------------------------------------------------
$lhName = $env:LAKEHOUSE_NAME
$lh = (FGet "workspaces/$wsId/lakehouses").value | Where-Object { $_.displayName -eq $lhName } | Select-Object -First 1
if (-not $lh) { $lh = FPost "workspaces/$wsId/lakehouses" @{ displayName = $lhName; creationPayload = @{ enableSchemas = $true } } }
$lhId = $lh.id
Log "  lakehouseId=$lhId" Green

# --- Eventhouse + KQL database ---------------------------------------------------------
$ehName = $env:EVENTHOUSE_NAME
$eh = (FGet "workspaces/$wsId/eventhouses").value | Where-Object { $_.displayName -eq $ehName } | Select-Object -First 1
if (-not $eh) { $eh = FPost "workspaces/$wsId/eventhouses" @{ displayName = $ehName } }
$ehId = $eh.id
$kdbName = $env:KQLDB_NAME
$kdb = (FGet "workspaces/$wsId/kqlDatabases").value | Where-Object { $_.displayName -eq $kdbName } | Select-Object -First 1
if (-not $kdb) {
  $kdb = FPost "workspaces/$wsId/kqlDatabases" @{ displayName = $kdbName; creationPayload = @{ databaseType = 'ReadWrite'; parentEventhouseItemId = $ehId } }
}
$ehFull = FGet "workspaces/$wsId/eventhouses/$ehId"
$kustoUri = $ehFull.properties.queryServiceUri
Log "  eventhouseId=$ehId kqlDb=$($kdb.id) kusto=$kustoUri" Green

# --- OneLake shortcut to PCP's model-outputs container ---------------------------------
$shortcutMsg = 'skipped (no connection id)'
if ($env:CONNECTION_ID) {
  try {
    $body = @{
      path   = 'Files'
      name   = $env:SHORTCUT_NAME
      target = @{ type = 'AzureBlobStorage'; azureBlobStorage = @{
          location     = $env:BLOB_ENDPOINT
          subpath      = "/$($env:MODEL_CONTAINER)"
          connectionId = $env:CONNECTION_ID } }
    }
    FPost "workspaces/$wsId/items/$lhId/shortcuts" $body | Out-Null
    $shortcutMsg = "created: $($env:SHORTCUT_NAME) -> $($env:MODEL_CONTAINER)"
    Log "  shortcut $shortcutMsg" Green
  } catch {
    $shortcutMsg = "error: $($_.Exception.Message)"
    Log "  shortcut $shortcutMsg" Yellow
  }
} else {
  Log "  shortcut $shortcutMsg" Yellow
}

# --- Apply the hazard-geometry / geo_point_in_polygon KQL ------------------------------
$kqlMsg = 'not-provided'
if ($env:HAZARD_KQL) {
  $kustoToken = Get-PlainToken $kustoUri
  $mgmt = "$kustoUri/v1/rest/mgmt"
  # PS 5.1/7 ConvertTo-Json emits raw non-ASCII which Kusto's strict JSON reader rejects;
  # fold any stray non-ASCII so a smart quote can't corrupt the request body.
  $kql = [regex]::Replace($env:HAZARD_KQL, '[^\x00-\x7F]', '-')
  $csl = ".execute database script with (ContinueOnErrors=true) <| " + $kql
  $reqBody = @{ db = $kdbName; csl = $csl } | ConvertTo-Json
  $applied = $false; $lastErr = $null
  for ($i = 1; $i -le 8; $i++) {
    try {
      Invoke-RestMethod -Uri $mgmt -Method Post -Body $reqBody `
        -Headers @{ Authorization = "Bearer $kustoToken"; 'Content-Type' = 'application/json' } | Out-Null
      $applied = $true; break
    } catch { $lastErr = $_.Exception.Message; Start-Sleep -Seconds 20 }
  }
  $kqlMsg = if ($applied) { 'applied' } else { "error: $lastErr" }
  Log "  hazard KQL $kqlMsg" ($(if ($applied) { 'Green' } else { 'Yellow' }))
}

# --- Surface results back to the ARM deployment ----------------------------------------
$DeploymentScriptOutputs = @{
  workspaceId  = $wsId
  lakehouseId  = $lhId
  eventhouseId = $ehId
  kqlDatabase  = $kdbName
  kustoUri     = $kustoUri
  shortcut     = $shortcutMsg
  hazardKql    = $kqlMsg
}
Log "Fabric plane provisioning complete." Green
