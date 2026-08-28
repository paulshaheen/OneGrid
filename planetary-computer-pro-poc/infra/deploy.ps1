<#
================================================================================
 OneGrid on Microsoft Fabric - Single-Click Solution Deploy
================================================================================
 Provisions, from scratch in the current tenant:
   * A Fabric workspace (on a capacity you supply) + Lakehouse + Eventhouse/KQL DB
     + Eventstream + all notebooks + pipeline
   * Loads the bundled historical data (Lakehouse Delta tables + Eventhouse PiEvents)
   * An Import semantic model (SQL endpoint) + report, refreshed via a fixed-identity SP
   * An Azure AI Foundry account + model deployments (model selector backend)
   * The chat agent on Azure Container Apps (managed identity, no GitHub token)
   * All required identity grants

 Prerequisites: az CLI logged in (az login), an EXISTING Fabric capacity, and the
 containerapp az extension (auto-installed). Fill config.json (see config.sample.json).

 Usage:   ./deploy.ps1 -ConfigPath ./config.json
          ./deploy.ps1 -ConfigPath ./config.json -Only foundry,chatagent   # subset
================================================================================
#>
[CmdletBinding()]
param(
  [string]$ConfigPath = "./config.json",
  [string[]]$Only,                       # optional: run only these phases
  [switch]$SkipData,                     # skip the (slow) data load
  [switch]$Interactive,                  # discover + prompt for tenant/subscription/capacity/region/hosting, then deploy
  [switch]$Teardown,                     # remove the Fabric workspace + Azure resource groups created by this deploy
  [switch]$DataPlane,                     # opt-in bolt-on: wire the PI->Fabric forwarder (bolt-ons/data-plane) after deploy
  [string]$TeardownWorkspaceId,          # optional: tear down THIS specific workspace id (else resolved by config name)
  [string[]]$TeardownResourceGroups      # optional: resource groups to delete during teardown (else foundry+chatAgent from config)
)
$ErrorActionPreference = "Continue"   # az CLI writes warnings to stderr; 'Stop' would treat them as fatal.
                                       # Fabric REST helpers throw explicitly and are wrapped in try/catch.
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Here

# ---- Force UTF-8 so the Python-based az CLI can print success glyphs (e.g. '✓',
# U+2713) without crashing with UnicodeEncodeError on a cp1252 console. Without this,
# 'az containerapp up' dies while printing its success checkmark and the deploy wrongly
# reports the app as "not up", then burns ~15 min retrying each fallback region.
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
try { $OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
try { chcp 65001 | Out-Null } catch {}

# ---- Source identifiers (replaced with new target IDs during deploy) ----------
$SRC = @{
  WorkspaceId  = "163ba38c-3869-406f-adb7-37cbc981390c"
  LakehouseId  = "7e08480c-cf8d-4206-901d-38b74dbe35d9"
  KqlDbId      = "da213762-0780-4c20-aef2-04371f1a4d89"
  SqlEndpoint  = "i22siiabnewedg7vb3coyirmp4-rsrtwftjhbxublnxg7f4tajzbq"
  KustoHost    = "trd-8a08ckb2duw406mvvg.z2.kusto"
  OgeDatasetId = "53085889-e53f-416b-9810-996fd66baea9"   # source dataset id (find/replace token only)
}

# ============================ helpers =========================================
function Log($m,$c="Cyan"){ Write-Host "[$(Get-Date -f HH:mm:ss)] $m" -ForegroundColor $c }
# Run an az command that may legitimately fail (e.g. existence checks) without
# tripping $ErrorActionPreference='Stop' on native stderr. Returns stdout (trimmed) or ''.
function AzTry([scriptblock]$sb) {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = & $sb 2>$null; if ($LASTEXITCODE -ne 0) { return '' } return ($out | Out-String).Trim() }
  finally { $ErrorActionPreference = $old }
}
function Tok($res){ az account get-access-token --resource $res --query accessToken -o tsv }
function FTok { Tok "https://api.fabric.microsoft.com" }
function PbiTok { Tok "https://analysis.windows.net/powerbi/api" }
function KustoTok($u){ Tok $u }

# ============================ install telemetry ==============================
# Fire-and-forget install event to a central Application Insights so the OGE team
# can see adoption. DEFAULT ON with opt-out: uncheck the box in the wizard, set
# config.telemetry.enabled=false, or set env ONEGRID_TELEMETRY=0. The endpoint is
# overridable via env ONEGRID_TELEMETRY_CONNSTR or config.telemetry.connectionString.
# The ingestion key is a write-only telemetry key; its presence in a public repo is
# expected and by design.
$WizardVersion    = "1.0.0"
$TelemetryConnStr = "InstrumentationKey=7c64a144-82d7-4e02-9a4d-c16a2b108f2c;IngestionEndpoint=https://eastus2-3.in.applicationinsights.azure.com/;LiveEndpoint=https://eastus2.livediagnostics.monitor.azure.com/;ApplicationId=1b85964c-e4ab-487a-a0cb-9d3b3e87c7ad"
$script:TelemetryOn = $false
$script:TelemetryConnStrEff = $null
$script:TelemetryCtx = @{}
function Send-Telemetry($eventName, $props, $measurements) {
  # Telemetry disabled — nothing is sent to Microsoft. Kept as a no-op so call sites stay valid.
  return
  <#
  try {
    if (-not $script:TelemetryOn -or -not $script:TelemetryConnStrEff) { return }
    $cs   = $script:TelemetryConnStrEff
    $ikey = ([regex]::Match($cs, 'InstrumentationKey=([^;]+)')).Groups[1].Value
    $endp = ([regex]::Match($cs, 'IngestionEndpoint=([^;]+)')).Groups[1].Value
    if (-not $ikey) { return }
    if (-not $endp) { $endp = 'https://dc.services.visualstudio.com/' }
    $p = @{}
    if ($script:TelemetryCtx) { $script:TelemetryCtx.GetEnumerator() | ForEach-Object { if ($null -ne $_.Value -and "$($_.Value)".Length) { $p[$_.Key] = "$($_.Value)" } } }
    if ($props) { $props.GetEnumerator() | ForEach-Object { $p[$_.Key] = "$($_.Value)" } }
    $m = if ($measurements) { $measurements } else { @{} }
    $envelope = @{
      name = "Microsoft.ApplicationInsights.Event"
      time = (Get-Date).ToUniversalTime().ToString("o")
      iKey = $ikey
      tags = @{ "ai.cloud.role" = "onegrid-wizard"; "ai.application.ver" = $WizardVersion }
      data = @{ baseType = "EventData"; baseData = @{ ver = 2; name = $eventName; properties = $p; measurements = $m } }
    }
    $body = $envelope | ConvertTo-Json -Depth 8 -Compress
    Invoke-RestMethod -Uri ($endp.TrimEnd('/') + '/v2/track') -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 8 | Out-Null
  } catch {}
  #>
}

function FGet($path){ Invoke-RestMethod -Uri "https://api.fabric.microsoft.com/v1/$path" -Headers @{ Authorization="Bearer $(FTok)" } }
function FDelete($path){ Invoke-RestMethod -Uri "https://api.fabric.microsoft.com/v1/$path" -Method Delete -Headers @{ Authorization="Bearer $(FTok)" } }
function FPost($path,$body){
  $h = @{ Authorization="Bearer $(FTok)"; "Content-Type"="application/json" }
  $b = if ($body -is [string]) { $body } else { $body | ConvertTo-Json -Depth 30 }
  Invoke-WebRequest -Uri "https://api.fabric.microsoft.com/v1/$path" -Method Post -Headers $h -Body ([Text.Encoding]::UTF8.GetBytes($b)) -UseBasicParsing
}
function FPatch($path,$body){
  $h = @{ Authorization="Bearer $(FTok)"; "Content-Type"="application/json" }
  $b = if ($body -is [string]) { $body } else { $body | ConvertTo-Json -Depth 30 }
  Invoke-WebRequest -Uri "https://api.fabric.microsoft.com/v1/$path" -Method Patch -Headers $h -Body ([Text.Encoding]::UTF8.GetBytes($b)) -UseBasicParsing
}
# Poll a Fabric long-running-operation response; return the result body (if any).
function FWait($resp){
  if ($resp.StatusCode -eq 201) { return ($resp.Content | ConvertFrom-Json) }
  if ($resp.StatusCode -ne 202) { return ($resp.Content | ConvertFrom-Json) }
  $loc = ([string[]]$resp.Headers['Location'])[0]
  for ($i=0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 6
    $st = Invoke-RestMethod -Uri $loc -Headers @{ Authorization="Bearer $(FTok)" }
    if ($st.status -eq 'Succeeded') {
      try { return Invoke-RestMethod -Uri "$loc/result" -Headers @{ Authorization="Bearer $(FTok)" } } catch { return $st }
    }
    if ($st.status -eq 'Failed') { throw "Fabric operation failed: $($st.error | ConvertTo-Json -Depth 6)" }
  }
  throw "Fabric operation timed out"
}

# Build a definition body from a local exported item folder, rebinding source IDs.
function BuildDefinition($folder, $map) {
  $parts = @()
  Get-ChildItem $folder -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($folder.Length).TrimStart('\','/').Replace('\','/')
    $bytes = [IO.File]::ReadAllBytes($_.FullName)
    # Rebind IDs on text parts only.
    $isText = $_.Extension -match '\.(json|tmdl|py|ipynb|pbir|platform|kql|txt|xml)$' -or $_.Name -eq '.platform'
    if ($isText) {
      $txt = [Text.Encoding]::UTF8.GetString($bytes)
      foreach ($k in $map.Keys) { $txt = $txt.Replace($k, $map[$k]) }
      $bytes = [Text.Encoding]::UTF8.GetBytes($txt)
    }
    $parts += @{ path=$rel; payload=[Convert]::ToBase64String($bytes); payloadType="InlineBase64" }
  }
  return @{ parts = $parts }
}

# Notebook definition needs format="ipynb" when the content part is .ipynb;
# .py content uses the default (fabricGitSource) format.
function BuildNotebookDefinition($folder, $map) {
  $def = BuildDefinition $folder $map
  $hasIpynb = Get-ChildItem $folder -Recurse -File -Filter *.ipynb -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($hasIpynb) { $def.format = "ipynb" }
  return $def
}

# Idempotent item upsert by displayName: create if absent, else update the definition.
# $seg = API segment (notebooks|dataPipelines|semanticModels|reports). Returns the item.
function UpsertItem($ws, $seg, $name, $def) {
  $existing = (FGet "workspaces/$ws/$seg").value | Where-Object { $_.displayName -eq $name } | Select-Object -First 1
  if ($existing) {
    try { FWait (FPost "workspaces/$ws/$seg/$($existing.id)/updateDefinition" @{ definition=$def }) | Out-Null } catch {}
    return $existing
  }
  return (FWait (FPost "workspaces/$ws/$seg" @{ displayName=$name; definition=$def }))
}

# Organize workspace items into folders per fabric/_folders.json (idempotent).
function Apply-Folders($ws) {
  $mfPath = Join-Path $Here "fabric\_folders.json"
  if (-not (Test-Path $mfPath)) { return }
  $mf = Get-Content $mfPath -Raw | ConvertFrom-Json
  # Create folders (get-or-create), build name->id.
  $existing = (FGet "workspaces/$ws/folders").value
  $fid = @{}; $existing | ForEach-Object { $fid[$_.displayName] = $_.id }
  foreach ($fn in $mf.folders) {
    if (-not $fid.ContainsKey($fn)) {
      try { $f = FWait (FPost "workspaces/$ws/folders" @{ displayName=$fn }); $fid[$fn] = $f.id } catch {}
    }
  }
  # Move items to their mapped folder.
  $items = (FGet "workspaces/$ws/items").value
  $moved = 0
  foreach ($it in $items) {
    $key = "$($it.type)|$($it.displayName)"
    $target = $mf.items.$key
    if ($target -and $fid.ContainsKey($target) -and $it.folderId -ne $fid[$target]) {
      try { FPost "workspaces/$ws/items/$($it.id)/move" @{ targetFolderId=$fid[$target] } | Out-Null; $moved++ } catch {}
    }
  }
  Log "  organized $moved item(s) into $($fid.Count) folder(s)"
}

# ============================ load config =====================================
if (Test-Path $ConfigPath) {
  $cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
}
elseif ($Teardown) {
  # Teardown driven by the wizard's picker supplies the workspace + resource groups
  # explicitly, so a saved config.json isn't required. Use a minimal placeholder.
  $cfg = [pscustomobject]@{ subscriptionId=''; fabric=[pscustomobject]@{}; foundry=[pscustomobject]@{}; chatAgent=[pscustomobject]@{} }
}
else { throw "Config not found: $ConfigPath (copy config.sample.json)" }
az account show 1>$null 2>$null; if ($LASTEXITCODE -ne 0) { throw "Run 'az login' first." }
if (-not $cfg.subscriptionId) { $cfg.subscriptionId = az account show --query id -o tsv }
az account set --subscription $cfg.subscriptionId 1>$null

# ---- install telemetry DISABLED — no data is sent to Microsoft (opt-in removed from the wizard) ----
$script:TelemetryConnStrEff = $null
$script:TelemetryOn = $false
<#
$script:TelemetryConnStrEff = if ($env:ONEGRID_TELEMETRY_CONNSTR) { $env:ONEGRID_TELEMETRY_CONNSTR } elseif ($cfg.telemetry -and $cfg.telemetry.connectionString) { $cfg.telemetry.connectionString } else { $TelemetryConnStr }
$script:TelemetryOn = $true
if ($Teardown) { $script:TelemetryOn = $false }
if ($env:ONEGRID_TELEMETRY -eq '0') { $script:TelemetryOn = $false }
if ($cfg.telemetry -and $cfg.telemetry.enabled -eq $false) { $script:TelemetryOn = $false }
if (-not $script:TelemetryConnStrEff) { $script:TelemetryOn = $false }
#>
$telAcct = try { az account show -o json 2>$null | ConvertFrom-Json } catch { $null }
$script:TelemetryCtx = @{
  tenantId       = $telAcct.tenantId
  user           = $telAcct.user.name
  subscriptionId = $cfg.subscriptionId
  region         = $cfg.location
  workspaceName  = $cfg.fabric.workspaceName
  wizardVersion  = $WizardVersion
  os             = [System.Environment]::OSVersion.Platform.ToString()
}
$script:deployStart = Get-Date
if ($script:TelemetryOn) { Log "  telemetry ON: reporting an install event to Microsoft OGE (opt out in the wizard, or ONEGRID_TELEMETRY=0)" "DarkGray" }
else { Log "  telemetry OFF (no install data is sent to Microsoft)" "DarkGray" }
# Send-Telemetry "OneGridDeployStart" @{ outcome = "started"; only = ($Only -join ',') } @{}

$state = @{}   # collects created IDs across phases
$script:phaseErrors = @()   # non-fatal phase issues, summarized at the end

function Should($p){ return (-not $Only) -or ($Only -contains $p) }

# ============================ PHASE: workspace ================================
function Phase-Workspace {
  Log "PHASE workspace: creating '$($cfg.fabric.workspaceName)'"
  $existing = (FGet "workspaces").value | Where-Object { $_.displayName -eq $cfg.fabric.workspaceName }
  if ($existing) { $ws = $existing[0]; Log "  reusing existing workspace $($ws.id)" "Yellow" }
  else {
    $resp = FPost "workspaces" @{ displayName=$cfg.fabric.workspaceName }
    $ws = FWait $resp
  }
  # assign capacity. Accept a bare GUID, a full ARM resource id, or a capacity display
  # name (the ARM resource name of an auto-provisioned Microsoft.Fabric/capacities). The
  # Fabric assignToCapacity API needs the capacity GUID, so resolve non-GUIDs by matching
  # the display name in the caller's Fabric capacities list.
  $cap = $cfg.fabric.capacityId
  if ($cap) {
    $capId = if ($cap -match '/capacities/') { ($cap -split '/')[-1] } else { $cap }
    if ($capId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
      try {
        $match = (FGet "capacities").value | Where-Object { $_.displayName -eq $capId } | Select-Object -First 1
        if ($match) { Log "  resolved capacity '$capId' -> $($match.id)"; $capId = $match.id }
        else { Log "  capacity '$capId' not found in Fabric capacities list (is the identity a capacity admin?)" "Yellow" }
      } catch { Log "  capacity resolve: $($_.Exception.Message)" "Yellow" }
    }
    try { FPost "workspaces/$($ws.id)/assignToCapacity" @{ capacityId = $capId } | Out-Null; Log "  assigned capacity" }
    catch { Log "  capacity assign: $($_.Exception.Message)" "Yellow" }
  }
  $state.WorkspaceId = $ws.id
  Log "  workspace = $($ws.id)" "Green"
}

