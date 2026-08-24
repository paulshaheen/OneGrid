<#
.SYNOPSIS
    Stop and remove the PIFabricForwarder Windows Service.
    Leaves ProgramData (queue.db, tags.json) intact unless -PurgeData is set.
#>
[CmdletBinding()]
param(
    [string] $ServiceName = 'PIFabricForwarder',
    [string] $InstallDir  = 'C:\Program Files\PIFabricForwarder',
    [string] $DataDir     = 'C:\ProgramData\PIFabricForwarder',
    [switch] $PurgeData
)

#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'

if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Host "Stopping $ServiceName..."
    Stop-Service $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-Host "Deleting service registration..."
    sc.exe delete $ServiceName | Out-Null
}

if (Test-Path $InstallDir) {
    Write-Host "Removing $InstallDir"
    Remove-Item $InstallDir -Recurse -Force
}

if ($PurgeData -and (Test-Path $DataDir)) {
    Write-Host "Purging $DataDir (per -PurgeData)"
    Remove-Item $DataDir -Recurse -Force
} elseif (Test-Path $DataDir) {
    Write-Host "Leaving $DataDir intact (use -PurgeData to remove queue + config)"
}

Write-Host "Done."
