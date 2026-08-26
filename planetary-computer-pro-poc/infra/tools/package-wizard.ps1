<#
  package-wizard.ps1 - build the lightweight, zero-terminal wizard download.

  Produces dist/OneGrid-Wizard.zip: everything needed to run the deploy wizard
  and deploy the accelerator, but WITHOUT the heavy bits that are fetched or
  aren't needed to run:
    - data/        (532 MB) - seeded cloud-to-cloud from the public repo at deploy time
    - docs-site/   (video)  - source-control only (moving to its own repo)
    - .git, node_modules, dist build output, config.json, last-deploy-state.json

  A customer downloads this one zip, extracts it, and double-clicks
  Start-OneGrid-Wizard.cmd. No git, no clone, no npm, no terminal.

  Usage:
    ./tools/package-wizard.ps1                      # -> dist/OneGrid-Wizard.zip
    ./tools/package-wizard.ps1 -OutDir C:\out
#>
param(
  [string]$OutDir = (Join-Path $PSScriptRoot "..\dist")
)
$ErrorActionPreference = 'Stop'
$infra = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

# The wizard must be a SELF-CONTAINED flat tree: deploy.ps1 (+ fabric/deploy-ui/tools/
# config.sample.json) at the root, with report-app/chatagent/webapp as its SIBLINGS, so the
# extracted deploy.ps1 resolves the app via its "$Here/report-app" branch. In the OneGrid
# monorepo the app lives at ../../OGE-OneGrid; in a flat/standalone clone it sits beside infra.
$appRoot = if (Test-Path (Join-Path $infra 'report-app')) { $infra }
           elseif (Test-Path (Join-Path $infra '..\..\OGE-OneGrid\report-app')) { (Resolve-Path (Join-Path $infra '..\..\OGE-OneGrid')).Path }
           else { $null }
if (-not $appRoot) { throw "app source (report-app) not found beside infra or at ../../OGE-OneGrid - cannot build a deployable wizard." }

# Directory names excluded anywhere in the tree.
$excludeDirs  = @('.git','node_modules','data','docs-site','dist','dist-sample','.venv','__pycache__','.vs','bin','obj')
# Specific files excluded (machine/local state).
$excludeFiles = @('config.json','last-deploy-state.json')

$staging = Join-Path $env:TEMP ("onegrid-wizard-" + [guid]::NewGuid().ToString('N').Substring(0,8))
$stageRoot = Join-Path $staging "OneGrid-Wizard"
New-Item -ItemType Directory -Force -Path $stageRoot | Out-Null

# Copy a source root's files into $stageRoot (optionally under a subfolder), honouring the
# exclude lists. Returns the number of files copied.
function Stage-Tree([string]$srcRoot, [string]$destSub = '') {
  $n = 0
  Get-ChildItem $srcRoot -Recurse -File | Where-Object {
    $rel = $_.FullName.Substring($srcRoot.Length).TrimStart('\','/')
    $parts = $rel -split '[\\/]'
    $dirHit = $parts[0..($parts.Length-2)] | Where-Object { $excludeDirs -contains $_ }
    (-not $dirHit) -and ($excludeFiles -notcontains $_.Name)
  } | ForEach-Object {
    $rel = $_.FullName.Substring($srcRoot.Length).TrimStart('\','/')
    $dst = if ($destSub) { Join-Path $stageRoot (Join-Path $destSub $rel) } else { Join-Path $stageRoot $rel }
    New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent) | Out-Null
    Copy-Item $_.FullName $dst -Force
    $n++
  }
  return $n
}

Write-Host "Staging lightweight wizard: infra=$infra app=$appRoot" -ForegroundColor Cyan
$copied = 0
# 1) infra contents -> zip root (deploy.ps1, fabric, deploy-ui, tools, config.sample.json, ...)
$copied += Stage-Tree $infra
# 2) app folders -> zip root as siblings of deploy.ps1 (skip if the flat layout already merged them)
if ($appRoot -ne $infra) {
  foreach ($appDir in @('report-app','chatagent','webapp')) {
    $src = Join-Path $appRoot $appDir
    if (Test-Path $src) { $copied += Stage-Tree $src $appDir }
    elseif ($appDir -ne 'webapp') { Write-Host "  WARNING: $appDir not found at $src" -ForegroundColor Yellow }
  }
}

# Keep a placeholder so it's obvious data is seeded, not shipped.
$note = @"
This lightweight wizard does not bundle the 532 MB data set.
At deploy time the wizard seeds it cloud-to-cloud from the public repo:
  https://github.com/paulshaheen/OneGrid/releases/latest/download/onegrid-data.zip
Nothing to download here - just run Start-OneGrid-Wizard.cmd.
"@
New-Item -ItemType Directory -Force -Path (Join-Path $stageRoot "data") | Out-Null
Set-Content -Path (Join-Path $stageRoot "data\README-data-is-cloud-seeded.txt") -Value $note -Encoding UTF8

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$zip = Join-Path $OutDir "OneGrid-Wizard.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $stageRoot -DestinationPath $zip -CompressionLevel Optimal -Force
Remove-Item $staging -Recurse -Force

$mb = [math]::Round((Get-Item $zip).Length/1MB,1)
Write-Host ""
Write-Host "Built $zip ($mb MB, $copied files)" -ForegroundColor Green
Write-Host "Customers: extract, then double-click OneGrid-Wizard\Start-OneGrid-Wizard.cmd" -ForegroundColor Gray
Write-Host "Publish alongside the data bundle, e.g.:  gh release upload <tag> `"$zip`" --clobber" -ForegroundColor Gray