# ============================ PHASE: core items ===============================
function New-Item-Simple($type, $seg, $name) {
  $body = @{ displayName=$name; type=$type }
  $resp = FPost "workspaces/$($state.WorkspaceId)/items" $body
  return (FWait $resp)
}

function Phase-Core {
  $ws = $state.WorkspaceId
  Log "PHASE core: lakehouse, eventhouse, kql db, eventstream"

  # Lakehouse (schema-enabled - the semantic model references gold./ml./dbo. schemas;
  # the OGE add-on adds an 'oge' schema loaded from data/lakehouse/oge/*)
  $lh = (FGet "workspaces/$ws/lakehouses").value | Where-Object { $_.displayName -eq $cfg.fabric.lakehouseName } | Select-Object -First 1
  if (-not $lh) { $lh = FWait (FPost "workspaces/$ws/lakehouses" @{ displayName=$cfg.fabric.lakehouseName; creationPayload=@{ enableSchemas=$true } }) }
  $state.LakehouseId = $lh.id
  # SQL endpoint (may take a moment to provision)
  for ($i=0;$i -lt 20;$i++){
    $lhFull = FGet "workspaces/$ws/lakehouses/$($lh.id)"
    if ($lhFull.properties.sqlEndpointProperties.connectionString) {
      $state.SqlEndpoint = $lhFull.properties.sqlEndpointProperties.connectionString; break
    }
    Start-Sleep -Seconds 10
  }
  Log "  lakehouse=$($lh.id)  sqlEndpoint=$($state.SqlEndpoint)" "Green"

  # Eventhouse (+ default KQL DB)
  $eh = (FGet "workspaces/$ws/eventhouses").value | Where-Object { $_.displayName -eq $cfg.fabric.eventhouseName } | Select-Object -First 1
  if (-not $eh) { $eh = FWait (FPost "workspaces/$ws/eventhouses" @{ displayName=$cfg.fabric.eventhouseName }) }
  $state.EventhouseId = $eh.id
  $kdb = (FGet "workspaces/$ws/kqlDatabases").value | Where-Object { $_.displayName -eq $cfg.fabric.kqlDatabaseName } | Select-Object -First 1
  if (-not $kdb) {
    $kdb = FWait (FPost "workspaces/$ws/kqlDatabases" @{ displayName=$cfg.fabric.kqlDatabaseName; creationPayload=@{ databaseType="ReadWrite"; parentEventhouseItemId=$eh.id } })
  }
  $state.KqlDbId = $kdb.id
  $ehFull = FGet "workspaces/$ws/eventhouses/$($eh.id)"
  $state.KustoUri = $ehFull.properties.queryServiceUri
  Log "  eventhouse=$($eh.id) kqlDb=$($kdb.id) kusto=$($state.KustoUri)" "Green"

  # Apply Eventhouse schema (tables, mappings, functions). Probe readiness, skip if already applied.
  $schemaFile = Join-Path $Here "fabric\eventhouse\schema.kql"
  if (Test-Path $schemaFile) {
    $mgmt = "$($state.KustoUri)/v1/rest/mgmt"
    $already = $false
    for ($i=0; $i -lt 10; $i++) {
      try {
        $probe = Invoke-RestMethod -Uri $mgmt -Method Post -Headers @{ Authorization="Bearer $(KustoTok $state.KustoUri)"; "Content-Type"="application/json" } -Body (@{ db=$cfg.fabric.kqlDatabaseName; csl=".show tables | project TableName" } | ConvertTo-Json)
        $tbls = $probe.Tables[0].Rows | ForEach-Object { $_[0] }
        if ($tbls -contains 'PiEvents') { $already = $true }
        break   # DB is responsive
      } catch { Start-Sleep -Seconds 12 }
    }
    if ($already) { Log "  eventhouse schema already present - skipping"; $state.EventhouseSchemaApplied = $true }
    else {
      $csl = Get-Content $schemaFile -Raw
      # Defensive: PS 5.1 ConvertTo-Json emits raw (unescaped) non-ASCII, which Kusto's
      # strict JSON reader rejects (breaks the request body). Fold any stray non-ASCII to
      # ASCII so a smart-quote/em-dash in the schema can never corrupt the request again.
      $csl = [regex]::Replace($csl, '[^\x00-\x7F]', '-')
      $body = @{ db=$cfg.fabric.kqlDatabaseName; csl=".execute database script with (ContinueOnErrors=true) <| $csl" } | ConvertTo-Json
      # A fresh KQL DB accepts .show tables before it can run .execute database script,
      # so retry the script itself patiently (up to ~5 min) until it succeeds.
      $applied = $false; $lastErr = $null
      for ($i=1; $i -le 8; $i++) {
        try { Invoke-RestMethod -Uri $mgmt -Method Post -Headers @{ Authorization="Bearer $(KustoTok $state.KustoUri)"; "Content-Type"="application/json" } -Body $body | Out-Null; Log "  applied eventhouse schema"; $applied=$true; break }
        catch { $lastErr = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }; Log "  eventhouse schema not ready (attempt $i/8): $lastErr" "DarkYellow"; if ($i -lt 8) { Start-Sleep -Seconds 20 } }
      }
      $state.EventhouseSchemaApplied = $applied
      if (-not $applied) { Log "  eventhouse schema FAILED after 8 attempts - last error: $lastErr" "Red" }
    }
  }

  # Seed synthetic demo outages into PCIOutages (idempotent) so the report's Fleet
  # Availability tile has realistic derates/outages to drill into. Runs as a standalone
  # .ingest inline command (NOT via the database-script apply, which can't host inline CSV).
  $seedFile = Join-Path $Here "fabric\eventhouse\seed-demo.kql"
  if ((Test-Path $seedFile) -and $state.KustoUri) {
    try {
      $qBody = @{ db=$cfg.fabric.kqlDatabaseName; csl="PCIOutages | where modified_by == 'demo-seed' | count" } | ConvertTo-Json
      $cntResp = Invoke-RestMethod -Uri "$($state.KustoUri)/v1/rest/query" -Method Post -Headers @{ Authorization="Bearer $(KustoTok $state.KustoUri)"; "Content-Type"="application/json" } -Body $qBody
      $seedCnt = [int]$cntResp.Tables[0].Rows[0][0]
      if ($seedCnt -eq 0) {
        $seedCsl = Get-Content $seedFile -Raw
        Invoke-RestMethod -Uri "$($state.KustoUri)/v1/rest/mgmt" -Method Post -Headers @{ Authorization="Bearer $(KustoTok $state.KustoUri)"; "Content-Type"="application/json" } -Body (@{ db=$cfg.fabric.kqlDatabaseName; csl=$seedCsl } | ConvertTo-Json) | Out-Null
        Log "  seeded synthetic outages (PCIOutages)" "Green"
      } else { Log "  synthetic outages already present ($seedCnt) - skipping" }
    } catch {
      if ($_.Exception.Message -match '\b400\b') {
        Log "  NOTE (expected, harmless): demo outages not pre-seeded - the new KQL table is still warming up. They populate automatically when you click 'Launch Demo'. Continuing deployment." "DarkGray"
      } else {
        Log "  demo outages not pre-seeded ($($_.Exception.Message)) - non-fatal; they populate on 'Launch Demo'. Continuing." "DarkGray"
      }
    }
  }
}

# ============================ PHASE: notebooks/pipeline =======================
function Phase-Artifacts {
  $ws = $state.WorkspaceId
  Log "PHASE artifacts: notebooks + pipeline (rebinding IDs)"
  $map = @{
    $SRC.WorkspaceId = $ws
    $SRC.LakehouseId = $state.LakehouseId
    $SRC.KqlDbId     = $state.KqlDbId
    $SRC.SqlEndpoint = ($state.SqlEndpoint -split '\.')[0]
    $SRC.KustoHost   = (([Uri]$state.KustoUri).Host -replace '\.fabric\.microsoft\.com$','')
  }
  # Notebooks (idempotent; _export_data and _load_data are deploy helpers, not app notebooks)
  Get-ChildItem (Join-Path $Here "fabric\notebooks") -Directory | ForEach-Object {
    $name = $_.Name
    if ($name -in @('_export_data','_load_data')) { return }
    $def = BuildNotebookDefinition $_.FullName $map
    try { UpsertItem $ws "notebooks" $name $def | Out-Null; Log "  notebook: $name" }
    catch { Log "  notebook $name FAILED: $($_.Exception.Message)" "Yellow" }
  }
  # Pipeline(s)
  Get-ChildItem (Join-Path $Here "fabric\pipelines") -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $def = BuildDefinition $_.FullName $map
    try { UpsertItem $ws "dataPipelines" $_.Name $def | Out-Null; Log "  pipeline: $($_.Name)" }
    catch { Log "  pipeline $($_.Name) FAILED: $($_.Exception.Message)" "Yellow" }
  }
  # KQL dashboards (the real-time report). Rebind eventhouse/KQL-DB ids via $map.
  Get-ChildItem (Join-Path $Here "fabric\kqldashboards") -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $def = BuildDefinition $_.FullName $map
    try { UpsertItem $ws "kqlDashboards" $_.Name $def | Out-Null; Log "  kql dashboard: $($_.Name)" }
    catch { Log "  kql dashboard $($_.Name) FAILED: $($_.Exception.Message)" "Yellow" }
  }
}

# ============================ PHASE: data =====================================
function OneLakePut($ws, $lh, $localFile, $relPath) {
  $tok = Tok "https://storage.azure.com/"
  $url = "https://onelake.dfs.fabric.microsoft.com/$ws/$lh/Files/$relPath"
  $hdr = @{ Authorization="Bearer $tok"; "x-ms-version"="2021-06-08" }
  # Skip if already uploaded with matching size (idempotent re-runs).
  try {
    $head = Invoke-WebRequest -Uri $url -Method Head -Headers $hdr -UseBasicParsing -ErrorAction Stop
    if ([int64]$head.Headers['Content-Length'] -eq (Get-Item $localFile).Length) { return }
  } catch {}
  Invoke-RestMethod -Uri "$url`?resource=file" -Method Put -Headers $hdr | Out-Null
  $bytes = [IO.File]::ReadAllBytes($localFile)
  Invoke-RestMethod -Uri "$url`?action=append&position=0" -Method Patch -Headers (@{ Authorization="Bearer $tok"; "x-ms-version"="2021-06-08"; "Content-Type"="application/octet-stream" }) -Body $bytes | Out-Null
  Invoke-RestMethod -Uri "$url`?action=flush&position=$($bytes.Length)" -Method Patch -Headers $hdr | Out-Null
}

function OneLakeGet($ws, $lh, $relPath) {
  $tok = Tok "https://storage.azure.com/"
  $url = "https://onelake.dfs.fabric.microsoft.com/$ws/$lh/Files/$relPath"
  return Invoke-RestMethod -Uri $url -Method Get -Headers @{ Authorization="Bearer $tok"; "x-ms-version"="2021-06-08" }
}

