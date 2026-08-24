@echo off
rem ============================================================================
rem  OneGrid Deployment Wizard - ONE-FILE launcher.
rem
rem  This is the only thing an end user needs. Download this file, double-click
rem  it. It fetches the wizard from the public repo, installs Node.js + Azure CLI
rem  if you don't have them, opens your browser, and starts the wizard.
rem
rem  No git, no clone, no npm, nothing to type. Azure sign-in is a button in the
rem  wizard itself.
rem ============================================================================
title OneGrid Deployment Wizard
setlocal
set "BOOT=https://raw.githubusercontent.com/paulshaheen/OGE-OneGrid/main/deploy-ui/bootstrap-online.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop';[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;$p=Join-Path $env:TEMP 'onegrid-bootstrap-online.ps1';try{Invoke-WebRequest -UseBasicParsing '%BOOT%' -OutFile $p}catch{Write-Host ('Could not reach GitHub: '+$_.Exception.Message) -ForegroundColor Red;Read-Host 'Press Enter to close';exit 1};& $p"
if errorlevel 1 (
  echo.
  echo   Launch failed - see the messages above.
  echo   Press any key to close this window.
  pause >nul
)
endlocal
