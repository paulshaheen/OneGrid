@echo off
rem ============================================================================
rem  OneGrid Deployment Wizard - zero-terminal launcher.
rem  Double-click this file. It checks/installs Node.js + Azure CLI (via winget),
rem  opens your browser, and starts the local wizard. Azure sign-in happens on
rem  the first wizard screen - there is nothing to type here.
rem ============================================================================
title OneGrid Deployment Wizard
setlocal
set "HERE=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%deploy-ui\bootstrap.ps1"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo   The wizard exited with code %RC%.
  echo   Press any key to close this window.
  pause >nul
)
endlocal