# Run a Fabric notebook job and poll to completion with a live, verbose heartbeat.
function Run-FabricNotebook($ws, $nbId, $label, $maxIters = 90) {
  try {
    $runResp = FPost "workspaces/$ws/items/$nbId/jobs/instances?jobType=RunNotebook" @{}
    $jobUrl = ([string[]]$runResp.Headers['Location'])[0]
    if (-not $jobUrl) { Log "  ${label}: could not start job" "Yellow"; return $false }
    $sw = [System.Diagnostics.Stopwatch]::StartNew(); $lastStatus = ''
    for ($i=0; $i -lt $maxIters; $i++) {
      Start-Sleep -Seconds 10
      $js = Invoke-RestMethod -Uri $jobUrl -Headers @{ Authorization="Bearer $(FTok)" }
      $el = [int]$sw.Elapsed.TotalSeconds
      if ($js.status -in @('Completed','Failed','Cancelled','Deduped')) {
        $clr = if ($js.status -eq 'Completed') { 'Green' } else { 'Yellow' }
        Log "  ${label}: $($js.status) (after ${el}s)" $clr
        return ($js.status -eq 'Completed')
      }
      if ($js.status -ne $lastStatus) { Log "    ${label}: state -> $($js.status)" "Cyan"; $lastStatus = $js.status }
      $spin = @('|','/','-','\')[$i % 4]
      Log ("    $spin ${label} running... status=$($js.status) | ${el}s elapsed") "DarkGray"
    }
    Log "  ${label}: timed out after $([int]$sw.Elapsed.TotalSeconds)s" "Yellow"
  } catch { Log "  ${label} run: $($_.Exception.Message)" "Yellow" }
  return $false
}
function Phase-Data {
  if ($SkipData) { Log "PHASE data: skipped (-SkipData)" "Yellow"; return }
  $ws = $state.WorkspaceId; $lh = $state.LakehouseId
  $dataRoot = Join-Path $Here "data\lakehouse"
  $hasLocalData = Test-Path $dataRoot
  $bundleUrl = if ($cfg.data -and $cfg.data.bundleUrl) { $cfg.data.bundleUrl } else { "https://github.com/paulshaheen/OneGrid/releases/latest/download/onegrid-data.zip" }

  if (-not $hasLocalData) {
    # -------- lightweight wizard: seed OneLake straight from the public repo (cloud-to-cloud) --------
    Log "PHASE data: cloud-seed - no local data bundle; seeding OneLake directly from the public repo"
    Log "  bundle: $bundleUrl"
    $smap = @{ $SRC.WorkspaceId=$ws; $SRC.LakehouseId=$lh; "__DATA_BUNDLE_URL__"=$bundleUrl }
    $sdef = BuildNotebookDefinition (Join-Path $Here "fabric\notebooks\_seed_data") $smap
    $snb  = UpsertItem $ws "notebooks" "_seed_data" $sdef
    Log "  running _seed_data notebook (downloads the bundle into OneLake - the laptop never touches it)..."
    if (-not (Run-FabricNotebook $ws $snb.id "_seed_data" 120)) { Log "  cloud-seed did not complete cleanly - Delta load may find no files" "Yellow" }
  }
  else {
    # -------- full clone: upload the local parquet bundle to OneLake --------
    Log "PHASE data: uploading bundled parquet to OneLake, then loading Delta tables"
    $lhFiles = @(Get-ChildItem $dataRoot -Recurse -File)
    $lhTotal = $lhFiles.Count
    $lhTotMB = [math]::Round((($lhFiles | Measure-Object Length -Sum).Sum)/1MB, 1)
    Log "  found $lhTotal parquet file(s) totalling $lhTotMB MB - uploading to OneLake..."
    $k = 0; $sentMB = 0.0; $sw = [System.Diagnostics.Stopwatch]::StartNew()
    foreach ($f in $lhFiles) {
      $k++
      $rel = "solution_import/lakehouse/" + $f.FullName.Substring($dataRoot.Length).TrimStart('\','/').Replace('\','/')
      $szMB = [math]::Round($f.Length/1MB, 2)
      Log ("    [{0,3}/{1}] -> {2}  ({3} MB)" -f $k, $lhTotal, $rel, $szMB)
      OneLakePut $ws $lh $f.FullName $rel
      $sentMB += $szMB
      $pct = [int](($k / $lhTotal) * 100)
      $rate = if ($sw.Elapsed.TotalSeconds -gt 0) { [math]::Round($sentMB / $sw.Elapsed.TotalSeconds, 1) } else { 0 }
      Log ("      ok  {0}% | {1}/{2} MB | {3} MB/s | {4}s elapsed" -f $pct, [math]::Round($sentMB,1), $lhTotMB, $rate, [int]$sw.Elapsed.TotalSeconds) "DarkGray"
    }
    $sw.Stop()
    Log ("  uploaded lakehouse parquet bundle - $lhTotal files, $lhTotMB MB in $([int]$sw.Elapsed.TotalSeconds)s") "Green"
  }

  # ---- load Delta tables (files are now in OneLake in both local + cloud-seed modes) ----
  $map = @{ $SRC.WorkspaceId=$ws; $SRC.LakehouseId=$lh }
  $def = BuildNotebookDefinition (Join-Path $Here "fabric\notebooks\_load_data") $map
  $nb  = UpsertItem $ws "notebooks" "_load_data" $def
  Log "  running _load_data notebook (loads Delta tables)..."
  Run-FabricNotebook $ws $nb.id "_load_data" 90 | Out-Null

  # ---- Eventhouse: ingest PiEvents parquet from OneLake into the KQL table ----
  $ehRoot = Join-Path $Here "data\eventhouse"
  if ($state.KustoUri -and $state.EventhouseSchemaApplied -eq $false) {
    Log "  skipping Eventhouse ingest - schema was not applied (fix the schema error above, then re-run: deploy.ps1 -Only data)" "Red"
  }
  elseif ($state.KustoUri) {
    $ehItems = @()
    if ($hasLocalData -and (Test-Path $ehRoot)) {
      Get-ChildItem $ehRoot -Directory | ForEach-Object {
        $tbl = $_.Name
        Get-ChildItem $_.FullName -Recurse -File -Filter *.parquet | ForEach-Object {
          $rel = "solution_import/eventhouse/$tbl/$($_.Name)"
          OneLakePut $ws $lh $_.FullName $rel
          $ehItems += @{ table=$tbl; rel=$rel }
        }
      }
    }
    else {
      # cloud-seed: PiEvents already landed in OneLake by _seed_data; read the index it wrote.
      try {
        $fx = OneLakeGet $ws $lh "solution_import/_files.json"
        foreach ($p in $fx.eventhouse.PSObject.Properties) {
          foreach ($leaf in $p.Value) { $ehItems += @{ table=$p.Name; rel="solution_import/eventhouse/$($p.Name)/$leaf" } }
        }
      } catch { Log "  eventhouse: could not read seeded file index (_files.json): $($_.Exception.Message)" "Yellow" }
    }

    if ($ehItems.Count -eq 0) { Log "  NOTE: no Eventhouse data to ingest." "Yellow" }
    else {
      foreach ($g in ($ehItems | Group-Object { $_.table })) {
        $tbl = $g.Name; $files = @($g.Group); $fail=0; $ok=0; $maxFail=5; $total=$files.Count
        Log "  eventhouse '$tbl': ingesting $total file(s) from OneLake into KQL (this can take several minutes)..."
        foreach ($it in $files) {
          if ($fail -ge $maxFail) { Log "  ABORT ingest '$tbl' - $fail failures hit. Skipping remaining $($total - $ok - $fail) file(s)." "Red"; break }
          $onelakeUrl = "https://onelake.dfs.fabric.microsoft.com/$ws/$lh/Files/$($it.rel)"
          $csl = ".ingest into table ['$tbl'] (h'$onelakeUrl;impersonate') with (format='parquet')"
          $body = @{ db=$cfg.fabric.kqlDatabaseName; csl=$csl } | ConvertTo-Json; $ingestErr = $null
          try { Invoke-RestMethod -Uri "$($state.KustoUri)/v1/rest/mgmt" -Method Post -Headers @{ Authorization="Bearer $(KustoTok $state.KustoUri)"; "Content-Type"="application/json" } -Body $body | Out-Null }
          catch { $ingestErr = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }; $fail++; Log "  ingest $tbl/$(Split-Path $it.rel -Leaf) FAILED ($fail/$maxFail): $ingestErr" "Yellow" }
          if (-not $ingestErr) { $ok++ }
          $processed = $ok + $fail
          if ($processed % 10 -eq 0 -and $processed -lt $total) { Log "    eventhouse '$tbl': $processed/$total ingested..." "DarkGray" }
        }
        $clr = if ($fail -eq 0) { 'Green' } else { 'Yellow' }
        Log "  eventhouse '$tbl': $ok ingested, $fail failed (of $total file(s))" $clr
      }
    }
  }
  else {
    Log "  NOTE: Eventhouse not available (no KustoUri)." "Yellow"
  }
  # ---- PHASE sites: synthetic multi-site fan-out (clone reference site into N healthy sites) ----
  # Runs after Delta load + PiEvents ingest so it can clone gold/ml rows AND the PiEvents tail.
  # New sites are stable/green (no watchlist/anomaly/root-cause); only RV2/RV3 stay flagged.
  $siteCount = if ($cfg.fabric.siteCount) { [int]$cfg.fabric.siteCount } else { 0 }
  Log "PHASE sites: synthetic multi-site fan-out"
  if ($ws -and $lh -and $siteCount -gt 0) {
    Log "  cloning reference site into $siteCount healthy site(s)..."
    $map = @{
      $SRC.WorkspaceId = $ws
      $SRC.LakehouseId = $lh
    }
    if ($state.KustoUri) { $map[$SRC.KustoHost] = (([Uri]$state.KustoUri).Host -replace '\.fabric\.microsoft\.com$','') }
    $def = BuildNotebookDefinition (Join-Path $Here "fabric\notebooks\Multi-Site-Fanout") $map
    $nb  = UpsertItem $ws "notebooks" "Multi-Site-Fanout" $def
    $runBody = @{ executionData = @{ parameters = @{ N_SITES = @{ value = "$siteCount"; type = "int" } } } }
    try {
      $runResp = FPost "workspaces/$ws/items/$($nb.id)/jobs/instances?jobType=RunNotebook" $runBody
      $jobUrl = ([string[]]$runResp.Headers['Location'])[0]
      if ($jobUrl) {
        for ($i=0; $i -lt 100; $i++) {
          Start-Sleep -Seconds 15
          $js = Invoke-RestMethod -Uri $jobUrl -Headers @{ Authorization="Bearer $(FTok)" }
          if ($js.status -in @('Completed','Failed','Cancelled','Deduped')) {
            if ($js.status -in @('Completed','Deduped')) { Log "  Multi-Site-Fanout job: $($js.status) ($siteCount site(s))" "Green" }
            else { Log "PHASE sites ERROR: Multi-Site-Fanout job $($js.status)" "Yellow" }
            break
          }
        }
      }
    } catch { Log "PHASE sites ERROR: $($_.Exception.Message)" "Yellow" }
  }
  elseif ($siteCount -le 0) { Log "  skipped (fabric.siteCount = 0)" "DarkGray" }
}

# Force the Lakehouse SQL analytics endpoint to sync its metadata so newly-loaded Delta
# tables are visible to SQL/Import-model refresh. Fabric's background sync is unreliable/
# slow; without this the Import refresh fails with "key didn't match any rows" for tables
# that exist in OneLake but aren't yet exposed by the SQL endpoint.
function Sync-SqlEndpointMetadata($ws, $lakehouseId) {
  try {
    $lhFull = FGet "workspaces/$ws/lakehouses/$lakehouseId"
    $epId = $lhFull.properties.sqlEndpointProperties.id
    if (-not $epId) { Log "  (no SQL endpoint id - skipping metadata sync)" "Yellow"; return }
    $resp = Invoke-RestMethod -Uri "https://api.fabric.microsoft.com/v1/workspaces/$ws/sqlEndpoints/$epId/refreshMetadata?preview=true" -Method Post -Headers @{ Authorization="Bearer $(FTok)"; "Content-Type"="application/json" } -Body "{}"
    Log "  synced SQL endpoint metadata ($(($resp | Measure-Object).Count) tables)" "Green"
  } catch { Log "  SQL endpoint metadata sync: $($_.Exception.Message)" "Yellow" }
}

# Create (or reuse) a service principal used as the Import model's data-source refresh
# credential. Reuses config.fixedIdentity if fully populated; otherwise creates an AAD app
# + SP + secret and persists it back to config.json so re-runs reuse the same identity.
function Ensure-DeploySP {
  $fi = $cfg.fixedIdentity
  if ($fi -and $fi.clientId -and $fi.clientSecret -and $fi.tenantId) {
    Log "  using service principal from config.fixedIdentity ($($fi.clientId))"
    $oid = AzTry { az ad sp show --id $fi.clientId --query id -o tsv }
    return @{ tenantId=$fi.tenantId; clientId=$fi.clientId; clientSecret=$fi.clientSecret; objectId=$oid }
  }
  $tenantId = AzTry { az account show --query tenantId -o tsv }
  $appName  = "$($cfg.chatAgent.appName)-refresh-sp"
  $appId = AzTry { az ad app list --display-name $appName --query "[0].appId" -o tsv }
  if (-not $appId) {
    $appId = AzTry { az ad app create --display-name $appName --sign-in-audience AzureADMyOrg --query appId -o tsv }
    if (-not $appId) { Log "  could not create app registration (insufficient AAD permission?) - supply config.fixedIdentity manually" "Red"; return @{} }
    Log "  created app registration '$appName' ($appId)"
    Start-Sleep -Seconds 15   # AAD propagation
  } else { Log "  reusing app registration '$appName' ($appId)" }
  $spOid = AzTry { az ad sp show --id $appId --query id -o tsv }
  if (-not $spOid) { $spOid = AzTry { az ad sp create --id $appId --query id -o tsv }; Start-Sleep -Seconds 8 }
  $secret = AzTry { az ad app credential reset --id $appId --display-name deploy-refresh --years 1 --query password -o tsv }
  if (-not $secret) { Log "  could not create SP secret" "Red"; return @{} }
  # Persist to config.json (gitignored) so subsequent deploys reuse this identity.
  try {
    $cfg | Add-Member -NotePropertyName fixedIdentity -NotePropertyValue ([ordered]@{ tenantId=$tenantId; clientId=$appId; clientSecret=$secret }) -Force
    [IO.File]::WriteAllText($ConfigPath, ($cfg | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding($false)))
    Log "  generated service principal '$appName' and saved it to config.json" "Green"
  } catch { Log "  (SP created but could not persist to config.json: $($_.Exception.Message))" "Yellow" }
  return @{ tenantId=$tenantId; clientId=$appId; clientSecret=$secret; objectId=$spOid }
}

# ============================ PHASE: semantic model + report ==================
function Phase-Semantic {
  $ws = $state.WorkspaceId
  Log "PHASE semantic: import model + report"
  $map = @{
    $SRC.WorkspaceId = $ws
    $SRC.SqlEndpoint = ($state.SqlEndpoint -split '\.')[0]
  }
  # Import semantic model (from exported semantic-main-import) - idempotent
  $smFolder = Join-Path $Here "fabric\semanticmodel\semantic-main-import"
  if (Test-Path $smFolder) {
    $def = BuildDefinition $smFolder $map
    $sm = UpsertItem $ws "semanticModels" "semantic-main-import" $def
    $state.DatasetId = $sm.id
    Log "  semantic model = $($sm.id)" "Green"

    # Ensure the SQL endpoint exposes all loaded tables before the Import model refreshes.
    Sync-SqlEndpointMetadata $ws $state.LakehouseId

    # Bind a fixed-identity SP connection + refresh so DAX works (Import model reads the SQL endpoint).
    $fi = Ensure-DeploySP
    if ($fi -and $fi.clientId -and $fi.clientSecret -and $fi.tenantId) {
      try {
        # Grant the SP workspace access FIRST - this SQL connection type requires a test
        # connection at create time, so the SP must be able to read the SQL endpoint already.
        $pbi = PbiTok
        try { Invoke-RestMethod -Uri "https://api.powerbi.com/v1.0/myorg/groups/$ws/users" -Method Post -Headers @{ Authorization="Bearer $pbi"; "Content-Type"="application/json" } -Body (@{ identifier=$fi.objectId; principalType="App"; groupUserAccessRight="Member" } | ConvertTo-Json) | Out-Null; Log "  granted refresh SP workspace access" }
        catch { if ($_.Exception.Message -notmatch '400') { Log "  SP workspace grant: $($_.Exception.Message)" "Yellow" } }
        Start-Sleep -Seconds 25   # let the workspace grant propagate before the connection test
        $connPayload = [ordered]@{
          connectivityType="ShareableCloud"; displayName="$($cfg.fabric.workspaceName) - sql"
          connectionDetails=[ordered]@{ type="SQL"; creationMethod="Sql"; parameters=@(
            @{ dataType="Text"; name="server"; value=$state.SqlEndpoint },
            @{ dataType="Text"; name="database"; value=$cfg.fabric.lakehouseName }) }
          privacyLevel="Organizational"
          credentialDetails=[ordered]@{ singleSignOnType="None"; connectionEncryption="Encrypted"; skipTestConnection=$false
            credentials=[ordered]@{ credentialType="ServicePrincipal"; tenantId=$fi.tenantId; servicePrincipalClientId=$fi.clientId; servicePrincipalSecret=$fi.clientSecret } } }
        $connName = "$($cfg.fabric.workspaceName) - sql"
        # Delete any existing same-named connection(s) before creating a fresh one. After a
        # teardown+redeploy the old connection still exists but points at the DELETED SQL
        # endpoint, so reusing it makes the refresh fail with a "default data connection
        # without explicit credentials" error. Always rebind to the CURRENT endpoint.
        foreach ($old in @((FGet "connections").value | Where-Object { $_.displayName -eq $connName })) {
          try { FDelete "connections/$($old.id)" | Out-Null; Log "  removed stale SQL connection $($old.id)" } catch { Log "  could not remove stale connection $($old.id): $($_.Exception.Message)" "Yellow" }
        }
        $conn = FWait (FPost "connections" $connPayload)
        $pbi = PbiTok
        Invoke-RestMethod -Uri "https://api.powerbi.com/v1.0/myorg/groups/$ws/datasets/$($sm.id)/Default.TakeOver" -Method Post -Headers @{ Authorization="Bearer $pbi" } | Out-Null
        Invoke-RestMethod -Uri "https://api.powerbi.com/v1.0/myorg/groups/$ws/datasets/$($sm.id)/Default.BindToGateway" -Method Post -Headers @{ Authorization="Bearer $pbi"; "Content-Type"="application/json" } -Body (@{ gatewayObjectId=$conn.id; datasourceObjectIds=@($conn.id) } | ConvertTo-Json) | Out-Null
        Invoke-RestMethod -Uri "https://api.powerbi.com/v1.0/myorg/groups/$ws/datasets/$($sm.id)/refreshes" -Method Post -Headers @{ Authorization="Bearer $pbi"; "Content-Type"="application/json" } -Body '{"type":"full","notifyOption":"NoNotification"}' | Out-Null
        Log "  semantic model connection bound + refresh started" "Green"
      } catch { $de = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }; Log "  semantic bind/refresh: $de (do manually - see README)" "Yellow" }
    } else {
      Log "  (no fixedIdentity in config - bind connection + refresh manually; see README)" "Yellow"
    }
  }
  # Report
  $rptFolder = Join-Path $Here "fabric\report\Main_Overview"
  if ((Test-Path $rptFolder) -and $state.DatasetId) {
    $map2 = $map.Clone(); # report references dataset by id inside definition.pbir - rebind old dataset id
    $map2["ac47a321-8bc2-4aa1-99f0-fc1a3ce06e42"] = $state.DatasetId
    $def = BuildDefinition $rptFolder $map2
    try { UpsertItem $ws "reports" "Main Overview" $def | Out-Null; Log "  report created" }
    catch { Log "  report FAILED (rebind dataset manually): $($_.Exception.Message)" "Yellow" }
  }
}

# ============================ PHASE: OGE Power BI add-on =====================
# Adds the OGE Power BI module: a Direct Lake semantic model that reads the
# 'oge' schema of lh_poc (tables loaded by Phase-Data from data/lakehouse/oge/*).
# Build reports in the Fabric service directly against the 'semantic-oge' model.
function Phase-OGE {
  $ws = $state.WorkspaceId
  if (-not $state.LakehouseId) { Log "PHASE oge: no lakehouse - run 'core' + 'data' first" "Yellow"; return }
  Log "PHASE oge: Direct Lake semantic model"

  # Direct Lake semantic model over lh_poc / oge schema (rebind workspace + lakehouse GUIDs).
  $smFolder = Join-Path $Here "fabric\semanticmodel\semantic-oge"
  if (-not (Test-Path $smFolder)) { Log "  semantic-oge folder missing - skipping" "Yellow"; return }
  $map = @{ $SRC.WorkspaceId = $ws; $SRC.LakehouseId = $state.LakehouseId }
  $def = BuildDefinition $smFolder $map
  $sm  = UpsertItem $ws "semanticModels" "semantic-oge" $def
  $state.OgeDatasetId = $sm.id
  Log "  semantic-oge = $($sm.id)" "Green"
  Log "  build OGE reports against the 'semantic-oge' model in the Fabric service" "Green"

  # Native Fabric ontology (Digital Twin Builder) over lh_poc - a first-class semantic
  # model of the OneGrid domain (plants, units, assets, sensors, work, advisories, outages,
  # predictions). Complements the notebook-derived knowledge graph in the web app.
  $ontFolder = Join-Path $Here "fabric\digitaltwinbuilder\OneGridOntology"
  if (Test-Path $ontFolder) {
    try {
      $odef = BuildDefinition $ontFolder @{ $SRC.LakehouseId = $state.LakehouseId }
      $ont = UpsertItem $ws "digitaltwinbuilders" "OneGridOntology" $odef
      $state.OntologyId = $ont.id
      Log "  digital twin ontology (OneGridOntology) = $($ont.id)" "Green"
    } catch { Log "  digital twin ontology skipped: $($_.Exception.Message)" "Yellow" }
  }
}

