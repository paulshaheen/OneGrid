<#
  bootstrap-online.ps1 - fetched and run by the one-file OneGrid-Wizard.cmd.

  The end user downloads a single small .cmd and double-clicks it. That .cmd
  pulls this script from the public repo and runs it. This script:
    1. downloads + extracts the lightweight wizard (OneGrid-Wizard.zip release asset)
       into %LOCALAPPDATA%\OneGrid-Wizard  (reused on later launches),
    2. hands off to the extracted deploy-ui\bootstrap.ps1, which installs Node +
       Azure CLI if missing, opens the browser, and starts the wizard.

  No git, no clone, no npm, no terminal. Azure sign-in is a button in the wizard.

  Overrides (optional env vars):
    ONEGRID_WIZARD_URL  - full URL to OneGrid-Wizard.zip
    ONEGRID_HOME        - install directory
    ONEGRID_FORCE       - '1' to force a fresh re-download
#>
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ZipUrl  = if ($env:ONEGRID_WIZARD_URL) { $env:ONEGRID_WIZARD_URL } else { 'https://github.com/paulshaheen/OGE-OneGrid/releases/latest/download/OneGrid-Wizard.zip' }
$Home_   = if ($env:ONEGRID_HOME) { $env:ONEGRID_HOME } else { Join-Path $env:LOCALAPPDATA 'OneGrid-Wizard' }
$Force   = ($env:ONEGRID_FORCE -eq '1')

function Info($m){ Write-Host "      ..  $m" -ForegroundColor DarkGray }
function Ok($m){ Write-Host "      OK  $m" -ForegroundColor Green }
function Step($n,$m){ Write-Host ''; Write-Host "  [$n] $m" -ForegroundColor Cyan }
function Die($m){ Write-Host ''; Write-Host "  ERROR  $m" -ForegroundColor Red; Write-Host ''; Read-Host '  Press Enter to close'; exit 1 }

Clear-Host
Write-Host ''
Write-Host '   ###########################################################' -ForegroundColor Blue
Write-Host '   #        O N E G R I D   Deployment  Wizard               #' -ForegroundColor White
Write-Host '   #        Microsoft Fabric solution accelerator            #' -ForegroundColor Gray
Write-Host '   ###########################################################' -ForegroundColor Blue
Write-Host ''
Info "install folder : $Home_"

$extractRoot = Join-Path $Home_ 'OneGrid-Wizard'      # zip root folder
$server      = Join-Path $extractRoot 'deploy-ui\server.js'
$innerBoot   = Join-Path $extractRoot 'deploy-ui\bootstrap.ps1'

function Test-Complete($root){
  (Test-Path (Join-Path $root 'deploy-ui\server.js')) -and
  (Test-Path (Join-Path $root 'deploy.ps1')) -and
  (Test-Path (Join-Path $root 'fabric\notebooks')) -and
  (Test-Path (Join-Path $root 'fabric\semanticmodel')) -and
  (Test-Path (Join-Path $root 'fabric\digitaltwinbuilder'))
}

Step 1 'Getting the latest wizard'
New-Item -ItemType Directory -Force -Path $Home_ | Out-Null
$zip = Join-Path $Home_ 'OneGrid-Wizard.zip'
$downloaded = $false
try {
  Info "downloading from $ZipUrl"
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest -UseBasicParsing -Uri $ZipUrl -OutFile $zip
  $downloaded = $true
  Ok ("downloaded {0} MB" -f [math]::Round((Get-Item $zip).Length/1MB,1))
} catch {
  if (Test-Complete $extractRoot) { Info "could not download ($($_.Exception.Message)); using the complete copy already on disk" }
  else { Die "could not download the wizard ($($_.Exception.Message)) and no complete copy is on disk. Check your connection and try again." }
}

if ($downloaded) {
  Step 2 'Extracting (clean)'
  # Always wipe any previous extraction so a partial or stale copy can never be reused.
  if (Test-Path $extractRoot) { Remove-Item $extractRoot -Recurse -Force -ErrorAction SilentlyContinue }
  if (Test-Path $extractRoot) {
    # leftovers are locked (e.g. a running wizard) - extract into a fresh versioned folder instead
    $Home_ = Join-Path $Home_ ("v" + (Get-Date -Format 'yyyyMMddHHmmss'))
    New-Item -ItemType Directory -Force -Path $Home_ | Out-Null
    $extractRoot = Join-Path $Home_ 'OneGrid-Wizard'
    Info "previous copy was locked; installing a fresh copy in $Home_"
  }
  Expand-Archive -Path $zip -DestinationPath $Home_ -Force
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
  if (-not (Test-Path (Join-Path $extractRoot 'deploy-ui\server.js'))) {
    $found = Get-ChildItem $Home_ -Recurse -Filter server.js -ErrorAction SilentlyContinue |
             Where-Object { $_.FullName -match '\\deploy-ui\\server\.js$' } | Select-Object -First 1
    if ($found) { $extractRoot = Split-Path (Split-Path $found.FullName -Parent) -Parent }
  }
  if (-not (Test-Complete $extractRoot)) { Die "extraction was incomplete under $extractRoot (missing deploy.ps1 or fabric\notebooks). Delete $Home_ and run this again." }
  Ok "extracted to $extractRoot"
}

$server    = Join-Path $extractRoot 'deploy-ui\server.js'
$innerBoot = Join-Path $extractRoot 'deploy-ui\bootstrap.ps1'

Step 3 'Starting the wizard'
if (-not (Test-Path $innerBoot)) { Die "launcher not found: $innerBoot" }

# If a wizard is already running on the port, just open it (don't start a second one).
$port = if ($env:DEPLOY_UI_PORT) { $env:DEPLOY_UI_PORT } else { 7333 }
try {
  $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1',[int]$port); $c.Close()
  Write-Host ''
  Write-Host "   The wizard is already running on port $port - opening it in your browser." -ForegroundColor Yellow
  Write-Host "   (To restart fresh, close the other wizard window first.)" -ForegroundColor DarkGray
  Start-Process "http://localhost:$port"
  return
} catch {}

# Hand off to the packaged launcher (installs Node + Azure CLI if needed, opens browser, runs server).
& $innerBoot
