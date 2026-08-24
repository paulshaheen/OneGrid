# Launch the OneGrid deployment wizard (local web UI).
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = if ($env:DEPLOY_UI_PORT) { $env:DEPLOY_UI_PORT } else { 7333 }
Write-Host "Starting deployment wizard on http://localhost:$port ..." -ForegroundColor Cyan
Start-Process "http://localhost:$port"
node (Join-Path $here "server.js")