# ============================ PHASE: foundry ==================================
# A Cognitive Services / Foundry account SOFT-DELETES on teardown. While soft-deleted
# (retained ~48h) it still OWNS its global custom subdomain, so re-creating an account
# with the same name fails with CustomDomainInUse. Purge any soft-deleted account with
# this name (in whatever region/RG it was deleted from) to free the subdomain.
# Returns $true if the name is free (nothing soft-deleted remains), else $false.
function Purge-SoftDeletedFoundry($acct) {
  $json = AzTry { az cognitiveservices account list-deleted -o json }
  if (-not $json) { return $true }
  $match = @($json | ConvertFrom-Json | Where-Object { $_.name -eq $acct })
  if ($match.Count -eq 0) { return $true }
  $m = $match[0]
  $drg = ($m.id -split '/resourceGroups/')[1].Split('/')[0]
  $dloc = $m.location
  Log "  soft-deleted Foundry account '$acct' found in RG '$drg' ($dloc) - purging to free the subdomain..." "Yellow"
  for ($i = 1; $i -le 20; $i++) {
    $out = az cognitiveservices account purge --location $dloc --resource-group $drg --name $acct 2>&1
    if ($LASTEXITCODE -eq 0) { Log "  purged soft-deleted Foundry account '$acct'" "Green"; return $true }
    Start-Sleep -Seconds 15
  }
  Log "  could not purge soft-deleted Foundry account '$acct' (purge: az cognitiveservices account purge --location $dloc -g $drg -n $acct)" "Yellow"
  return $false
}

# Persist the (possibly updated) config back to disk, UTF-8 no BOM. Used when a phase changes
# a value at runtime (e.g. the Foundry subdomain fallback) so re-runs + chat agent stay in sync.
function Save-Config {
  $p = if (Test-Path $ConfigPath) { (Resolve-Path $ConfigPath).Path } else { Join-Path $Here 'config.json' }
  try { [IO.File]::WriteAllText($p, ($cfg | ConvertTo-Json -Depth 12), (New-Object System.Text.UTF8Encoding($false))); $true }
  catch { Log "  could not persist config ($p): $($_.Exception.Message)" "Yellow"; $false }
}
function New-FoundryAccount($name, $rg) {
  az cognitiveservices account create -n $name -g $rg -l $cfg.location --kind AIServices --sku S0 --custom-domain $name --assign-identity --yes -o none 2>&1 | Out-Null
  return ($LASTEXITCODE -eq 0)
}

function Phase-Foundry {
  Log "PHASE foundry: account + model deployments"
  # Reuse PCP's existing Azure OpenAI (Foundry) account instead of standing up a second
  # one. When config supplies pcp.openAiEndpoint (+ reuseExistingFoundry), OneGrid points
  # its chat agent at PCP's shared endpoint (the aiAgentEndpoint output from PCP's bicep).
  if ($cfg.reuseExistingFoundry -and $cfg.pcp -and $cfg.pcp.openAiEndpoint) {
    $state.FoundryEndpoint = $cfg.pcp.openAiEndpoint
    $state.FoundryReused = $true
    Log "  reusing PCP Foundry endpoint: $($state.FoundryEndpoint) (no second account deployed)" "Green"
    return
  }
  $rg = $cfg.foundry.resourceGroup
  az group create -n $rg -l $cfg.location --tags "onegrid-deploy=1" "onegrid-workspace=$($state.WorkspaceId)" -o none
  $acct = $cfg.foundry.accountName
  $exists = AzTry { az cognitiveservices account show -n $acct -g $rg --query name -o tsv }
  if (-not $exists) {
    # Free the subdomain first if a soft-deleted account of the same name is holding it.
    [void](Purge-SoftDeletedFoundry $acct)
    $ok = New-FoundryAccount $acct $rg
    if (-not $ok) {
      # Retry once: the soft-deleted account may have only just become purgeable.
      Log "  Foundry account create failed - purging any same-named soft-deleted account and retrying..." "Yellow"
      [void](Purge-SoftDeletedFoundry $acct)
      $ok = New-FoundryAccount $acct $rg
    }
    # If the subdomain is held by an account we CAN'T purge (soft-deleted in ANOTHER
    # subscription with a 48h reservation, or genuinely taken), self-heal by switching to a
    # fresh unique name and persisting it to config so re-runs + the chat agent stay in sync.
    $tries = 0
    while (-not $ok -and $tries -lt 3) {
      $tries++
      $base = ($cfg.foundry.accountName -replace '-[0-9]{3,4}$','')
      $acct = "$base-$(Get-Random -Minimum 1000 -Maximum 9999)"
      Log "  subdomain unavailable - falling back to fresh Foundry name '$acct'" "Yellow"
      $ok = New-FoundryAccount $acct $rg
      if ($ok) { $cfg.foundry.accountName = $acct; [void](Save-Config); Log "  updated config.foundry.accountName -> '$acct'" "Green" }
    }
  }
  $state.FoundryEndpoint = AzTry { az cognitiveservices account show -n $acct -g $rg --query properties.endpoint -o tsv }
  if (-not $state.FoundryEndpoint) {
    throw "Foundry account '$acct' has no endpoint after fallback attempts. Set a different foundry.accountName in config and re-run: deploy.ps1 -Only foundry,chatagent,permissions."
  }
  foreach ($m in $cfg.foundry.models) {
    try {
      az cognitiveservices account deployment create -n $acct -g $rg --deployment-name $m.deployment `
        --model-name $m.model --model-version $m.version --model-format $m.format `
        --sku-name GlobalStandard --sku-capacity $m.capacity -o none 2>$null
      Log "  model: $($m.deployment)"
    } catch { Log "  model $($m.deployment) FAILED: $($_.Exception.Message)" "Yellow" }
  }
  Log "  foundry endpoint = $($state.FoundryEndpoint)" "Green"
}

# ==================== PHASE: Fabric Data Agent (over ontology) ===============
# Creates (idempotently), configures, and publishes a Fabric Data Agent that answers
# natural-language questions grounded in the OneGrid semantic model. Consumed at runtime
# by the chat app over the public MCP endpoint. All calls use the public data-agent REST
# API, so no notebook/SDK dependency is required.
function Phase-DataAgent {
  Log "PHASE dataagent: Fabric Data Agent over the ontology"
  $ws = $state.WorkspaceId
  if (-not $ws) { Log "  no workspace id in state - run 'workspace' first" "Yellow"; return }

  # Resolve the Import semantic model (semantic-main-import) as the grounding datasource.
  $smId = $state.DatasetId
  if (-not $smId) {
    $smId = AzTry { ((FGet "workspaces/$ws/semanticModels").value | Where-Object { $_.displayName -eq 'semantic-main-import' } | Select-Object -First 1).id }
  }
  if (-not $smId) { Log "  semantic-main-import not found - run the 'semantic' phase first. Skipping." "Yellow"; return }

  $name = if ($cfg.dataAgent -and $cfg.dataAgent.name) { $cfg.dataAgent.name } else { 'OneGridOntologyAgent' }
  $desc = 'OneGrid Ontology Agent - NL queries over plant/unit/asset health, predictions and watchlist.'
  $instr = @'
You are the OneGrid Ontology Agent for Ironhart Energy. You answer natural-language questions about power-generation asset health by querying the OneGrid semantic model in Microsoft Fabric.

Domain / ontology:
- Plant -> Unit -> Asset (e.g., boilers, feed pumps, steam generators) -> Sensor/Tag (PI telemetry).
- Facts: PI telemetry measurements, iCare measurements, AAKR health residuals, GADS outages, work requests.
- Predictions: short-term stop risk (probability an asset trips in the next hours), long-term survival, anomaly advisories, root-cause.
- A ranked watchlist highlights the highest-risk assets with a recommended action (MEDIUM/HIGH/CRITICAL).

Guidance:
- Prefer the modeled tables and their relationships.
- When asked "what needs attention", rank by short-term stop probability or watchlist recommended_action severity.
- Always name the specific Plant, Unit and Asset in answers, and cite the metric/value behind a recommendation.
- Be concise and operational: tell the user which asset, why, and the recommended action. If data is missing, say so rather than guessing.
'@

  # 1) get-or-create the data agent by displayName
  $agent = AzTry { (FGet "workspaces/$ws/dataAgents").value | Where-Object { $_.displayName -eq $name } | Select-Object -First 1 }
  if (-not $agent) {
    Log "  creating data agent '$name'..."
    $agent = FWait (FPost "workspaces/$ws/dataAgents" @{ displayName=$name; description=$desc })
  } else {
    Log "  data agent '$name' exists ($($agent.id))"
  }
  $da = $agent.id
  $state.DataAgentId = $da
  $base = "workspaces/$ws/dataAgents/$da"

  # 2) instructions
  try { FPatch "$base/staging/settings" @{ aiInstructions=$instr } | Out-Null; Log "  instructions set" } catch { Log "  set instructions: $($_.Exception.Message)" "Yellow" }

  # 3) attach the semantic model as a datasource (idempotent)
  $already = AzTry { (Invoke-RestMethod -Uri "https://api.fabric.microsoft.com/v1/$base/staging/datasources" -Headers @{ Authorization="Bearer $(FTok)" }).value | Where-Object { $_.id -eq $smId } }
  if (-not $already) {
    Log "  adding semantic model datasource..."
    try { FWait (FPost "$base/staging/datasources" @{ type='FabricItem'; itemReference=@{ itemId=$smId; workspaceId=$ws } }) | Out-Null }
    catch { Log "  add datasource: $($_.Exception.Message)" "Yellow" }
  } else { Log "  datasource already attached" }

  # 4) select all tables so the agent can query them
  try {
    $els = (Invoke-RestMethod -Uri "https://api.fabric.microsoft.com/v1/$base/staging/datasources/$smId/elements" -Headers @{ Authorization="Bearer $(FTok)" }).value
    $sel = 0
    foreach ($el in $els) {
      if ($el.type -ne 'Table') { continue }
      try { FPatch "$base/staging/datasources/$smId/elements?id=$([uri]::EscapeDataString($el.id))" @{ isSelected=$true } | Out-Null; $sel++ } catch {}
    }
    Log "  selected $sel table(s)"
  } catch { Log "  select tables: $($_.Exception.Message)" "Yellow" }

  # 5) publish
  try { FWait (FPost "$base/staging/publish" @{ publishedDescription=$desc }) | Out-Null; Log "  data agent published" "Green" }
  catch { Log "  publish: $($_.Exception.Message)" "Yellow" }

  Log "  data agent = $da (workspace $ws)" "Green"
}

