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
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

# Directory names excluded anywhere in the tree.
$excludeDirs  = @('.git','node_modules','data','docs-site','dist','.venv','__pycache__','.vs','bin','obj')
# Specific files excluded (machine/local state).
$excludeFiles = @('config.json','last-deploy-state.json')

$staging = Join-Path $env:TEMP ("onegrid-wizard-" + [guid]::NewGuid().ToString('N').Substring(0,8))
$stageRoot = Join-Path $staging "OneGrid-Wizard"
New-Item -ItemType Directory -Force -Path $stageRoot | Out-Null

Write-Host "Staging lightweight wizard from $root" -ForegroundColor Cyan
$files = Get-ChildItem $root -Recurse -File | Where-Object {
  $rel = $_.FullName.Substring($root.Length).TrimStart('\','/')
  $parts = $rel -split '[\\/]'
  $dirHit  = $parts[0..($parts.Length-2)] | Where-Object { $excludeDirs -contains $_ }
  (-not $dirHit) -and ($excludeFiles -notcontains $_.Name)
}

$copied = 0
foreach ($f in $files) {
  $rel = $f.FullName.Substring($root.Length).TrimStart('\','/')
  $dst = Join-Path $stageRoot $rel
  New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent) | Out-Null
  Copy-Item $f.FullName $dst -Force
  $copied++
}

# Keep a placeholder so it's obvious data is seeded, not shipped.
$note = @"
This lightweight wizard does not bundle the 532 MB data set.
At deploy time the wizard seeds it cloud-to-cloud from the public repo:
  https://github.com/paulshaheen/OGE-OneGrid/releases/latest/download/onegrid-data.zip
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
