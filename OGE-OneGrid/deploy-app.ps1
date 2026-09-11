<#
================================================================================
 OneGrid — build + package + deploy the web app to an existing Azure App Service
================================================================================
 The "hotfix / iterate" deploy path for the live test app. It reproduces exactly
 what the *Release OneGrid App* GitHub Action builds (report-app + webapp SSR +
 chatagent, prod deps only), then pushes it straight to the App Service via
 `az webapp deploy` (run-from-package). Use this to get local changes live without
 waiting on a `main` merge + the Release workflow.

 Canonical path (unchanged): push to `main` -> the Release workflow rebuilds
 `onegrid-app.zip` -> WEBSITE_RUN_FROM_PACKAGE (URL) picks it up. This script is the
 manual alternative and sets WEBSITE_RUN_FROM_PACKAGE=1 (uploaded package).

 Prereqs: `az login` with rights on the app; Node + npm; PowerShell 7 (pwsh) for
 fast native zip (Windows PowerShell 5.1's Deflate is pathologically slow here).

 Usage:
   ./deploy-app.ps1                              # build + deploy to the defaults below
   ./deploy-app.ps1 -App <name> -Rg <rg>         # target a different app
   ./deploy-app.ps1 -SkipBuild                   # reuse the existing webapp/dist
================================================================================
#>
[CmdletBinding()]
param(
  [string]$App = "pcpro-onegrid-app-ujcb2qv6vi2ts",
  [string]$Rg  = "rg-onegrid-test",
  [switch]$SkipBuild,     # reuse the current webapp/dist (skip the SSR build)
  [switch]$NoDeploy       # build + package only; don't push
)
$ErrorActionPreference = "Stop"
$Here  = Split-Path -Parent $MyInvocation.MyCommand.Path
$Stage = Join-Path $env:TEMP "onegrid-app"
$Zip   = Join-Path $env:TEMP "onegrid-app.zip"
function Log($m,$c="Cyan"){ Write-Host "[$(Get-Date -f HH:mm:ss)] $m" -ForegroundColor $c }

# 1) Build the webapp SSR bundle with the /webapp base path (same as the workflow).
if (-not $SkipBuild) {
  Log "building webapp SSR (APP_BASE_PATH=/webapp)..."
  Push-Location (Join-Path $Here "webapp")
  $env:APP_BASE_PATH = "/webapp"
  node node_modules/vite/bin/vite.js build
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw "webapp build failed" }
  Pop-Location
} else { Log "skipping webapp build (reusing webapp/dist)" "Yellow" }

# 2) Stage report-app + webapp + chatagent (contents at archive root).
Log "staging package..."
if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Path $Stage -Force | Out-Null
robocopy (Join-Path $Here "report-app") (Join-Path $Stage "report-app") /E /MT:16 /XD .cache /NFL /NDL /NJH /NJS | Out-Null
# never ship a resolved Fabric target — prod is wired via app settings.
Remove-Item (Join-Path $Stage "report-app\server\target.json"),(Join-Path $Stage "report-app\server\target.local.json") -Force -ErrorAction SilentlyContinue
robocopy (Join-Path $Here "webapp") (Join-Path $Stage "webapp") /E /MT:16 /XD dist-sample .vite .cache /NFL /NDL /NJH /NJS | Out-Null
if (Test-Path (Join-Path $Here "chatagent")) {
  robocopy (Join-Path $Here "chatagent") (Join-Path $Stage "chatagent") /E /MT:16 /XD node_modules .cache /NFL /NDL /NJH /NJS | Out-Null
}

# 3) Prune webapp to prod deps + trim runtime-irrelevant cruft (maps/ts/docs/tests)
#    so the package is small enough to mount on the Basic plan and quick to zip.
Log "pruning + trimming staged webapp deps..."
Push-Location (Join-Path $Stage "webapp")
npm prune --omit=dev --no-audit --no-fund | Out-Null
Pop-Location
$nm = Join-Path $Stage "webapp\node_modules"
Get-ChildItem $nm -Recurse -File -Include *.map,*.ts,*.tsx,*.md,*.markdown,*.flow -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem $nm -Recurse -File -Include LICENSE,LICENSE.*,CHANGELOG,CHANGELOG.*,*.txt -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem $nm -Recurse -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -in @('test','tests','__tests__','example','examples','docs','.github','coverage') } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

# Root package.json = the App Service entry point.
@'
{
  "name": "onegrid-app",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": { "start": "node report-app/server/index.js" }
}
'@ | Set-Content -Path (Join-Path $Stage "package.json") -Encoding UTF8

# 4) Zip (contents at archive root). Prefer pwsh 7's native Deflate (fast on ARM64).
Log "zipping package..."
Remove-Item $Zip -Force -ErrorAction SilentlyContinue
$pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if ($pwsh) {
  & $pwsh -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('$Stage','$Zip',[System.IO.Compression.CompressionLevel]::Optimal,`$false)"
} else {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::CreateFromDirectory($Stage, $Zip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
}
Log ("package: {0:N0} MB" -f ((Get-Item $Zip).Length/1MB)) "Green"
if ($NoDeploy) { Log "NoDeploy set — package at $Zip" "Yellow"; return }

# 5) Ensure uploaded-package mode + startup command, then deploy.
Log "deploying to $App ($Rg)..."
az webapp config appsettings set -n $App -g $Rg --settings "WEBSITE_RUN_FROM_PACKAGE=1" -o none
az webapp config set -n $App -g $Rg --startup-file 'node report-app/server/index.js' -o none 2>$null
az webapp deploy -n $App -g $Rg --src-path $Zip --type zip --async false

# 6) Smoke test.
$host_ = az webapp show -n $App -g $Rg --query defaultHostName -o tsv
Log "smoke test https://$host_ ..."
foreach ($p in @('/api/status','/webapp/app')) {
  try { $r = Invoke-WebRequest "https://$host_$p" -UseBasicParsing -TimeoutSec 60; Log ("  {0} -> HTTP {1}" -f $p, $r.StatusCode) "Green" }
  catch { Log ("  {0} -> {1}" -f $p, ($_.Exception.Response.StatusCode.value__ ?? $_.Exception.Message)) "Yellow" }
}
Log "done." "Green"