# ============================ PHASE: chat agent ==============================
function Phase-ChatAgent {
  Log "PHASE chatagent: App Service web app"
  $rg = $cfg.chatAgent.resourceGroup
  az group create -n $rg -l $cfg.location --tags "onegrid-deploy=1" "onegrid-workspace=$($state.WorkspaceId)" -o none

  $sub = $cfg.subscriptionId
  $models = ($cfg.foundry.models | ForEach-Object { "$($_.deployment)~$($_.deployment)~$($_.format)" }) -join ", "
  # Base env that does NOT depend on the Foundry phase succeeding. The web app must still
  # stand up when Foundry is degraded (quota/soft-delete/etc.) - the AI chat panel just runs
  # in a reduced mode until an endpoint is present. Do NOT call .TrimEnd() on a possibly-null
  # FoundryEndpoint here: that used to throw at the top of the phase and skip the web app
  # entirely whenever the foundry phase had failed.
  $envVars = @(
    "AI_DEFAULT_MODEL=$($cfg.foundry.defaultModel)",
    "AI_MODELS=$models",
    "AZURE_AI_SUBSCRIPTION_ID=$sub",
    "AZURE_AI_RESOURCE_GROUP=$($cfg.foundry.resourceGroup)",
    "AZURE_AI_ACCOUNT=$($cfg.foundry.accountName)"
  )
  if ($state.FoundryEndpoint) {
    $envVars += "AI_PROVIDER=foundry"
    $envVars += "AZURE_AI_ENDPOINT=$($state.FoundryEndpoint.TrimEnd('/'))"
  } else {
    Log "  WARNING: no Foundry endpoint (the 'foundry' phase did not produce one) - deploying the web app WITHOUT AI wiring; re-run 'deploy.ps1 -Only foundry,chatagent,permissions' once Foundry is healthy." "Yellow"
    $state.ChatAgentDegraded = 'no-foundry-endpoint'
  }
  # Explorer (webapp) backend wiring. The TanStack SSR child process inherits this web
  # app's env (report-app spawns it with ...process.env), and webapp/azure-config.ts binds
  # the Azure-backed providers ONLY when GEOCATALOG_URI is present - otherwise the Explorer
  # silently serves the synthetic Hurricane Gabrielle sample. Point it at the live GeoCatalog
  # + Foundry so the Explorer tab shows the real tenant collections/imagery/agent.
  if ($cfg.pcp -and $cfg.pcp.geoCatalogUri) { $envVars += "GEOCATALOG_URI=$($cfg.pcp.geoCatalogUri)" }
  if ($state.FoundryEndpoint) { $envVars += "FOUNDRY_ENDPOINT=$($state.FoundryEndpoint.TrimEnd('/'))" }
  if ($cfg.foundry -and $cfg.foundry.defaultModel) { $envVars += "FOUNDRY_DEPLOYMENT=$($cfg.foundry.defaultModel)" }
  # Storage wiring for the Explorer's "Data storage & upload" card: SAMPLE_CONTAINER_URL
  # (read sample assets) and UPLOAD_CONTAINER_URL/NAME (upload target). Built from the PCP
  # blob endpoint + container names the ARM template passes through config.
  if ($cfg.pcp -and $cfg.pcp.blobEndpoint) {
    $blob = $cfg.pcp.blobEndpoint.TrimEnd('/')
    if ($cfg.pcp.sampleContainer)       { $envVars += "SAMPLE_CONTAINER_URL=$blob/$($cfg.pcp.sampleContainer)" }
    if ($cfg.pcp.modelOutputsContainer) { $envVars += "UPLOAD_CONTAINER_URL=$blob/$($cfg.pcp.modelOutputsContainer)"; $envVars += "UPLOAD_CONTAINER_NAME=$($cfg.pcp.modelOutputsContainer)" }
  }
  # Aurora weather inference card: point the Explorer at the ARM-provisioned scoring endpoint.
  if ($cfg.pcp -and $cfg.pcp.auroraEndpoint) { $envVars += "AURORA_ENDPOINT=$($cfg.pcp.auroraEndpoint)" }
  if ($cfg.pcp -and $cfg.pcp.auroraDeployed) { $envVars += "AURORA_MODEL_DEPLOYED=$($cfg.pcp.auroraDeployed)" }
  # The report-app server that hosts this web app also serves the live /api data
  # plane; flag it so the ported Explorer personas read real Fabric/Eventhouse/PBI
  # data instead of the in-browser sample set.
  $envVars += "REPORT_API_ENABLED=1"

  # ---- Fabric data-plane wiring (KUSTO / Power BI / Data Agent) --------------------
  # These come from the Fabric-building phases' in-memory state. When this chatagent run is
  # part of the APP provisioner (no Fabric phases - e.g. the Fabric capacity is absent or
  # failed), $state.WorkspaceId/KustoUri are empty, so we OMIT these keys entirely rather than
  # writing blanks. Omitting (not blanking) is deliberate: App Service appsettings 'set'
  # MERGES, so the separate Fabric provisioner sets them later without this run wiping them,
  # and the app cleanly falls back to the deterministic sample estate until the capacity is live.
  if ($state.KustoUri -or $state.WorkspaceId) {
    if ($state.KustoUri) { $envVars += "KUSTO_CLUSTER=$($state.KustoUri)" }
    $envVars += "KUSTO_DATABASE=$($cfg.fabric.kqlDatabaseName)"
    if ($state.WorkspaceId) {
      $envVars += "PBI_WORKSPACE=$($state.WorkspaceId)"
      $envVars += "DATA_AGENT_WORKSPACE=$($state.WorkspaceId)"
    }
    # PBI_DATASET: prefer the id from this run's semantic phase; otherwise resolve the Import
    # model by name so 'chatagent' works even when run without 'semantic' in the same invocation.
    $datasetId = $state.DatasetId
    if (-not $datasetId -and $state.WorkspaceId) {
      $datasetId = AzTry { ((Invoke-RestMethod "https://api.powerbi.com/v1.0/myorg/groups/$($state.WorkspaceId)/datasets" -Headers @{ Authorization="Bearer $(PbiTok)" }).value | Where-Object { $_.name -eq 'semantic-main-import' } | Select-Object -First 1).id }
    }
    if ($datasetId) { $envVars += "PBI_DATASET=$datasetId" }
    else { Log "  WARNING: no Import model found - chat agent DAX will not work until PBI_DATASET is set (run the semantic phase first)" "Yellow" }

    # Fabric Data Agent (published in the 'dataagent' phase) — enables the "Ask Fabric Data
    # Agent" mode in the chat UI, consumed over the public MCP endpoint via the app identity.
    if ($state.DataAgentId) { $envVars += "DATA_AGENT_ID=$($state.DataAgentId)" }
    elseif ($state.WorkspaceId) {
      $daResolved = AzTry { ((FGet "workspaces/$($state.WorkspaceId)/dataAgents").value | Where-Object { $_.displayName -eq (if ($cfg.dataAgent -and $cfg.dataAgent.name) { $cfg.dataAgent.name } else { 'OneGridOntologyAgent' }) } | Select-Object -First 1).id }
      if ($daResolved) { $envVars += "DATA_AGENT_ID=$daResolved" }
      else { Log "  note: no published data agent found - 'Ask Fabric Data Agent' stays hidden until the 'dataagent' phase runs" "Yellow" }
    }
  } else {
    Log "  no Fabric plane in this run - omitting KUSTO_*/PBI_*/DATA_AGENT_* so the app uses the sample estate; the Fabric provisioner wires them when the capacity is live" "Yellow"
  }

  # ---- Mount the FULL dashboard as an Azure App Service web app (Linux, Node) via
  # WEBSITE_RUN_FROM_PACKAGE. The prebuilt, self-contained package (report-app + webapp SSR
  # build + chatagent + node_modules) is produced by the 'Release OneGrid App' GitHub Actions
  # workflow and published as a stable release asset. App Service mounts that zip read-only as
  # wwwroot with NO server-side build - eliminating the empty-wwwroot / Oryx-build failures.
  # The report server then serves the SPA + /api + the realtime WebSocket and spawns the chat
  # agent (../chatagent) and the webapp SSR child exactly like local.
  az provider register -n Microsoft.Web --wait 1>$null 2>$null
  $app = $cfg.chatAgent.appName

  # Package SOURCE URL: honor an explicit override (config or env, threaded from the ARM
  # template), else default to the latest published release asset on the public repo.
  $pkgSrcUrl = if ($cfg.chatAgent.packageUrl) { $cfg.chatAgent.packageUrl }
               elseif ($env:ONEGRID_APP_PACKAGE_URL) { $env:ONEGRID_APP_PACKAGE_URL }
               else { 'https://github.com/paulshaheen/OneGrid/releases/download/app-latest/onegrid-app.zip' }

  # Re-host the package in the deployment's PRIVATE storage account and mount it with the web
  # app's managed identity (the MSFT-recommended secure external-package pattern - no SAS, no
  # public exposure). When the storage target is configured (ARM path), download the source
  # zip and upload it keylessly (--auth-mode login; the Fabric-plane identity has Storage Blob
  # Data Contributor); then point WEBSITE_RUN_FROM_PACKAGE at the blob. If re-hosting isn't
  # possible (e.g. a local run with no storage target), fall back to mounting the source URL.
  $pkgStorage   = $cfg.chatAgent.packageStorageAccount
  $pkgBlobUrl   = $cfg.chatAgent.packageBlobUrl
  $pkgContainer = if ($cfg.chatAgent.packageContainer) { $cfg.chatAgent.packageContainer } else { 'onegrid-app-package' }
  $runFromPkg   = $pkgSrcUrl
  if ($pkgStorage -and $pkgBlobUrl) {
    $tmpZip = Join-Path $env:TEMP ("onegrid-app-" + [guid]::NewGuid().ToString('N').Substring(0,8) + ".zip")
    try {
      Log "  staging package: downloading $pkgSrcUrl"
      Invoke-WebRequest -Uri $pkgSrcUrl -OutFile $tmpZip -UseBasicParsing -TimeoutSec 300
      Log "  re-hosting package in private storage: $pkgStorage/$pkgContainer/onegrid-app.zip"
      az storage blob upload --account-name $pkgStorage -c $pkgContainer -n 'onegrid-app.zip' -f $tmpZip --auth-mode login --overwrite true -o none 2>$null
      $uploadOk = ($LASTEXITCODE -eq 0)
      # Only UPGRADE the run-from-package pointer to the private blob after VERIFYING the blob is
      # actually present and non-empty. Otherwise keep the public source URL, so a failed/partial
      # re-host can never leave the web app pointing at an empty blob (404 -> permanent 503).
      $blobSize = 0
      if ($uploadOk) {
        try { $blobSize = [int64](az storage blob show --account-name $pkgStorage -c $pkgContainer -n 'onegrid-app.zip' --auth-mode login --query properties.contentLength -o tsv 2>$null) } catch { $blobSize = 0 }
      }
      if ($uploadOk -and $blobSize -gt 0) { $runFromPkg = $pkgBlobUrl }
      else { Log "  blob re-host not verified (exit $LASTEXITCODE, size $blobSize) - falling back to the source URL" "Yellow" }
    } catch {
      Log "  package re-host failed ($($_.Exception.Message)) - falling back to the source URL" "Yellow"
    } finally {
      Remove-Item $tmpZip -Force -ErrorAction SilentlyContinue
    }
  }
  Log "  run-from-package: $runFromPkg" "Green"

  # App settings = the chat/report env vars + the run-from-package pointer. The server binds
  # REPORT_PORT (default 7700); App Service Linux/Node routes to 8080, so pin REPORT_PORT=8080.
  # No SCM_DO_BUILD_DURING_DEPLOYMENT: the package is already built.
  $settings = @($envVars) + @('REPORT_PORT=8080','WEBSITES_PORT=8080','WEBSITE_NODE_DEFAULT_VERSION=~22', "WEBSITE_RUN_FROM_PACKAGE=$runFromPkg")

  # Create the plan + web app, with a small region fallback if a region is out of capacity.
  $regions = @($cfg.location)
  if ($cfg.chatAgent.fallbackLocations) { $regions += $cfg.chatAgent.fallbackLocations }
  else { $regions += @('eastus','westus3','centralus','westeurope') | Where-Object { $_ -ne $cfg.location } }
  $regions = $regions | Select-Object -Unique
  $appOk = $false; $fqdn = $null

  # Configure settings + startup, mount the package, and VERIFY the app actually comes up -
  # setting WEBSITE_RUN_FROM_PACKAGE succeeds even when the URL is wrong, so we must confirm
  # the site stops returning 5xx. Checking only that the hostname resolves is not enough: an
  # ARM-created site always resolves even when no code is mounted, which previously masked a
  # 503 (empty wwwroot + startup command -> "Cannot find module report-app/server/index.js").
  # Returns @{Host;Healthy} or $null.
  function Publish-WebApp($appName, $rgName) {
    az webapp config appsettings set -n $appName -g $rgName --settings @settings -o none 2>$null
    if ($LASTEXITCODE -ne 0) { Log "  failed to set app settings (exit $LASTEXITCODE)" "Red"; return $null }
    az webapp config set -n $appName -g $rgName --startup-file 'node report-app/server/index.js' --web-sockets-enabled true -o none 2>$null
    # Restart so App Service (re)downloads and mounts the package from WEBSITE_RUN_FROM_PACKAGE.
    Log "  mounting run-from-package and restarting the app..."
    az webapp restart -n $appName -g $rgName -o none 2>$null
    $hostName = AzTry { az webapp show -n $appName -g $rgName --query defaultHostName -o tsv }
    if (-not $hostName) { Log "  web app has no hostname after restart" "Red"; return $null }
    $url = "https://$hostName"
    Log "  waiting for the app to answer (package download + cold start)..."
    $deadline = (Get-Date).AddMinutes(12)
    while ((Get-Date) -lt $deadline) {
      $code = 0
      try { $code = [int](Invoke-WebRequest -Uri $url -Method Get -TimeoutSec 20 -UseBasicParsing -ErrorAction Stop).StatusCode }
      catch { $code = [int]($_.Exception.Response.StatusCode.value__) }
      if ($code -ge 200 -and $code -lt 500) { Log "  app responded HTTP $code" "Green"; return @{ Host = $hostName; Healthy = $true } }
      Start-Sleep -Seconds 20
    }
    Log "  app still returning 5xx after 12 min - package URL or startup likely wrong (check 'az webapp log tail -n $appName -g $rgName')" "Yellow"
    return @{ Host = $hostName; Healthy = $false }
  }

  # When the one-click ARM template is used, the App Service plan + web app (+ its managed
  # identity and the storage/GeoCatalog role grants) are already declared as ARM resources.
  # In that case deploy straight into the existing site - no create, no region fallback.
  $existingLoc = AzTry { az webapp show -n $app -g $rg --query location -o tsv }
  if ($existingLoc) {
    Log "  App Service '$app' already exists ($existingLoc) - deploying into it (skipping plan/web app create)"
    $pub = Publish-WebApp $app $rg
    if ($pub) {
      $fqdn = $pub.Host; $appOk = $true; $state.ChatAgentLocation = $existingLoc
      if (-not $pub.Healthy) { $state.ChatAgentDegraded = 'app-5xx-after-deploy' }
    }
  } else {
    $planSku = if ($cfg.chatAgent -and $cfg.chatAgent.appServiceSku) { $cfg.chatAgent.appServiceSku } else { 'B1' }
    foreach ($loc in $regions) {
      $plan = "$app-plan"
      Log "  creating App Service plan + web app '$app' in $loc (sku $planSku) ..."
      az appservice plan create -n $plan -g $rg -l $loc --is-linux --sku $planSku -o none 2>$null
      az webapp create -n $app -g $rg --plan $plan --runtime 'NODE:22-lts' -o none 2>&1 | Out-Null
      if (-not (AzTry { az webapp show -n $app -g $rg --query name -o tsv })) { Log "  web app not created in $loc - trying next region" "Yellow"; continue }
      $pub = Publish-WebApp $app $rg
      if ($pub) {
        $fqdn = $pub.Host; $appOk = $true; $state.ChatAgentLocation = $loc
        if (-not $pub.Healthy) { $state.ChatAgentDegraded = 'app-5xx-after-deploy' }
        break
      }
      Log "  web app not up in $loc - trying next region" "Yellow"
    }
  }
  if (-not $appOk) {
    $state.ChatAgentFailed = $true
    $state.ChatAgentFailReason = "web app did not come up in any region ($($regions -join ', ')) - likely App Service capacity/quota or a bad run-from-package URL"
    Log "  chat agent FAILED to provision in all attempted regions ($($regions -join ', ')). Re-run: deploy.ps1 -Only chatagent,permissions" "Red"
    return
  }

  # Managed identity + Foundry role grants
  $appId = AzTry { az webapp identity assign -n $cfg.chatAgent.appName -g $rg --query principalId -o tsv }
  # When reusing PCP's Azure OpenAI, grant on THAT account (id from config) rather than a
  # locally-created Foundry account.
  $scope = if ($state.FoundryReused -and $cfg.pcp.openAiAccountId) { $cfg.pcp.openAiAccountId }
           else { AzTry { az cognitiveservices account show -n $cfg.foundry.accountName -g $cfg.foundry.resourceGroup --query id -o tsv } }
  if ($scope) {
    az role assignment create --assignee-object-id $appId --assignee-principal-type ServicePrincipal --role "Cognitive Services User" --scope $scope -o none 2>$null
    az role assignment create --assignee-object-id $appId --assignee-principal-type ServicePrincipal --role "Reader" --scope $scope -o none 2>$null
  }
  # Grant the app identity read access to PCP's sample storage so the OneLake shortcut to
  # model-outputs resolves under the app's identity (additive; PCP storage unchanged).
  if ($cfg.pcp -and $cfg.pcp.storageAccountId -and $appId) {
    az role assignment create --assignee-object-id $appId --assignee-principal-type ServicePrincipal --role "Storage Blob Data Reader" --scope $cfg.pcp.storageAccountId -o none 2>$null
  }
  # Grant the app identity the GeoCatalog data-plane role (GeoCatalog Administrator) so the
  # Explorer's SSR server can browse tenant STAC collections/imagery under managed identity.
  # Without this the webapp has GEOCATALOG_URI set but every data-plane call 403s.
  if ($cfg.pcp -and $cfg.pcp.geoCatalogId -and $appId) {
    az role assignment create --assignee-object-id $appId --assignee-principal-type ServicePrincipal --role "c9c97b9c-105d-4bb5-a2a7-7d15666c2484" --scope $cfg.pcp.geoCatalogId -o none 2>$null
  }

  # ---- Entra ID sign-in app registration (customer sign-in) -----------------------
  # The Explorer signs users in with MSAL (SPA, OAuth2 auth-code + PKCE). That needs a public
  # client app registration whose SPA redirect URI is this site's /auth/callback, plus the
  # ENTRA_CLIENT_ID / ENTRA_TENANT_ID app settings (public identifiers, NOT secrets). Wiring it
  # here makes a brand-new deployment have working sign-in with NO manual portal steps. Two
  # supported paths:
  #   1. Pre-created: pass signin.clientId (e.g. an org-governed app reg) - wired as-is.
  #   2. Auto-create: this identity creates/reuses the registration via Microsoft Graph, which
  #      requires the deployment identity to hold Graph 'Application.ReadWrite.OwnedBy'. If it
  #      lacks that, we log guidance and leave sign-in 'not configured' (the app still runs).
  $signinEnabled = $true
  try { if ($null -ne $cfg.signin -and $cfg.signin.PSObject.Properties['enabled']) { $signinEnabled = [bool]$cfg.signin.enabled } } catch {}
  if ($signinEnabled) {
    $tenantId = AzTry { az account show --query tenantId -o tsv }
    $redirect = "https://$fqdn/auth/callback"
    $signinClientId = $null
    if ($cfg.signin -and $cfg.signin.clientId) {
      $signinClientId = $cfg.signin.clientId
      Log "  sign-in: using pre-supplied app registration $signinClientId"
    } else {
      $signinName = "$($cfg.chatAgent.appName)-signin"
      try {
        $signinClientId = AzTry { az ad app list --filter "displayName eq '$signinName'" --query "[0].appId" -o tsv }
        if (-not $signinClientId) {
          Log "  sign-in: creating Entra app registration '$signinName'"
          $signinClientId = az ad app create --display-name $signinName --sign-in-audience AzureADMyOrg --query appId -o tsv 2>$null
        }
        if ($signinClientId) {
          $objId = AzTry { az ad app show --id $signinClientId --query id -o tsv }
          # Ensure the SPA redirect URI is present (MERGE, so re-deploys / extra hosts are kept).
          $existing = @(AzTry { az ad app show --id $signinClientId --query "spa.redirectUris" -o json | ConvertFrom-Json })
          if ($existing -notcontains $redirect) {
            $uris = @($existing + $redirect | Where-Object { $_ } | Select-Object -Unique)
            $body = @{ spa = @{ redirectUris = $uris } } | ConvertTo-Json -Depth 5 -Compress
            $bf = Join-Path $env:TEMP ("spa-" + [guid]::NewGuid().ToString('N').Substring(0,8) + ".json")
            Set-Content -Path $bf -Value $body -Encoding ascii
            az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/$objId" --headers "Content-Type=application/json" --body "@$bf" -o none 2>$null
            Remove-Item $bf -Force -ErrorAction SilentlyContinue
          }
          # Service principal in this tenant so users can consent/sign in (idempotent).
          az ad sp create --id $signinClientId -o none 2>$null
        }
      } catch {
        Log "  sign-in: could not auto-create the app registration ($($_.Exception.Message)). Grant the deployment identity Microsoft Graph 'Application.ReadWrite.OwnedBy', or pass signin.clientId. Sign-in stays 'not configured'." "Yellow"
        $signinClientId = $null
      }
    }
    if ($signinClientId -and $tenantId) {
      az webapp config appsettings set -n $cfg.chatAgent.appName -g $rg --settings "ENTRA_CLIENT_ID=$signinClientId" "ENTRA_TENANT_ID=$tenantId" -o none 2>$null
      $state.SigninClientId = $signinClientId
      Log "  sign-in wired: client=$signinClientId tenant=$tenantId redirect=$redirect" "Green"
    } else {
      Log "  sign-in NOT wired (no client id resolved) - the 'Identity & sign-in' card stays 'not configured'" "Yellow"
    }
  }

  $state.AppPrincipalId = $appId
  $state.AppUrl = "https://$fqdn"
  Log "  chat agent = $($state.AppUrl)" "Green"
}

