# Exports all deployable Fabric item definitions from the source workspace into
# the repo's fabric/ folder, base64-decoding each part to real files.
# Run once (authoring-side) to (re)generate the bundled artifact definitions.
param(
  [string]$SourceWorkspace = "163ba38c-3869-406f-adb7-37cbc981390c",
  [string]$OutRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) "fabric")
)
$ErrorActionPreference = "Stop"
function FToken { az account get-access-token --resource "https://api.fabric.microsoft.com" --query accessToken -o tsv }

# item type -> (api path segment, output subfolder, definition format or "")
$MAP = @{
  Notebook      = @{ seg="notebooks";      out="notebooks";     fmt="ipynb" }
  SemanticModel = @{ seg="semanticModels"; out="semanticmodel"; fmt="" }
  Report        = @{ seg="reports";        out="report";        fmt="" }
  DataPipeline  = @{ seg="dataPipelines";  out="pipelines";     fmt="" }
  Eventstream   = @{ seg="eventstreams";   out="eventstream";   fmt="" }
  KQLDashboard  = @{ seg="kqlDashboards";  out="kqldashboards"; fmt="" }
}

$ftok = FToken
$items = (Invoke-RestMethod -Uri "https://api.fabric.microsoft.com/v1/workspaces/$SourceWorkspace/items" -Headers @{ Authorization="Bearer $ftok" }).value
$manifest = @()

foreach ($it in $items) {
  if (-not $MAP.ContainsKey($it.type)) { continue }
  $m = $MAP[$it.type]
  $dir = Join-Path $OutRoot $m.out
  $safe = ($it.displayName -replace '[^\w\-]', '_')
  $itemDir = Join-Path $dir $safe
  New-Item -ItemType Directory -Force -Path $itemDir | Out-Null

  $fmtQ = if ($m.fmt) { "?format=$($m.fmt)" } else { "" }
  $uri = "https://api.fabric.microsoft.com/v1/workspaces/$SourceWorkspace/$($m.seg)/$($it.id)/getDefinition$fmtQ"

  # Resume: skip if already exported (folder has files).
  if ((Test-Path $itemDir) -and (Get-ChildItem $itemDir -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1)) {
    Write-Host ("skip (exists)  {0,-16} {1}" -f $it.type, $it.displayName); continue
  }

  $resp = $null
  for ($try=0; $try -lt 5; $try++) {
    try { $ftok = FToken; $resp = Invoke-WebRequest -Uri $uri -Method Post -Headers @{ Authorization="Bearer $ftok" } -UseBasicParsing; break }
    catch { Start-Sleep -Seconds (5 * ($try+1)) }
  }
  if (-not $resp) { Write-Warning "giving up: $($it.displayName)"; continue }
  $json = $null
  if ($resp.StatusCode -eq 202) {
    $loc = ([string[]]$resp.Headers['Location'])[0]
    for ($i=0; $i -lt 30; $i++) {
      Start-Sleep -Seconds 6
      $ftok = FToken
      $st = Invoke-RestMethod -Uri $loc -Headers @{ Authorization="Bearer $ftok" }
      if ($st.status -eq 'Succeeded') { $json = Invoke-RestMethod -Uri "$loc/result" -Headers @{ Authorization="Bearer $ftok" }; break }
      if ($st.status -eq 'Failed') { Write-Warning "getDefinition failed: $($it.displayName)"; break }
    }
  } else { $json = $resp.Content | ConvertFrom-Json }
  if (-not $json) { continue }

  foreach ($p in $json.definition.parts) {
    $partPath = Join-Path $itemDir ($p.path -replace '/', '\')
    New-Item -ItemType Directory -Force -Path (Split-Path $partPath) | Out-Null
    [IO.File]::WriteAllBytes($partPath, [Convert]::FromBase64String($p.payload))
  }
  $manifest += [pscustomobject]@{ type=$it.type; displayName=$it.displayName; folder=$m.out + "/" + $safe; parts=$json.definition.parts.Count }
  Write-Host ("exported {0,-16} {1}" -f $it.type, $it.displayName)
}

$manifest | ConvertTo-Json -Depth 4 | Out-File -Encoding utf8 (Join-Path $OutRoot "_manifest.json")
Write-Host "`nExported $($manifest.Count) items. Manifest: fabric/_manifest.json"
