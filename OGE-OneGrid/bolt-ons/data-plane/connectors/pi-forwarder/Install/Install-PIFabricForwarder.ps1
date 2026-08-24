<#
.SYNOPSIS
    Install PIFabricForwarder as a Windows Service running under NetworkService.

.DESCRIPTION
    Copies binaries to Program Files, creates ProgramData directory, sets ACLs,
    and registers the service via sc.exe. After install, sets restart-on-failure
    behavior and starts the service.

.PARAMETER PublishDir
    Directory containing the published binaries (output of `dotnet publish`).

.PARAMETER InstallDir
    Where binaries are copied. Default: C:\Program Files\PIFabricForwarder

.PARAMETER DataDir
    Where queue.db, tags.json, and logs live. Default: C:\ProgramData\PIFabricForwarder

.EXAMPLE
    .\Install-PIFabricForwarder.ps1 -PublishDir .\publish
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $PublishDir,
    [string] $InstallDir = 'C:\Program Files\PIFabricForwarder',
    [string] $DataDir    = 'C:\ProgramData\PIFabricForwarder',
    [string] $ServiceName = 'PIFabricForwarder'
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

# Drop a starter tags.json if not present
$tagsPath = Join-Path $DataDir 'tags.json'
if (-not (Test-Path $tagsPath)) {
    $sample = Join-Path $InstallDir 'tags.sample.json'
    if (Test-Path $sample) {
        Copy-Item $sample $tagsPath
        Write-Host "Seeded $tagsPath from tags.sample.json (edit before starting!)"
    }
}

# Register / re-register the service
$exePath = Join-Path $InstallDir 'PIFabricForwarder.exe'
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

sc.exe description $ServiceName 'Forwards PI Web API events to Fabric Eventstream Custom Endpoint' | Out-Null
sc.exe failure     $ServiceName reset= 86400 actions= restart/30000/restart/30000/restart/60000 | Out-Null

Write-Host "Starting service..."
Start-Service $ServiceName
Start-Sleep -Seconds 3
Get-Service $ServiceName

Write-Host ""
Write-Host "Done. Verify with:"
Write-Host "  Get-Service $ServiceName"
Write-Host "  Get-Content '$DataDir\logs\*.log' -Tail 50"
Write-Host "  Get-WinEvent -LogName Application -ProviderName 'PIFabricForwarder' -MaxEvents 20"