# ============================ PHASE: permissions =============================
function Phase-Permissions {
  Log "PHASE permissions: Eventhouse + Power BI grants for the app identity"
  if ($state.ChatAgentFailed -or -not $state.AppPrincipalId) {
    $probe = AzTry { az webapp identity show -n $cfg.chatAgent.appName -g $cfg.chatAgent.resourceGroup --query principalId -o tsv }
    if (-not $probe) { Log "  skipping grants - chat agent identity not available (chat agent did not provision). Re-run: deploy.ps1 -Only chatagent,permissions" "Yellow"; return }
  }
  $appId = $state.AppPrincipalId
  if (-not $appId) { $appId = AzTry { az webapp identity show -n $cfg.chatAgent.appName -g $cfg.chatAgent.resourceGroup --query principalId -o tsv } }
  $tenant = AzTry { az account show --query tenantId -o tsv }
  $appClientId = AzTry { az ad sp show --id $appId --query appId -o tsv }

  # Eventhouse DB viewer
  if ($state.KustoUri -and $appClientId) {
    $csl = ".add database ['$($cfg.fabric.kqlDatabaseName)'] viewers ('aadapp=$appClientId;$tenant') 'chat agent MI'"
    $body = @{ db=$cfg.fabric.kqlDatabaseName; csl=$csl } | ConvertTo-Json
    try { Invoke-RestMethod -Uri "$($state.KustoUri)/v1/rest/mgmt" -Method Post -Headers @{ Authorization="Bearer $(KustoTok $state.KustoUri)"; "Content-Type"="application/json" } -Body $body | Out-Null; Log "  eventhouse viewer granted" }
    catch { Log "  eventhouse grant: $($_.Exception.Message)" "Yellow" }
  }
  # Power BI workspace grant for the app identity. Default: Member (original behaviour).
  # When governance.leastPrivilegeApp is enabled, grant least privilege instead: workspace
  # Viewer (read the report) + semantic-model ReadWrite (executeQueries / Build) so the runtime
  # identity can never bypass model RLS or manage the workspace. See the governance/security plane.
  $leastPriv = $false
  try { $leastPriv = [bool]$cfg.governance.leastPrivilegeApp } catch {}
  if ($leastPriv) {
    try {
      $b = @{ identifier=$appId; principalType="App"; groupUserAccessRight="Viewer" } | ConvertTo-Json
      Invoke-RestMethod -Uri "https://api.powerbi.com/v1.0/myorg/groups/$($state.WorkspaceId)/users" -Method Post -Headers @{ Authorization="Bearer $(PbiTok)"; "Content-Type"="application/json" } -Body $b | Out-Null
      Log "  power bi workspace VIEWER granted (least privilege)"
    } catch { Log "  pbi viewer grant: $($_.Exception.Message)" "Yellow" }
    if ($state.DatasetId) {
      try {
        $bb = @{ identifier=$appId; principalType="App"; datasetUserAccessRight="ReadWrite" } | ConvertTo-Json
        Invoke-RestMethod -Uri "https://api.powerbi.com/v1.0/myorg/groups/$($state.WorkspaceId)/datasets/$($state.DatasetId)/users" -Method Post -Headers @{ Authorization="Bearer $(PbiTok)"; "Content-Type"="application/json" } -Body $bb | Out-Null
        Log "  semantic-model build granted to app identity"
      } catch { Log "  semantic-model grant: $($_.Exception.Message)" "Yellow" }
    }
    $state.AppGrant = "least-privilege (workspace Viewer + dataset ReadWrite)"
  } else {
    try {
      $b = @{ identifier=$appId; principalType="App"; groupUserAccessRight="Member" } | ConvertTo-Json
      Invoke-RestMethod -Uri "https://api.powerbi.com/v1.0/myorg/groups/$($state.WorkspaceId)/users" -Method Post -Headers @{ Authorization="Bearer $(PbiTok)"; "Content-Type"="application/json" } -Body $b | Out-Null
      Log "  power bi workspace member granted"
    } catch { Log "  pbi grant: $($_.Exception.Message)" "Yellow" }
    $state.AppGrant = "workspace Member"
  }
}

