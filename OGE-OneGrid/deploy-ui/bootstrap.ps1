<#
  OneGrid Deployment Wizard - zero-terminal bootstrapper.

  Double-clicked (via Start-OneGrid-Wizard.cmd) by a user who has NOT touched a
  terminal. It ensures the two prerequisites exist (Node.js + Azure CLI),
  installing them silently with winget if missing, then opens the browser and
  starts the local wizard. Azure sign-in happens inside the wizard UI, so there
  is no `az login` to type here.

  No git, no clone, no npm install - the solution folder is already on disk
  (the user extracted the OneGrid ZIP and double-clicked the launcher).
#>
$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path      # ...\deploy-ui
$Root = Split-Path -Parent $Here                             # solution root
$Port = if ($env:DEPLOY_UI_PORT) { $env:DEPLOY_UI_PORT } else { 7333 }

# ---------- pretty console helpers (verbose, on purpose) ----------------------
function Line($c='DarkGray'){ Write-Host ('  ' + ('-' * 66)) -ForegroundColor $c }
function Step($n,$m){ Write-Host ''; Write-Host "  [$n] $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "      OK  $m" -ForegroundColor Green }
function Info($m){ Write-Host "      ..  $m" -ForegroundColor DarkGray }
function Warn($m){ Write-Host "      !!  $m" -ForegroundColor Yellow }
function Die($m){ Write-Host ''; Write-Host "  ERROR  $m" -ForegroundColor Red; Write-Host ''; Read-Host '  Press Enter to close'; exit 1 }

function Have($cmd){ [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Refresh-Path {
  $m = [System.Environment]::GetEnvironmentVariable('Path','Machine')
  $u = [System.Environment]::GetEnvironmentVariable('Path','User')
  $env:Path = (@($m,$u) | Where-Object { $_ }) -join ';'
}

function Ensure-Tool($cmd, $wingetId, $friendly, [string[]]$fallbackPaths){
  if (Have $cmd) { Ok "$friendly found ($((Get-Command $cmd).Source))"; return $true }
  Info "$friendly not found - installing (a Windows approval prompt may appear)..."
  if (-not (Have 'winget')) {
    Die "$friendly is missing and winget is unavailable. Install $friendly manually, then re-run this launcher."
  }
  $p = Start-Process -FilePath 'winget' -PassThru -Wait -NoNewWindow -ArgumentList @(
    'install','--id',$wingetId,'-e','--source','winget',
    '--accept-source-agreements','--accept-package-agreements','--silent'
  )
  Refresh-Path
  if (Have $cmd) { Ok "$friendly installed"; return $true }
  foreach ($fp in $fallbackPaths) {
    if ($fp -and (Test-Path $fp)) {
      $dir = Split-Path -Parent $fp
      if ($env:Path -notlike "*$dir*") { $env:Path = "$dir;$env:Path" }
      if (Have $cmd) { Ok "$friendly installed (via $dir)"; return $true }
    }
  }
  Die "$friendly could not be installed automatically (winget exit $($p.ExitCode)). Install it manually, then re-run this launcher."
}

# ---------- banner ------------------------------------------------------------
Clear-Host
Write-Host ''
Write-Host '   ###########################################################' -ForegroundColor Blue
Write-Host '   #                                                         #' -ForegroundColor Blue
Write-Host '   #        O N E G R I D   Deployment  Wizard               #' -ForegroundColor White
Write-Host '   #        Microsoft Fabric solution accelerator            #' -ForegroundColor Gray
Write-Host '   #                                                         #' -ForegroundColor Blue
Write-Host '   ###########################################################' -ForegroundColor Blue
Write-Host ''
Info "solution folder : $Root"
Info "wizard port     : $Port"
Line

# ---------- prerequisites -----------------------------------------------------
Step 1 'Checking Node.js (runs the wizard)'
Ensure-Tool 'node' 'OpenJS.NodeJS.LTS' 'Node.js' @("$env:ProgramFiles\nodejs\node.exe","${env:ProgramFiles(x86)}\nodejs\node.exe") | Out-Null

Step 2 'Checking Azure CLI (talks to Azure + Fabric)'
Ensure-Tool 'az' 'Microsoft.AzureCLI' 'Azure CLI' @("$env:ProgramFiles\Microsoft SDKs\Azure\CLI2\wbin\az.cmd","${env:ProgramFiles(x86)}\Microsoft SDKs\Azure\CLI2\wbin\az.cmd") | Out-Null

Step 3 'Verifying the wizard server file'
$server = Join-Path $Here 'server.js'
if (-not (Test-Path $server)) { Die "server.js not found next to this launcher ($server). Re-extract the OneGrid ZIP and try again." }
Ok "found deploy-ui\server.js"

# ---------- launch ------------------------------------------------------------
Step 4 "Starting the wizard and opening your browser"
Info "the wizard will handle Azure sign-in for you (a button on the first screen)"
Line
Write-Host ''
Write-Host "   >> Opening http://localhost:$Port" -ForegroundColor Green
Write-Host "   >> Keep this window open while you use the wizard. Close it to stop." -ForegroundColor DarkGray
Write-Host ''

# If the wizard is already running on this port, just open it and stop (no second instance).
$already = $false
try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1',[int]$Port); $c.Close(); $already = $true } catch {}
if ($already) {
  Write-Host "   The wizard is already running on port $Port - opening it in your browser." -ForegroundColor Yellow
  Write-Host "   (To restart fresh, close the other wizard window first.)" -ForegroundColor DarkGray
  Start-Process "http://localhost:$Port"
  return
}

# open the browser only once the server is actually accepting connections
Start-Job -ArgumentList $Port -ScriptBlock {
  param($p)
  for ($i=0; $i -lt 120; $i++) {
    try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1',[int]$p); $c.Close(); Start-Process "http://localhost:$p"; break }
    catch { Start-Sleep -Milliseconds 500 }
  }
} | Out-Null

# run the server in THIS window so its verbose log streams live to the console
$env:DEPLOY_UI_PORT = $Port
node $server
