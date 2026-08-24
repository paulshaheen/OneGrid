<#
.SYNOPSIS
    Install DbFabricForwarder (SQL Server / Oracle -> Fabric) as a Windows Service.

.DESCRIPTION
    Copies binaries to Program Files, creates the ProgramData directory, sets ACLs,
    and registers the service via sc.exe. After install, sets restart-on-failure
    behavior and starts the service. Mirrors the PI connector's installer.

    Database connection strings are resolved at runtime from DBFWD_CONN_<NAME>
    machine environment variables (set by the deploy wizard's Data Plane step),
    never from disk.

.PARAMETER PublishDir
    Directory containing the published binaries (output of `dotnet publish`).

.EXAMPLE
    .\Install-DbFabricForwarder.ps1 -PublishDir .\publish
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $PublishDir,
    [string] $InstallDir  = 'C:\Program Files\DbFabricForwarder',
    [string] $DataDir     = 'C:\ProgramData\DbFabricForwarder',
    [string] $ServiceName = 'DbFabricForwarder'
)

#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $PublishDir)) {
    throw "PublishDir '$PublishDir' not found. Run 'dotnet publish -c Release -r win-x64 --self-contained false' first."
}

# Stop existing service if present
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Host "Stopping existing service $ServiceName..."
    Stop-Service $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# Install dirs
foreach ($d in @($InstallDir, $DataDir, (Join-Path $DataDir 'logs'))) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

# Copy binaries
Write-Host "Copying binaries from $PublishDir -> $InstallDir"
Copy-Item -Path (Join-Path $PublishDir '*') -Destination $InstallDir -Recurse -Force

# Grant NetworkService modify on ProgramData dir
Write-Host "Granting NetworkService modify on $DataDir"
icacls $DataDir /grant 'NT AUTHORITY\NetworkService:(OI)(CI)M' /T | Out-Null

# Drop a starter sources.json if not present
$sourcesPath = Join-Path $DataDir 'sources.json'
if (-not (Test-Path $sourcesPath)) {
    $sample = Join-Path $InstallDir 'sources.sample.json'
    if (Test-Path $sample) {
        Copy-Item $sample $sourcesPath
        Write-Host "Seeded $sourcesPath from sources.sample.json (edit before starting!)"
    }
}

# Register / re-register the service
$exePath = Join-Path $InstallDir 'DbFabricForwarder.exe'
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Host "Removing old service registration..."
    sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 2
}

Write-Host "Creating service $ServiceName..."
sc.exe create $ServiceName `
    binPath= "`"$exePath`"" `
    obj=     'NT AUTHORITY\NetworkService' `
    start=   auto | Out-Null

sc.exe description $ServiceName 'Forwards SQL Server / Oracle rows to Fabric Eventstream Custom Endpoint' | Out-Null
sc.exe failure     $ServiceName reset= 86400 actions= restart/30000/restart/30000/restart/60000 | Out-Null

Write-Host "Starting service..."
Start-Service $ServiceName
Start-Sleep -Seconds 3
Get-Service $ServiceName

Write-Host ""
Write-Host "Done. Verify with:"
Write-Host "  Get-Service $ServiceName"
Write-Host "  Get-Content '$DataDir\logs\*.log' -Tail 50"
Write-Host "  Get-WinEvent -LogName Application -ProviderName 'DbFabricForwarder' -MaxEvents 20"