# ==================== PHASE: fabricplane (PCP hazard seam) ==================
# ADDITIVE integration with Planetary Computer Pro (PCP). Wires OneGrid's Fabric plane
# onto PCP's existing backend WITHOUT copying imagery or changing PCP:
#   1) Creates a OneLake shortcut in the lakehouse pointing at PCP's `model-outputs`
#      blob container (where Aurora writes the thin hazard geometry). OneLake can't
#      shortcut GeoCatalog, but model-outputs is Blob/ADLS (supported).
#   2) Applies fabric/eventhouse/hazard-geo.kql: HazardGeometry + AssetRegistry tables
#      and the geo_point_in_polygon join + composite-risk functions/snapshot.
# Requires a `pcp` block in config.json (see config.sample.json). The shortcut needs a
# Fabric cloud connection (pcp.connectionId) that carries credentials to PCP's storage;
# if absent, the KQL still applies and the shortcut step logs guidance (non-fatal).
function Phase-FabricPlane {
  Log "PHASE fabricplane: PCP hazard seam (OneLake shortcut + geo join)"
  if (-not $cfg.pcp) { Log "  no 'pcp' block in config.json - skipping (see config.sample.json)" "Yellow"; return }
  $ws = $state.WorkspaceId
  if (-not $ws) { $ws = AzTry { ((FGet "workspaces").value | Where-Object { $_.displayName -eq $cfg.fabric.workspaceName } | Select-Object -First 1).id } }
  if (-not $ws) { Log "  no workspace id - run the 'workspace' phase first" "Yellow"; return }

  # Resolve lakehouse + KQL DB + Kusto URI (from state, else look them up).
  $lhId = $state.LakehouseId
  if (-not $lhId) { $lhId = AzTry { ((FGet "workspaces/$ws/lakehouses").value | Where-Object { $_.displayName -eq $cfg.fabric.lakehouseName } | Select-Object -First 1).id } }
  if (-not $state.KustoUri) {
    $eh = AzTry { (FGet "workspaces/$ws/eventhouses").value | Where-Object { $_.displayName -eq $cfg.fabric.eventhouseName } | Select-Object -First 1 }
    if ($eh) { $state.KustoUri = (FGet "workspaces/$ws/eventhouses/$($eh.id)").properties.queryServiceUri }
  }

  # --- 1) OneLake shortcut to PCP's model-outputs container -------------------
  $container = if ($cfg.pcp.modelOutputsContainer) { $cfg.pcp.modelOutputsContainer } else { 'model-outputs' }
  $shortcutName = if ($cfg.pcp.shortcutName) { $cfg.pcp.shortcutName } else { 'pcp_model_outputs' }
  $connId  = $cfg.pcp.connectionId
  $useAdls = $false

  # Optionally create the storage connection ourselves via the Fabric WORKSPACE IDENTITY
  # (secret-free): provision the identity, grant it Storage Blob Data Reader on the sample
  # storage, then create an ADLS Gen2 connection bound to that identity. No key/SAS stored.
  if (-not $connId -and $cfg.pcp.createConnection -and $lhId -and $cfg.pcp.storageAccountId -and $cfg.pcp.dfsEndpoint) {
    try {
      $dfs = $cfg.pcp.dfsEndpoint.TrimEnd('/')
      Log "  no connection id supplied - creating one via workspace identity"

      # a) Provision (or reuse) the workspace identity; capture its service principal id.
      $spId = ''
      try {
        $wi = FWait (FPost "workspaces/$ws/provisionIdentity" @{})
        if ($wi) { $spId = $wi.servicePrincipalId }
      } catch {
        Log "    provisionIdentity: $($_.Exception.Message) - checking for an existing identity" "DarkYellow"
      }
      if (-not $spId) {
        $wsDetail = AzTry { FGet "workspaces/$ws" }
        if ($wsDetail -and $wsDetail.workspaceIdentity) { $spId = $wsDetail.workspaceIdentity.servicePrincipalId }
      }

      if ($spId) {
        # b) Grant the workspace identity read access to the sample storage account.
        az role assignment create --assignee-object-id $spId --assignee-principal-type ServicePrincipal `
          --role "Storage Blob Data Reader" --scope $cfg.pcp.storageAccountId -o none 2>$null
        Log "    granted workspace identity Storage Blob Data Reader; waiting for RBAC to propagate"
        Start-Sleep -Seconds 45

        # c) Create the ADLS Gen2 connection bound to the workspace identity. Test-connection
        #    is unsupported for workspace-identity creds, so skip it.
        $connName = "onegrid-pcp-$container-$($ws.Substring(0,8))"
        $connBody = @{
          connectivityType  = 'ShareableCloud'
          displayName       = $connName
          connectionDetails = @{
            type           = 'AzureDataLakeStorage'
            creationMethod = 'AzureDataLakeStorage'
            parameters     = @(
              @{ dataType = 'Text'; name = 'server'; value = $dfs }
              @{ dataType = 'Text'; name = 'path';   value = $container }
            )
          }
          credentialDetails = @{
            singleSignOnType     = 'None'
            connectionEncryption = 'NotEncrypted'
            skipTestConnection   = $true
            credentials          = @{ credentialType = 'WorkspaceIdentity' }
          }
        }
        try {
          $conn = FWait (FPost "connections" $connBody)
          if ($conn) { $connId = $conn.id; $useAdls = $true; Log "    created workspace-identity connection $connId" "Green" }
        } catch {
          # Reuse an existing connection with the same display name if we hit a duplicate.
          $existingConn = AzTry { (FGet "connections").value | Where-Object { $_.displayName -eq $connName } | Select-Object -First 1 }
          if ($existingConn) { $connId = $existingConn.id; $useAdls = $true; Log "    reusing existing connection $connId" "Yellow" }
          else { Log "    connection create failed: $($_.Exception.Message)" "Yellow" }
        }
      } else {
        Log "    could not resolve workspace identity service principal - skipping connection creation" "Yellow"
      }
    } catch { Log "  workspace-identity connection setup failed: $($_.Exception.Message)" "Yellow" }
  }

  if ($lhId -and $connId -and ($useAdls -or $cfg.pcp.blobEndpoint -or $cfg.pcp.storageAccountName)) {
    $exists = AzTry { (Invoke-RestMethod -Uri "https://api.fabric.microsoft.com/v1/workspaces/$ws/items/$lhId/shortcuts" -Headers @{ Authorization="Bearer $(FTok)" }).value | Where-Object { $_.name -eq $shortcutName } }
    if ($exists) { Log "  shortcut '$shortcutName' already exists - skipping" }
    else {
      if ($useAdls) {
        $dfs = $cfg.pcp.dfsEndpoint.TrimEnd('/')
        $body = @{
          path   = 'Files'
          name   = $shortcutName
          target = @{ type = 'AdlsGen2'; adlsGen2 = @{ location = $dfs; subpath = "/$container"; connectionId = $connId } }
        }
        $tgtDesc = "$dfs/$container"
      } else {
        $blobEndpoint = if ($cfg.pcp.blobEndpoint) { $cfg.pcp.blobEndpoint.TrimEnd('/') } else { "https://$($cfg.pcp.storageAccountName).blob.core.windows.net" }
        $body = @{
          path   = 'Files'
          name   = $shortcutName
          target = @{ type = 'AzureBlobStorage'; azureBlobStorage = @{ location = $blobEndpoint; subpath = "/$container"; connectionId = $connId } }
        }
        $tgtDesc = "$blobEndpoint/$container"
      }
      try { FWait (FPost "workspaces/$ws/items/$lhId/shortcuts" $body) | Out-Null; Log "  created OneLake shortcut '$shortcutName' -> $tgtDesc" "Green"; $state.PcpShortcut = $shortcutName }
      catch { Log "  shortcut create failed (check connection + storage access): $($_.Exception.Message)" "Yellow" }
    }
  } else {
    Log "  shortcut skipped: need lakehouse + a connection id (supply pcp.connectionId or set createConnection) + storage endpoint." "Yellow"
    Log "    Create a Fabric cloud connection to PCP's storage and set pcp.connectionId, then re-run: deploy.ps1 -Only fabricplane" "Yellow"
  }

  # --- 2) Apply the hazard-geo KQL (tables + geo join + composite risk) --------
  $kqlFile = Join-Path $Here "fabric\eventhouse\hazard-geo.kql"
  if ((Test-Path $kqlFile) -and $state.KustoUri) {
    $mgmt = "$($state.KustoUri)/v1/rest/mgmt"
    $csl = Get-Content $kqlFile -Raw
    $csl = [regex]::Replace($csl, '[^\x00-\x7F]', '-')   # fold non-ASCII (Kusto strict JSON reader)
    $body = @{ db=$cfg.fabric.kqlDatabaseName; csl=".execute database script with (ContinueOnErrors=true) <| $csl" } | ConvertTo-Json
    $applied = $false; $lastErr = $null
    for ($i=1; $i -le 6; $i++) {
      try { Invoke-RestMethod -Uri $mgmt -Method Post -Headers @{ Authorization="Bearer $(KustoTok $state.KustoUri)"; "Content-Type"="application/json" } -Body $body | Out-Null; Log "  applied hazard-geo KQL (HazardGeometry + geo_point_in_polygon join + composite risk)" "Green"; $applied=$true; break }
      catch { $lastErr = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }; Log "  hazard-geo KQL not ready (attempt $i/6): $lastErr" "DarkYellow"; if ($i -lt 6) { Start-Sleep -Seconds 20 } }
    }
    $state.FabricPlaneKqlApplied = $applied
    if (-not $applied) { Log "  hazard-geo KQL FAILED after 6 attempts - last error: $lastErr" "Red" }
  } else {
    Log "  hazard-geo KQL skipped: need eventhouse KustoUri (run 'core' first)." "Yellow"
  }

  # --- 3) Grant the app identity read access to PCP storage (for the shortcut) -
  # Best-effort here; also handled in Phase-Permissions once the app identity exists.
  if ($cfg.pcp.storageAccountId -and $state.AppPrincipalId) {
    az role assignment create --assignee-object-id $state.AppPrincipalId --assignee-principal-type ServicePrincipal `
      --role "Storage Blob Data Reader" --scope $cfg.pcp.storageAccountId -o none 2>$null
    Log "  granted app identity Storage Blob Data Reader on PCP storage"
  }
}

# ============================ PHASE: teardown ================================
# Removes what the deploy created: the Fabric workspace (all items inside it) and
# the Azure resource groups (Foundry + chat agent). The Fabric CAPACITY is
# pre-existing (you supplied it) and is left untouched.
function Phase-Teardown {
  Log "PHASE teardown: removing Fabric workspace + Azure resource groups" "Yellow"

  # Resolve the workspace id. If an explicit -TeardownWorkspaceId was supplied (from the
  # wizard's deployment picker) use it; otherwise prefer the LIVE lookup by display name,
  # falling back to last-deploy-state.json.
  $wsId = $null
  $stateFile = Join-Path $Here "last-deploy-state.json"
  if ($TeardownWorkspaceId) { $wsId = $TeardownWorkspaceId }
  else {
    try { $wsId = ((FGet "workspaces").value | Where-Object { $_.displayName -eq $cfg.fabric.workspaceName } | Select-Object -First 1).id } catch {}
    if (-not $wsId -and (Test-Path $stateFile)) { try { $wsId = (Get-Content $stateFile -Raw | ConvertFrom-Json).WorkspaceId } catch {} }
  }
  if ($wsId) {
    try {
      Invoke-RestMethod -Uri "https://api.fabric.microsoft.com/v1/workspaces/$wsId" -Method Delete -Headers @{ Authorization="Bearer $(FTok)" } | Out-Null
      Log "  deleted Fabric workspace $wsId" "Green"
    } catch { Log "  workspace delete FAILED: $($_.Exception.Message)" "Red" }
  } else { Log "  no Fabric workspace found (nothing to delete)" "Yellow" }

  # Delete the tenant-level SQL connection this deploy created. Connections are NOT scoped
  # to the workspace, so they survive a workspace delete and would otherwise be reused on the
  # next deploy while still pointing at the now-deleted SQL endpoint (breaking the refresh).
  $connName = "$($cfg.fabric.workspaceName) - sql"
  try {
    foreach ($old in @((FGet "connections").value | Where-Object { $_.displayName -eq $connName })) {
      try { FDelete "connections/$($old.id)" | Out-Null; Log "  deleted SQL connection $($old.id)" "Green" } catch { Log "  connection delete FAILED $($old.id): $($_.Exception.Message)" "Yellow" }
    }
  } catch {}

  # Azure resource groups. Use the explicit list if supplied, else Foundry + chat agent from config.
  $rgs = if ($TeardownResourceGroups) { $TeardownResourceGroups } else { @($cfg.foundry.resourceGroup, $cfg.chatAgent.resourceGroup) }
  $rgs = $rgs | Where-Object { $_ } | Select-Object -Unique

  # Discover the chat-agent app name(s) BEFORE deleting the resource groups, so we can also
  # remove the matching refresh service principal even in a picker-driven teardown that has no
  # config.json (the placeholder $cfg has an empty chatAgent). The web-app name IS
  # chatAgent.appName, and its refresh SP is '<appName>-refresh-sp'. Captured now because the
  # RG delete below is async and the web apps may be gone by the SP-cleanup step.
  $appNames = @()
  if ($cfg.chatAgent.appName) { $appNames += $cfg.chatAgent.appName }
  foreach ($rg in $rgs) {
    $found = AzTry { az webapp list -g $rg --query "[].name" -o tsv }
    if ($found) { $appNames += ($found -split '\r?\n' | Where-Object { $_ }) }
  }
  $appNames = $appNames | Where-Object { $_ } | Select-Object -Unique

  foreach ($rg in $rgs) {
    if (AzTry { az group show -n $rg --query name -o tsv }) {
      Log "  deleting resource group '$rg' (async)..."
      az group delete -n $rg --yes --no-wait 2>$null
      Log "  requested delete of '$rg'" "Green"
    } else { Log "  resource group '$rg' not found - skipping" "Yellow" }
  }

  # Foundry (Cognitive Services) accounts SOFT-DELETE: they must be PURGED or the name
  # can't be reused on the next deploy. Wait for the RG delete to reach a terminal state,
  # then purge. (Purge fails while the account is still provisioning/deleting.)
  $acct = $cfg.foundry.accountName; $floc = $cfg.location; $frg = $cfg.foundry.resourceGroup
  if ($acct) {
    $purged = $false
    for ($i=1; $i -le 20; $i++) {
      $soft = AzTry { az cognitiveservices account list-deleted --query "[?name=='$acct'].name" -o tsv }
      if (-not $soft) { $purged = $true; break }   # nothing soft-deleted (or already purged)
      $out = az cognitiveservices account purge --location $floc --resource-group $frg --name $acct 2>&1
      if ($LASTEXITCODE -eq 0) { $purged = $true; Log "  purged soft-deleted Foundry account '$acct'" "Green"; break }
      if ($i -eq 1) { Log "  waiting for resource group delete to finish before purging Foundry account..." }
      Start-Sleep -Seconds 30
    }
    if (-not $purged) { Log "  could not purge Foundry account '$acct' yet - purge manually later: az cognitiveservices account purge --location $floc -g $frg -n $acct" "Yellow" }
  }

  # Refresh service principal(s) (Entra app registration) auto-created by Ensure-DeploySP during
  # deploy. They live in Entra ID (not a resource group), so they survive the workspace + RG
  # deletes above and would otherwise be orphaned. Identified by the deterministic display name
  # '<appName>-refresh-sp' (appName discovered from config and/or the deployed container apps).
  # A CUSTOMER-supplied fixedIdentity uses a different app and is never touched (guarded by
  # matching the client id we persisted). Deleting the app also removes its SP + client secret.
  $cfgClientId = if ($cfg.fixedIdentity) { $cfg.fixedIdentity.clientId } else { $null }
  $spDeletedClientId = $null
  foreach ($an in $appNames) {
    $spName = "$an-refresh-sp"
    $spAppId = AzTry { az ad app list --display-name $spName --query "[0].appId" -o tsv }
    if (-not $spAppId) { continue }
    # If config names a specific fixedIdentity, only delete the app that matches it (protects a
    # customer-supplied principal). With no config (picker teardown), delete the discovered one.
    if ($cfgClientId -and $cfgClientId -ne $spAppId) { Log "  fixedIdentity is customer-supplied ($cfgClientId) - leaving '$spName' untouched" "DarkGray"; continue }
    az ad app delete --id $spAppId 2>$null
    if ($LASTEXITCODE -eq 0) { Log "  deleted refresh service principal '$spName' ($spAppId)" "Green"; $spDeletedClientId = $spAppId }
    else { Log "  could not delete app registration '$spName' ($spAppId) - remove manually: az ad app delete --id $spAppId" "Yellow" }
  }
  # Scrub the now-dangling refresh-SP credentials from config.json so a subsequent deploy mints
  # a fresh identity instead of reusing dead credentials (and no orphaned secret sits on disk).
  if ($cfg.fixedIdentity -and (-not $cfgClientId -or $cfgClientId -eq $spDeletedClientId)) {
    try { $cfg.PSObject.Properties.Remove('fixedIdentity'); [void](Save-Config); Log "  scrubbed refresh-SP credentials from config.json" "Green" } catch { Log "  could not scrub fixedIdentity from config.json: $($_.Exception.Message)" "Yellow" }
  }

  if (Test-Path $stateFile) { Remove-Item $stateFile -Force -ErrorAction SilentlyContinue; Log "  removed last-deploy-state.json" }
  Log "TEARDOWN COMPLETE - workspace removed; resource-group deletion continues async in Azure." "Green"
}

# ============================ PHASE: data plane (opt-in bolt-on) ==============
# Generates a ready-to-fill appsettings for the PI->Fabric forwarder
# (bolt-ons/data-plane/connectors/pi-forwarder). OPT-IN ONLY: never runs in the
# default deploy. Trigger with -DataPlane (after a deploy) or -Only dataplane (standalone).
# Non-destructive: only reads Fabric metadata and writes a local generated config file.
function Phase-DataPlane {
  Log "PHASE dataplane: wiring the data-plane bolt-on (connectors)"
  $connRoot = Join-Path $Here "bolt-ons\data-plane\connectors"
  if (-not (Test-Path $connRoot)) { Log "  data-plane connectors not found at $connRoot - skipping" "Yellow"; return }
  $piDir = Join-Path $connRoot "pi-forwarder"
  $dbDir = Join-Path $connRoot "db-forwarder"

  # Resolve workspace (standalone-safe: -Only dataplane skips Phase-Workspace).
  $ws = $state.WorkspaceId
  if (-not $ws) {
    $wsItem = (FGet "workspaces").value | Where-Object { $_.displayName -eq $cfg.fabric.workspaceName } | Select-Object -First 1
    if ($wsItem) { $ws = $wsItem.id; $state.WorkspaceId = $ws }
  }
  if (-not $ws) { Log "  no workspace resolved (name '$($cfg.fabric.workspaceName)') - deploy the accelerator first" "Yellow"; return }

  $tenantId = AzTry { az account show --query tenantId -o tsv }

  # Find the eventstream + its custom-endpoint source.
  $esName = "pi-events-stream"
  $streams = (FGet "workspaces/$ws/eventstreams").value
  $es = $streams | Where-Object { $_.displayName -eq $esName } | Select-Object -First 1
  if (-not $es) { $es = $streams | Select-Object -First 1 }
  $fqdn = "REPLACE-ME.servicebus.fabric.microsoft.com"
  $eventHubName = $esName
  if ($es) {
    Log "  eventstream: $($es.displayName) ($($es.id))"
    # Best-effort: resolve the custom-endpoint source connection (Event Hub-compatible).
    try {
      $topo = Invoke-RestMethod -Uri "https://api.fabric.microsoft.com/v1/workspaces/$ws/eventstreams/$($es.id)/topology" -Headers @{ Authorization="Bearer $(FTok)" }
      $srcId = ($topo.sources | Where-Object { $_.type -eq 'CustomEndpoint' } | Select-Object -First 1).id
      if ($srcId) {
        $conn = Invoke-RestMethod -Method Post -Uri "https://api.fabric.microsoft.com/v1/workspaces/$ws/eventstreams/$($es.id)/sources/$srcId/connection" -Headers @{ Authorization="Bearer $(FTok)"; "Content-Type"="application/json" }
        if ($conn.fullyQualifiedNamespace) { $fqdn = $conn.fullyQualifiedNamespace }
        if ($conn.eventHubName)            { $eventHubName = $conn.eventHubName }
        Log "  resolved custom-endpoint namespace: $fqdn" "Green"
      }
    } catch { Log "  couldn't auto-resolve endpoint FQDN ($($_.Exception.Message)) - leaving REPLACE-ME" "Yellow" }
  } else {
    Log "  no eventstream found in workspace - is the accelerator deployed?" "Yellow"
  }

  # ---- shared helpers ------------------------------------------------------
  $tenantVal = if ($tenantId) { $tenantId } else { "REPLACE-ME" }
  $dp = $cfg.dataPlane
  function Fill-FabricBlock($cfgObj) {
    $cfgObj.Fabric.FabricNamespaceFqdn = $fqdn
    $cfgObj.Fabric.StreamName          = $eventHubName
    $cfgObj.Fabric.TenantId            = $tenantVal
    if ($dp -and $dp.fabric) {
      if ($dp.fabric.connectionString) { $cfgObj.Fabric.ConnectionString = $dp.fabric.connectionString }
      if ($dp.fabric.clientId)         { $cfgObj.Fabric.ClientId         = $dp.fabric.clientId }
      if ($dp.fabric.certThumbprint)   { $cfgObj.Fabric.CertThumbprint   = $dp.fabric.certThumbprint }
    }
    return $cfgObj
  }
  function Write-JsonFile($obj, $path) {
    [IO.File]::WriteAllText($path, ($obj | ConvertTo-Json -Depth 12), (New-Object System.Text.UTF8Encoding($false)))
  }

  # Is any source opted in? If not, keep the classic "generate templates + steps" behavior.
  $piOn  = [bool]($dp -and $dp.pi     -and $dp.pi.enabled)
  $sqlOn = [bool]($dp -and $dp.sql    -and $dp.sql.enabled)
  $oraOn = [bool]($dp -and $dp.oracle -and $dp.oracle.enabled)

  if (-not ($piOn -or $sqlOn -or $oraOn)) {
    # -------- legacy template-only mode (no opt-ins supplied) ---------------
    $written = @()
    foreach ($cDir in (Get-ChildItem $connRoot -Directory)) {
      $tmplPath = Join-Path $cDir.FullName "appsettings.json"
      if (-not (Test-Path $tmplPath)) { continue }
      try {
        $cfgObj = Get-Content $tmplPath -Raw | ConvertFrom-Json
        if ($cfgObj.PSObject.Properties.Name -notcontains 'Fabric') { continue }
        $cfgObj = Fill-FabricBlock $cfgObj
        $outPath = Join-Path $cDir.FullName "appsettings.generated.json"
        Write-JsonFile $cfgObj $outPath
        Log "  wrote $outPath" "Green"
        $written += $cDir.Name
      } catch { Log "  skipped $($cDir.Name): $($_.Exception.Message)" "Yellow" }
    }
    if ($written.Count -eq 0) { Log "  no connector appsettings templates found under $connRoot" "Yellow" }
    Log "  ----------------------------------------------------------------" "Green"
    Log "  DATA PLANE - no PI/SQL/Oracle source was opted in." "Yellow"
    Log "  Re-run from the wizard's Data Plane panel and enable a source to build + run a forwarder locally," "Gray"
    Log "  or fill the appsettings.generated.json above and install the service manually." "Gray"
    return
  }

  # -------- interactive opt-in mode: build + run forwarders locally ---------
  $isAdmin = try { ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } catch { $false }
  $install = [bool]($dp.install)
  if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    Log "  the .NET SDK (dotnet) is required to build the forwarders but was not found - install .NET 8 SDK and retry." "Red"; return
  }
  if ($install -and -not $isAdmin) {
    Log "  NOTE: not elevated - the forwarder(s) will be started as background processes (run now), not installed as a" "Yellow"
    Log "        durable Windows service. Re-run the wizard 'as administrator' to install auto-start services." "Yellow"
  }
  Log ("  auth: " + $(if ($dp.fabric -and $dp.fabric.connectionString) { "Eventstream connection string (SAS)" } elseif ($dp.fabric -and $dp.fabric.clientId) { "Entra app certificate" } else { "NONE set - fill connection string or ClientId+CertThumbprint or the forwarder can't publish" })) "Gray"

  # Publish a connector and either install it as a service (elevated) or start it now.
  function Publish-And-Run($connDir, $serviceName, $dataDir, $installScript, $extraDataFiles) {
    $pub = Join-Path $connDir "publish-output"
    Log "  building $($serviceName)..."
    $bl = & dotnet publish $connDir -c Release -r win-x64 --self-contained false -o $pub --nologo 2>&1
    if ($LASTEXITCODE -ne 0) { Log "  build FAILED for $serviceName :" "Red"; ($bl | Select-Object -Last 8) | ForEach-Object { Log "    $_" "Red" }; return $false }
    Log "  built $serviceName -> $pub" "Green"
    # generated appsettings travels with the binaries as appsettings.json
    $gen = Join-Path $connDir "appsettings.generated.json"
    if (Test-Path $gen) { Copy-Item $gen (Join-Path $pub "appsettings.json") -Force }
    if ($install -and $isAdmin) {
      try {
        & $installScript -PublishDir $pub | ForEach-Object { Log "    $_" "Gray" }
        if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Force -Path $dataDir | Out-Null }
        foreach ($f in $extraDataFiles) { if (Test-Path $f) { Copy-Item $f (Join-Path $dataDir (Split-Path $f -Leaf)) -Force } }
        Restart-Service -Name $serviceName -ErrorAction SilentlyContinue
        Log "  installed + started Windows service '$serviceName' (data: $dataDir)" "Green"
        return $true
      } catch { Log "  service install failed for $serviceName ($($_.Exception.Message)) - falling back to a background run" "Yellow" }
    }
    # background run (no admin, or install=false): data files live beside the exe
    if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Force -Path $dataDir | Out-Null }
    foreach ($f in $extraDataFiles) { if (Test-Path $f) { Copy-Item $f (Join-Path $dataDir (Split-Path $f -Leaf)) -Force } }
    $exe = Join-Path $pub ($serviceName + ".exe")
    if (-not (Test-Path $exe)) { Log "  expected $exe not found after publish" "Red"; return $false }
    Start-Process -FilePath $exe -WorkingDirectory $pub -WindowStyle Hidden | Out-Null
    Log "  started $serviceName as a background process (runs until reboot/logout). exe: $exe" "Green"
    return $true
  }

  $ran = @()

  # ----- PI forwarder -----
  if ($piOn) {
    Log "  -- PI server -> Fabric --"
    $tmpl = Get-Content (Join-Path $piDir "appsettings.json") -Raw | ConvertFrom-Json
    $tmpl = Fill-FabricBlock $tmpl
    if ($dp.pi.baseUrl)    { $tmpl.PiWebApi.BaseUrl    = $dp.pi.baseUrl }
    if ($dp.pi.dataServer) { $tmpl.PiWebApi.DataServer = $dp.pi.dataServer }
    $piData = 'C:\ProgramData\PIFabricForwarder'
    $tmpl.Queue.Path       = Join-Path $piData 'queue.db'
    $tmpl.Tags.ConfigPath  = Join-Path $piData 'tags.json'
    Write-JsonFile $tmpl (Join-Path $piDir "appsettings.generated.json")
    # tags.json from the pasted "tag,webId,plant,mode" lines
    $tagObjs = @()
    foreach ($line in (($dp.pi.tags -as [string]) -split "`n")) {
      $t = $line.Trim(); if (-not $t) { continue }
      $parts = @($t -split ',' | ForEach-Object { $_.Trim() })
      $tag = $parts[0]; if (-not $tag) { continue }
      $webId = if ($parts.Count -ge 2 -and $parts[1]) { $parts[1] } else { 'REPLACE-ME-WITH-PI-WEBID' }
      $plant = if ($parts.Count -ge 3 -and $parts[2]) { $parts[2] } elseif ($tag -match '^([^:]+):') { $Matches[1] } else { 'PLANT1' }
      $mode  = if ($parts.Count -ge 4 -and $parts[3]) { $parts[3] } else { 'Channel' }
      $tagObjs += [ordered]@{ tag=$tag; webId=$webId; plant=$plant; mode=$mode }
    }
    $tagsPath = Join-Path $piDir "tags.json"
    Write-JsonFile @($tagObjs) $tagsPath
    Log "  wrote appsettings.generated.json + tags.json ($($tagObjs.Count) tag(s))" "Green"
    $installScript = Join-Path $piDir "Install\Install-PIFabricForwarder.ps1"
    if (Publish-And-Run $piDir 'PIFabricForwarder' $piData $installScript @($tagsPath)) { $ran += 'PI' }
  }

  # ----- DB forwarder (SQL Server and/or Oracle) -----
  if ($sqlOn -or $oraOn) {
    Log "  -- SQL/Oracle -> Fabric --"
    $dbData = 'C:\ProgramData\DbFabricForwarder'
    $tmpl = Get-Content (Join-Path $dbDir "appsettings.json") -Raw | ConvertFrom-Json
    $tmpl = Fill-FabricBlock $tmpl
    $tmpl.Queue.Path = Join-Path $dbData 'queue.db'
    $tmpl.DbForwarder.SourcesConfigPath = Join-Path $dbData 'sources.json'
    Write-JsonFile $tmpl (Join-Path $dbDir "appsettings.generated.json")
    # build sources.json + set DBFWD_CONN_* env vars
    $sources = @()
    function New-DbSource($s, $provider) {
      $connName = (($s.name -as [string]) -replace '[^A-Za-z0-9]','_').ToUpper()
      if (-not $connName) { $connName = $provider.ToUpper() }
      $wmType = if ($s.watermarkType) { $s.watermarkType } else { 'DateTime' }
      $initWm = if ($s.initialWatermark) { $s.initialWatermark } elseif ($wmType -eq 'Long') { '0' } else { '2026-01-01T00:00:00Z' }
      # set the connection secret in the environment (Machine if elevated, else User+Process)
      if ($s.connectionString) {
        [Environment]::SetEnvironmentVariable("DBFWD_CONN_$connName", $s.connectionString, 'Process')
        [Environment]::SetEnvironmentVariable("DBFWD_CONN_$connName", $s.connectionString, 'User')
        if ($isAdmin) { [Environment]::SetEnvironmentVariable("DBFWD_CONN_$connName", $s.connectionString, 'Machine') }
      }
      return [ordered]@{
        name=$s.name; provider=$provider; connectionName=$connName; pollIntervalSeconds=15;
        watermarkColumn=$s.watermarkColumn; watermarkType=$wmType; initialWatermark=$initWm;
        overlapSeconds=2; shape='Narrow'; plant=$s.plant; source=$provider.ToLower(); query=$s.query;
        map=[ordered]@{ tag='tag'; ts=$s.watermarkColumn; value='value'; plant='plant'; quality='quality'; webId='tag' }
      }
    }
    if ($sqlOn) { $sources += (New-DbSource $dp.sql    'SqlServer') }
    if ($oraOn) { $sources += (New-DbSource $dp.oracle 'Oracle') }
    $sourcesPath = Join-Path $dbDir "sources.json"
    Write-JsonFile @($sources) $sourcesPath
    Log "  wrote appsettings.generated.json + sources.json ($($sources.Count) source(s)); DBFWD_CONN_* set" "Green"
    if ($sqlOn -and (-not $dp.sql.connectionString))    { Log "  WARNING: SQL source has no connection string - set DBFWD_CONN_* before it can read." "Yellow" }
    if ($oraOn -and (-not $dp.oracle.connectionString)) { Log "  WARNING: Oracle source has no connection string - set DBFWD_CONN_* before it can read." "Yellow" }
    $installScript = Join-Path $dbDir "Install\Install-DbFabricForwarder.ps1"
    if (Publish-And-Run $dbDir 'DbFabricForwarder' $dbData $installScript @($sourcesPath)) { $ran += 'DB' }
  }

  Log "  ----------------------------------------------------------------" "Green"
  if ($ran.Count -gt 0) {
    Log "  DATA PLANE running locally: $($ran -join ', ') forwarder(s) on $env:COMPUTERNAME." "Green"
    Log "  Eventstream target: $fqdn / $eventHubName" "Gray"
    if ($fqdn -like 'REPLACE-ME*') { Log "  (FQDN not auto-resolved - paste the Eventstream custom-endpoint connection string in the wizard's Data Plane panel.)" "Yellow" }
    Log "  Verify: Get-Service PIFabricForwarder,DbFabricForwarder  |  logs under C:\\ProgramData\\*FabricForwarder\\logs" "Gray"
  } else {
    Log "  DATA PLANE: no forwarder started (see errors above)." "Yellow"
  }
}

