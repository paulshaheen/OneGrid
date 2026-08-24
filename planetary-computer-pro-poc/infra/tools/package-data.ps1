<#
  package-data.ps1 - build the public data bundle (onegrid-data.zip).

  Zips the scrubbed/synthetic parquet under data/ so the archive root contains
  lakehouse/ and eventhouse/ directly. Upload the result as a GitHub *Release
  asset* named onegrid-data.zip so the lightweight wizard can pull it anonymously
  at deploy time (the _seed_data notebook downloads it straight into OneLake).

  Release assets do NOT count against Git LFS bandwidth, unlike raw/media URLs.

  Usage:
    ./tools/package-data.ps1                       # -> dist/onegrid-data.zip
    ./tools/package-data.ps1 -OutDir C:\out
#>
param(
  [string]$OutDir = (Join-Path $PSScriptRoot "..\dist")
)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$data = Join-Path $root "data"
if (-not (Test-Path $data)) { throw "data/ not found at $data - run from a full clone (git lfs pull) so the parquet is present." }

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$zip = Join-Path $OutDir "onegrid-data.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }

$groups = @('lakehouse','eventhouse') | Where-Object { Test-Path (Join-Path $data $_) }
Write-Host "Zipping data groups -> $zip" -ForegroundColor Cyan
$groups | ForEach-Object { Write-Host "  + $(Join-Path $data $_)" }

# Build the zip with FORWARD-SLASH entry names. Windows Compress-Archive writes
# backslash separators, which Python's zipfile on Linux (the Fabric Spark seed
# notebook) treats as literal filename characters - so lakehouse/ and eventhouse/
# never become directories and nothing lands in OneLake. Writing entries by hand
# guarantees a cross-platform archive.
Add-Type -AssemblyName System.IO.Compression | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null
$fsZip = [System.IO.File]::Open($zip, [System.IO.FileMode]::Create)
$arch  = New-Object System.IO.Compression.ZipArchive($fsZip, [System.IO.Compression.ZipArchiveMode]::Create)
$count = 0
foreach ($group in $groups) {
  $base = Join-Path $data $group
  Get-ChildItem $base -Recurse -File | ForEach-Object {
    $rel = $group + '/' + $_.FullName.Substring($base.Length).TrimStart('\','/').Replace('\','/')
    $entry = $arch.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
    $es = $entry.Open()
    $in = [System.IO.File]::OpenRead($_.FullName)
    $in.CopyTo($es); $in.Close(); $es.Close()
    $count++
  }
}
$arch.Dispose(); $fsZip.Close()
Write-Host "  wrote $count entries (forward-slash paths)" -ForegroundColor DarkGray

$mb = [math]::Round((Get-Item $zip).Length/1MB,1)
Write-Host ""
Write-Host "Built $zip ($mb MB)" -ForegroundColor Green
Write-Host "Publish it as a Release asset, e.g.:" -ForegroundColor Gray
Write-Host "  gh release create data-v1 `"$zip`" --title `"OneGrid data bundle`" --notes `"Scrubbed synthetic demo data`"" -ForegroundColor Gray
Write-Host "  # or attach to an existing release:  gh release upload <tag> `"$zip`" --clobber" -ForegroundColor Gray
Write-Host "The wizard defaults to: https://github.com/paulshaheen/OGE-OneGrid/releases/latest/download/onegrid-data.zip" -ForegroundColor Gray