# ============================ PHASE: governance ==============================
# Provisions the OneLake data-access security plane: creates data-access roles on the
# Lakehouse (table/folder scoped, Read) mapped to the persona Entra security groups, and
# records a governance manifest consumed by the app's read-only /governance review plane.
# Fabric/OneLake remain the AUTHORITATIVE enforcement layer; the manifest is inventory only.
# Opt-in: set governance.enabled=true in config. Idempotent (reads current roles + ETag).
function Phase-Governance {
  if (-not $cfg.governance -or -not $cfg.governance.enabled) { Log "PHASE governance: disabled (set governance.enabled=true to provision the OneLake security plane) - skipping" "DarkGray"; return }
  Log "PHASE governance: OneLake data-access roles + review-plane manifest"

  $ws = $state.WorkspaceId
  if (-not $ws) { try { $ws = (FGet "workspaces").value | Where-Object { $_.displayName -eq $cfg.fabric.workspaceName } | Select-Object -First 1 -ExpandProperty id } catch {} }
  if (-not $ws) { Log "  no workspace resolved - skipping governance" "Yellow"; return }
  $lhId = $state.LakehouseId
  if (-not $lhId) { try { $lhId = (FGet "workspaces/$ws/lakehouses").value | Where-Object { $_.displayName -eq $cfg.fabric.lakehouseName } | Select-Object -First 1 -ExpandProperty id } catch {} }
  if (-not $lhId) { Log "  no lakehouse resolved - skipping governance" "Yellow"; return }
  $tenant = AzTry { az account show --query tenantId -o tsv }

  $g = $cfg.governance.groups
  # Persona -> OneLake role blueprint. Path is relative to the lakehouse OneLake root.
  # rowFilter / hiddenColumns are declarative intent surfaced by the review plane and (where
  # supported) enforced by semantic-model RLS/OLS; OneLake enforces the table/folder grant.
  $blueprint = @(
    @{ role="ExecutiveCuratedReader"; obj=$g.executivesObjectId;     groupName="OneGrid-Executives";      nick="onegrid-executives";      paths=@("/Tables/gold");              rowFilter=$null;                        hiddenColumns=@();                                          desc="Curated fleet KPIs only; no raw telemetry or maintenance notes." }
    @{ role="ControlRoomSiteReader";  obj=$g.controlRoomObjectId;    groupName="OneGrid-ControlRoom";     nick="onegrid-controlroom";     paths=@("/Tables/gold","/Tables/ml"); rowFilter="site_id IN (assigned sites)"; hiddenColumns=@();                                          desc="Live operational + ML tables, filtered to assigned sites (RLS)." }
    @{ role="MaintenanceReader";      obj=$g.maintenanceObjectId;    groupName="OneGrid-Maintenance";     nick="onegrid-maintenance";     paths=@("/Tables/gold","/Tables/ml"); rowFilter=$null;                        hiddenColumns=@("labor_rate","vendor_cost","contract_id"); desc="Asset health, work orders, predictions; commercial columns hidden (CLS)." }
    @{ role="OntologyReader";         obj=$g.ontologyReadersObjectId; groupName="OneGrid-OntologyReaders"; nick="onegrid-ontologyreaders"; paths=@("/Tables/oge");              rowFilter=$null;                        hiddenColumns=@();                                          desc="Ontology / approved entity relationships (read-only)." }
  )

  # Demo mode makes the roles demonstrable out of the box: resolve the signed-in user and, when
  # no group object id is supplied, auto-create a persona Entra security group (best-effort) and
  # add the deploying user to it. If group creation isn't permitted (no directory rights), fall
  # back to seeding the signed-in user DIRECTLY as a role member so the review plane is still
  # populated and OneLake enforcement is real. Set governance.autoCreateGroups=false to opt out.
  $isDemo = ($cfg.governance.mode -ne 'inventory')
  $auto = $isDemo -and ($cfg.governance.autoCreateGroups -ne $false)
  $meId = AzTry { az ad signed-in-user show --query id -o tsv }
  $meName = AzTry { az ad signed-in-user show --query userPrincipalName -o tsv }
  if ($isDemo -and $meId) { Log "  demo mode: seeding demonstrable members (signed-in user: $meName)" }
  function Resolve-PersonaGroup($name, $nick) {
    $id = AzTry { az ad group show --group $name --query id -o tsv }
    if (-not $id -and $auto) {
      $id = AzTry { az ad group create --display-name $name --mail-nickname $nick --query id -o tsv }
      if ($id) { Log "  created Entra security group '$name'" "Green" }
    }
    if ($id -and $meId) { AzTry { az ad group member add --group $id --member-id $meId 2>$null } | Out-Null }
    return $id
  }

  # Read existing roles + ETag (idempotent upsert).
  $rolesUri = "workspaces/$ws/items/$lhId/dataAccessRoles"
  $etag = $null
  try {
    $resp = Invoke-WebRequest -Uri "https://api.fabric.microsoft.com/v1/$rolesUri" -Headers @{ Authorization="Bearer $(FTok)" } -UseBasicParsing
    $etag = ([string[]]$resp.Headers['ETag'])[0]
  } catch { Log "  could not list existing OneLake roles (API may be preview/unavailable in this tenant): $($_.Exception.Message)" "Yellow" }

  $manifest = @{ generatedAt=(Get-Date).ToUniversalTime().ToString("o"); workspaceId=$ws; lakehouseId=$lhId; lakehouseName=$cfg.fabric.lakehouseName; mode=$cfg.governance.mode; roles=@(); appGrant=$state.AppGrant; reviewers=$g.reviewersObjectId }

  $roleObjs = @()
  foreach ($bp in $blueprint) {
    # Resolve this role's members: configured group id > auto-created persona group > (fallback)
    # the signed-in user directly. Every entry is a valid Entra member of the OneLake role.
    $memberMeta = @()   # for the manifest / review plane: {objectId,type,displayName}
    $groupId = $bp.obj
    if (-not $groupId -and $isDemo) { $groupId = Resolve-PersonaGroup $bp.groupName $bp.nick }
    if ($groupId) {
      $memberMeta += @{ objectId=$groupId; type="Group"; displayName=$bp.groupName }
    }
    # If no group could be established, seed the deploying user so the demo is still live.
    if (-not $groupId -and $isDemo -and $meId) {
      $memberMeta += @{ objectId=$meId; type="User"; displayName=$meName }
    }
    $entra = @()
    foreach ($mm in $memberMeta) { $entra += @{ objectId=$mm.objectId; tenantId=$tenant } }

    $perm = @()
    foreach ($p in $bp.paths) {
      $perm += @{ attributeName="Path";   attributeValueIncludedIn=@($p) }
      $perm += @{ attributeName="Action"; attributeValueIncludedIn=@("Read") }
    }
    $roleObjs += @{
      name=$bp.role
      decisionRules=@(@{ effect="Permit"; permission=$perm })
      members=@{ microsoftEntraMembers=$entra; fabricItemMembers=@() }
    }
    $manifest.roles += @{ name=$bp.role; groupObjectId=$groupId; groupName=$bp.groupName; paths=$bp.paths; rowFilter=$bp.rowFilter; hiddenColumns=$bp.hiddenColumns; description=$bp.desc; members=$memberMeta; membersConfigured=($memberMeta.Count -gt 0) }
    if ($memberMeta.Count) { Log "  role $($bp.role) -> $($memberMeta.Count) member(s) on $($bp.paths -join ', ')" } else { Log "  role $($bp.role): no members resolved (define governance.groups or grant directory rights)" "Yellow" }
  }

  if ($cfg.governance.mode -ne 'inventory') {
    $body = @{ value=$roleObjs } | ConvertTo-Json -Depth 12
    try {
      $h = @{ Authorization="Bearer $(FTok)"; "Content-Type"="application/json" }
      if ($etag) { $h['If-Match'] = $etag }
      Invoke-WebRequest -Uri "https://api.fabric.microsoft.com/v1/$rolesUri" -Method Put -Headers $h -Body ([Text.Encoding]::UTF8.GetBytes($body)) -UseBasicParsing | Out-Null
      Log "  OneLake data-access roles applied ($($roleObjs.Count) roles)" "Green"
      $manifest.applied = $true
    } catch {
      Log "  applying OneLake roles failed (API is preview; you can also apply in the OneLake Secure UI): $($_.Exception.Message)" "Yellow"
      $manifest.applied = $false
      $manifest.applyError = "$($_.Exception.Message)"
    }
  } else { Log "  mode=inventory: not writing roles (review plane reads whatever exists)"; $manifest.applied=$false }

  # Switching the Lakehouse SQL analytics endpoint to user-identity mode (so SQL queries
  # enforce OneLake row/column security per-user) has no stable API in every tenant version;
  # flag it for the operator + review plane rather than assume an endpoint that may not exist.
  if ($cfg.governance.sqlEndpointUserIdentityMode) {
    Log "  NOTE: set the Lakehouse SQL endpoint to user-identity mode in workspace settings so SQL queries honour OneLake roles." "Yellow"
    $manifest.sqlUserIdentityModeRequested = $true
  }

  $state.Governance = $manifest
  try {
    [IO.File]::WriteAllText((Join-Path $Here "governance-manifest.json"), ($manifest | ConvertTo-Json -Depth 12), (New-Object System.Text.UTF8Encoding($false)))
    Log "  governance manifest written to governance-manifest.json" "Green"
  } catch { Log "  could not write governance-manifest.json: $($_.Exception.Message)" "Yellow" }
}

# ============================ run =============================================
if ($Teardown) { Phase-Teardown; return }

$phases = [ordered]@{
  workspace   = { Phase-Workspace }
  core        = { Phase-Core }
  fabricplane = { Phase-FabricPlane }
  artifacts   = { Phase-Artifacts }
  data        = { Phase-Data }
  semantic    = { Phase-Semantic }
  oge         = { Phase-OGE }
  governance  = { Phase-Governance }
  foundry     = { Phase-Foundry }
  dataagent   = { Phase-DataAgent }
  chatagent   = { Phase-ChatAgent }
  permissions = { Phase-Permissions }
}
foreach ($name in $phases.Keys) {
  if (Should $name) {
    try { & $phases[$name] }
    catch { $script:phaseErrors += "$name : $($_.Exception.Message)"; Log "PHASE $name ERROR: $($_.Exception.Message)" "Red" }
  }
  else { Log "skip phase $name" "DarkGray" }
}

# Opt-in data-plane bolt-on (never part of the default deploy path).
if ($DataPlane -or ($Only -contains 'dataplane')) {
  try { Phase-DataPlane }
  catch { $script:phaseErrors += "dataplane : $($_.Exception.Message)"; Log "PHASE dataplane ERROR: $($_.Exception.Message)" "Red" }
}

# Collect non-fatal failures recorded by phases into the summary.
if ($state.EventhouseSchemaApplied -eq $false) { $script:phaseErrors += "core : eventhouse schema not applied (PiEvents/streaming tables missing)" }
if ($state.ChatAgentFailed)                     { $script:phaseErrors += "chatagent : web app did not provision ($(if ($state.ChatAgentFailReason) { $state.ChatAgentFailReason } else { 'app source missing or region capacity/build failure' }))" }

# Organize items into folders (after all items exist).
if ($state.WorkspaceId) { Log "Organizing workspace into folders..."; Apply-Folders $state.WorkspaceId }

Log "==================================================================" "Green"
if ($script:phaseErrors.Count -eq 0) {
  Log "DEPLOY COMPLETE - all phases succeeded" "Green"
} else {
  Log "DEPLOY FINISHED WITH $($script:phaseErrors.Count) ISSUE(S):" "Yellow"
  $script:phaseErrors | ForEach-Object { Log "  - $_" "Yellow" }
}
if ($state.AppUrl)        { Log "Chat agent: $($state.AppUrl)$(if ($state.ChatAgentDegraded) { " (degraded: $($state.ChatAgentDegraded))" })" "Green" }
elseif ($state.ChatAgentFailed) { Log "Chat agent: NOT DEPLOYED (see issues above)" "Yellow" }
Log "Workspace:  https://app.fabric.microsoft.com/groups/$($state.WorkspaceId)" "Green"
[IO.File]::WriteAllText((Join-Path $Here "last-deploy-state.json"), ($state | ConvertTo-Json -Depth 8), (New-Object System.Text.UTF8Encoding($false)))
Log "State written to last-deploy-state.json" "Green"
$durSec = [int]((Get-Date) - $script:deployStart).TotalSeconds
# Telemetry disabled — completion event not sent to Microsoft.
# Send-Telemetry "OneGridDeployComplete" @{
#   outcome   = $(if ($script:phaseErrors.Count -eq 0) { "success" } else { "issues" })
#   chatAgent = [bool]$state.AppUrl
#   region    = $state.ChatAgentLocation
# } @{ durationSec = $durSec; issueCount = $script:phaseErrors.Count }
if ($script:phaseErrors.Count -gt 0) { exit 1 }
