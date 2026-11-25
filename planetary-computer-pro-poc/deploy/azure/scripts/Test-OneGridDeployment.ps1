#Requires -Version 7.0
<#
.SYNOPSIS
  Runs the OneGrid acceptance checks against a finished deployment and records the evidence.

.DESCRIPTION
  Automates the "Acceptance checks" table in docs/deployment-and-data-guide.md. Every result is
  tagged with the table row it provides evidence for:

    Provisioning    ARM deployment state, failed operations, deployment-script state and log tail,
                    app/Fabric phase results (deployExit), and the resource inventory.
    App             Web app state, package mount (WEBSITE_RUN_FROM_PACKAGE), /api/health, /api/status
                    and /webapp/app (the endpoints served by OGE-OneGrid/report-app/server/index.js).
    Sign-in         ENTRA_CLIENT_ID wiring and the SPA redirect URI https://<app-host>/auth/callback.
    Fabric target   Workspace, capacity, expected items (lakehouse, eventhouse, KQL database,
                    OneGridModelImport, data agent), the app's /api/health target, and the app
                    identity's workspace role. Fabric REST with a token from
                    az account get-access-token --resource https://api.fabric.microsoft.com.
    Semantic model  Latest refresh and bound data source of the app's dataset (Power BI REST).
    Telemetry       PiEvents row count and latest ingestion time (Kusto REST).
    Asset context   /api/watchlist returns rows.
    Geospatial      GeoCatalog state, STAC endpoint reachability, sample-assets container, app wiring.
    AI              Azure OpenAI model deployment and the app's AI_DEFAULT_MODEL.
    Weather         Aurora endpoint, model deployment, forecast job and its latest execution,
                    weather-events.json schema, input cycle and publication time.
    Governance      The governance review endpoint rejects an unauthenticated request.
    Operations      Facts for the operations review (manual).

  Parts of a row that need a person (an authorized user journey, a grounded chat answer, expected
  counts) are recorded as MANUAL. Disabled components are recorded as N/A, never as PASS, and rows
  skipped with -SkipFabric or -SkipWeather as SKIPPED.

  Read-only: it never changes Azure, Fabric or app state. Secret values (app settings outside a
  short allow-list, tokens, keys) are never written to the console or the evidence file, and the
  deployment-script log tails are redacted.

.PARAMETER ResourceGroupName
  Resource group that holds the deployment.

.PARAMETER DeploymentName
  Name of the resource-group deployment (for example onegrid).

.PARAMETER SubscriptionId
  Subscription of the resource group. Defaults to the Azure CLI's current subscription.

.PARAMETER OutputPath
  JSON evidence file. Defaults to onegrid-acceptance-<timestamp>.json in the current directory.

.PARAMETER SkipFabric
  Skip the Fabric target, Semantic model, Telemetry and Asset context rows (for example when the
  caller has no Fabric workspace access).

.PARAMETER SkipWeather
  Skip the Weather row.

.EXAMPLE
  ./Test-OneGridDeployment.ps1 -ResourceGroupName onegrid-rg -DeploymentName onegrid

.EXAMPLE
  ./Test-OneGridDeployment.ps1 -ResourceGroupName onegrid-rg -DeploymentName onegrid `
    -SubscriptionId 00000000-0000-0000-0000-000000000000 -OutputPath .\evidence\onegrid-acceptance.json -SkipWeather

.OUTPUTS
  A summary table per acceptance row on the host and the JSON evidence file. Exit code 1 when any
  check FAILs, otherwise 0.

.NOTES
  Requires PowerShell 7 and the Azure CLI signed in (az login) as an account with Reader on the
  resource group; reading app settings needs Website Contributor or Contributor. The Fabric, Power BI
  and Kusto checks need workspace access; the GeoCatalog and blob checks need the GeoCatalog
  Reader/Administrator and Storage Blob Data Reader roles and report WARN without them.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string] $ResourceGroupName,

    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string] $DeploymentName,

    [ValidatePattern('^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$')]
    [string] $SubscriptionId,

    [string] $OutputPath = ("onegrid-acceptance-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss')),

    [switch] $SkipFabric,

    [switch] $SkipWeather
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$env:PYTHONUTF8 = '1'

$ToolVersion = '1.0.0'
$ArmBase = 'https://management.azure.com'
$FabricApi = 'https://api.fabric.microsoft.com/v1'
$PowerBiApi = 'https://api.powerbi.com/v1.0/myorg'
# Default GeoCatalog data-plane API version used by the web app
# (OGE-OneGrid/webapp/src/lib/services/azure/server.ts, DEFAULT_GEOCATALOG_API_VERSION).
$DefaultGeoCatalogApiVersion = '2026-04-15'
# App settings whose values are safe to record (identifiers and URLs, no secrets).
$RecordedSettings = @(
    'WEBSITE_RUN_FROM_PACKAGE', 'ONEGRID_MODULES', 'AI_DEFAULT_MODEL', 'FOUNDRY_DEPLOYMENT', 'AI_PROVIDER',
    'GEOCATALOG_URI', 'GEOCATALOG_API_VERSION', 'AURORA_ENDPOINT', 'AURORA_MODEL_DEPLOYED', 'AURORA_JOB_NAME',
    'PBI_WORKSPACE', 'PBI_DATASET', 'KUSTO_CLUSTER', 'KUSTO_DATABASE', 'ENTRA_CLIENT_ID', 'ENTRA_TENANT_ID',
    'GOVERNANCE_REQUIRE_AUTH', 'REPORT_API_ENABLED', 'WEBSITE_NODE_DEFAULT_VERSION'
)
$AcceptanceRows = @('Provisioning', 'App', 'Sign-in', 'Fabric target', 'Semantic model', 'Telemetry',
    'Asset context', 'Geospatial', 'AI', 'Weather', 'Governance', 'Operations')

$script:Checks = [System.Collections.Generic.List[object]]::new()
$subArgs = if ($SubscriptionId) { @('--subscription', $SubscriptionId) } else { @() }

# ------------------------------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------------------------------
function Add-Check {
    param(
        [Parameter(Mandatory)] [ValidateScript({ $_ -in $AcceptanceRows })] [string] $Row,
        [Parameter(Mandatory)] [string] $Check,
        [Parameter(Mandatory)] [ValidateSet('PASS', 'WARN', 'FAIL', 'N/A', 'SKIPPED', 'MANUAL')] [string] $Status,
        [string] $Detail = '',
        [string] $Fix = '',
        [System.Collections.IDictionary] $Evidence
    )
    $script:Checks.Add([pscustomobject]@{
            Row      = $Row
            Check    = $Check
            Status   = $Status
            Detail   = $Detail
            Fix      = $(if ($Status -in 'WARN', 'FAIL') { $Fix } else { '' })
            Evidence = $Evidence
        })
    $color = switch ($Status) { 'PASS' { 'Green' } 'WARN' { 'Yellow' } 'FAIL' { 'Red' } 'MANUAL' { 'Cyan' } default { 'DarkGray' } }
    Write-Host ('[{0}] {1,-7} {2} | {3}: {4}' -f (Get-Date -Format 'HH:mm:ss'), $Status, $Row, $Check, $Detail) -ForegroundColor $color
    if ($Fix -and $Status -in 'WARN', 'FAIL') { Write-Host "                    fix: $Fix" -ForegroundColor DarkYellow }
}

function Invoke-AzCli {
    # Runs az with --only-show-errors and JSON output; never throws. Returns Ok/Json/Text/Error.
    param(
        [Parameter(Mandatory)] [string[]] $Arguments,
        [switch] $NoJson
    )
    $all = @($Arguments) + @('--only-show-errors')
    if (-not $NoJson) { $all += @('--output', 'json') }
    $stdout = [System.Collections.Generic.List[string]]::new()
    $stderr = [System.Collections.Generic.List[string]]::new()
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & az @all 2>&1 | ForEach-Object {
            if ($_ -is [System.Management.Automation.ErrorRecord]) { $stderr.Add($_.ToString()) } else { $stdout.Add([string]$_) }
        }
        $code = $LASTEXITCODE
    } catch {
        $stderr.Add($_.Exception.Message)
        $code = 1
    } finally {
        $ErrorActionPreference = $previous
    }
    $text = ($stdout -join "`n").Trim()
    $json = $null
    if ($code -eq 0 -and -not $NoJson -and $text) {
        try { $json = $text | ConvertFrom-Json -Depth 64 } catch { $json = $null }
    }
    $message = (($stderr -join ' ') -replace '\s+', ' ').Trim()
    if ($message.Length -gt 300) { $message = $message.Substring(0, 300) + '...' }
    [pscustomobject]@{ Ok = ($code -eq 0); Json = $json; Text = $text; Error = $message }
}

function Get-AccessToken {
    param([Parameter(Mandatory)] [string] $Resource)
    $r = Invoke-AzCli -Arguments (@('account', 'get-access-token', '--resource', $Resource) + $subArgs)
    if ($r.Ok -and $r.Json.accessToken) { return $r.Json.accessToken }
    return $null
}

function Invoke-Http {
    # HTTP request that never throws; retries connection failures and 5xx (cold starts).
    param(
        [Parameter(Mandatory)] [string] $Uri,
        [hashtable] $Headers = @{},
        [string] $Method = 'GET',
        [string] $Body,
        [int] $TimeoutSec = 60,
        [int] $Attempts = 1,
        [int] $MaximumRedirection = 5
    )
    for ($i = 1; $i -le $Attempts; $i++) {
        try {
            $request = @{
                Uri                = $Uri
                Method             = $Method
                Headers            = $Headers
                TimeoutSec         = $TimeoutSec
                SkipHttpErrorCheck = $true
                MaximumRedirection = $MaximumRedirection
                ErrorAction        = 'Stop'
            }
            if ($Body) { $request.Body = $Body; $request.ContentType = 'application/json; charset=utf-8' }
            $response = Invoke-WebRequest @request
            $status = [int]$response.StatusCode
            if ($status -lt 500 -or $i -eq $Attempts) {
                $content = if ($response.Content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($response.Content) } else { [string]$response.Content }
                $json = $null
                try { if ($content) { $json = $content | ConvertFrom-Json -Depth 64 } } catch { $json = $null }
                return [pscustomobject]@{
                    Status      = $status
                    Content     = $content
                    Json        = $json
                    ContentType = (@($response.Headers['Content-Type']) -join ';')
                    Error       = $null
                }
            }
        } catch {
            if ($i -eq $Attempts) { return [pscustomobject]@{ Status = 0; Content = ''; Json = $null; ContentType = ''; Error = $_.Exception.Message } }
        }
        Start-Sleep -Seconds 15
    }
}

function Get-JsonWithToken {
    param([string] $Uri, [string] $Token)
    Invoke-Http -Uri $Uri -Headers @{ Authorization = "Bearer $Token" }
}

function Protect-LogText {
    # Redact anything that looks like a credential before a log line is shown or stored.
    param([string] $Text)
    $t = $Text -replace 'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}', '<redacted-token>'
    $t = $t -replace '(?i)(AccountKey=|SharedAccessSignature=|sig=)[^;&\s]+', '$1<redacted>'
    $t = $t -replace '(?i)\b((?:client_?secret|secret|password|pwd|api[_-]?key|access[_-]?key|token)\s*[:=]\s*)[^\s,;]+', '$1<redacted>'
    return $t
}

function Get-Output {
    param([string] $Name)
    if ($null -eq $outputs) { return $null }
    $o = $outputs.PSObject.Properties[$Name]
    if ($o) { return $o.Value.value }
    return $null
}

function Get-DeploymentParameter {
    param([string] $Name, $Default = $null)
    $p = if ($deployment) { $deployment.properties.parameters.PSObject.Properties[$Name] } else { $null }
    if ($p -and $null -ne $p.Value.value) { return $p.Value.value }
    return $Default
}

function Test-Deployed {
    param($Value)
    return ($null -ne $Value -and [string]$Value -ne '' -and [string]$Value -ne 'not-deployed' -and [string]$Value -ne 'not-applicable')
}

function Get-ProvisionerName {
    # Fabric item names come from the provisioner's config block (onegrid-solution-provision.ps1).
    param([string] $Key, [string] $Default)
    $path = Join-Path $PSScriptRoot 'onegrid-solution-provision.ps1'
    if (Test-Path -LiteralPath $path) {
        $m = [regex]::Match((Get-Content -LiteralPath $path -Raw), "(?m)^\s*$Key\s*=\s*'([^']+)'")
        if ($m.Success) { return $m.Groups[1].Value }
    }
    return $Default
}

# ------------------------------------------------------------------------------------------
# Context and deployment
# ------------------------------------------------------------------------------------------
Write-Host "OneGrid acceptance checks $ToolVersion - $ResourceGroupName / $DeploymentName" -ForegroundColor Cyan
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    Write-Host 'The Azure CLI (az) is required: https://aka.ms/installazurecli' -ForegroundColor Red
    exit 1
}
$account = Invoke-AzCli -Arguments (@('account', 'show') + $subArgs)
if (-not $account.Ok) {
    Write-Host "Not signed in to the Azure CLI or no access to the subscription: $($account.Error). Run az login." -ForegroundColor Red
    exit 1
}
$subscription = $account.Json
if (-not $SubscriptionId) { $SubscriptionId = [string]$subscription.id; $subArgs = @('--subscription', $SubscriptionId) }

$deploymentResult = Invoke-AzCli -Arguments (@('deployment', 'group', 'show', '--resource-group', $ResourceGroupName, '--name', $DeploymentName) + $subArgs)
$deployment = $deploymentResult.Json
$outputs = $null
if (-not $deploymentResult.Ok -or -not $deployment) {
    Add-Check -Row 'Provisioning' -Check 'ARM deployment' -Status FAIL -Detail "deployment '$DeploymentName' not found in $($ResourceGroupName): $($deploymentResult.Error)" -Fix 'Check the names: az deployment group list --resource-group <rg> -o table'
} else {
    $outputs = $deployment.properties.outputs
}

# ------------------------------------------------------------------------------------------
# Provisioning
# ------------------------------------------------------------------------------------------
$appEnabled = [bool](Get-Output 'oneGridAppEnabled')
$fabricEnabled = [bool](Get-Output 'fabricPlaneEnabled')
$geoCatalogId = Get-Output 'geoCatalogResourceId'
$auroraWorkspace = Get-Output 'auroraWorkspace'

if ($deployment) {
    $props = $deployment.properties
    $state = [string]$props.provisioningState
    $deploymentEvidence = [ordered]@{
        deploymentId  = $deployment.id
        correlationId = $props.correlationId
        timestamp     = $props.timestamp
        duration      = $props.duration
        templateHash  = $props.templateHash
    }
    switch ($state) {
        'Succeeded' { Add-Check -Row 'Provisioning' -Check 'ARM deployment state' -Status PASS -Detail "Succeeded at $($props.timestamp) (duration $($props.duration))" -Evidence $deploymentEvidence }
        { $_ -in 'Running', 'Accepted', 'Deploying', 'Validating' } { Add-Check -Row 'Provisioning' -Check 'ARM deployment state' -Status WARN -Detail "$state; re-run when it finishes" -Fix 'Poll with az deployment group show ... --query properties.provisioningState' -Evidence $deploymentEvidence }
        default {
            $err = if ($props.error) { "$($props.error.code): $($props.error.message)" } else { '' }
            if ($err.Length -gt 400) { $err = $err.Substring(0, 400) + '...' }
            Add-Check -Row 'Provisioning' -Check 'ARM deployment state' -Status FAIL -Detail "$state $err" -Fix 'See the failed operations below and DEPLOY-WITH-COPILOT.md Troubleshooting.' -Evidence $deploymentEvidence
        }
    }

    $operations = Invoke-AzCli -Arguments (@('deployment', 'operation', 'group', 'list', '--resource-group', $ResourceGroupName, '--name', $DeploymentName) + $subArgs)
    if ($operations.Ok) {
        $failedOps = @($operations.Json | Where-Object { $_.properties.provisioningState -eq 'Failed' })
        if ($failedOps.Count) {
            $list = @($failedOps | ForEach-Object {
                    $target = $_.properties.targetResource
                    $msg = $_.properties.statusMessage.error
                    $text = if ($msg) { "$($msg.code): $($msg.message)" } else { [string]$_.properties.statusCode }
                    if ($text.Length -gt 200) { $text = $text.Substring(0, 200) + '...' }
                    "$($target.resourceType)/$($target.resourceName) - $text"
                })
            Add-Check -Row 'Provisioning' -Check 'Failed operations' -Status FAIL -Detail ($list -join ' | ') -Fix 'Fix the cause and redeploy (the template is idempotent).' -Evidence ([ordered]@{ failed = $list })
        } else {
            Add-Check -Row 'Provisioning' -Check 'Failed operations' -Status PASS -Detail "none of $(@($operations.Json).Count) operations failed"
        }
    } else {
        Add-Check -Row 'Provisioning' -Check 'Failed operations' -Status WARN -Detail "cannot list operations: $($operations.Error)"
    }

    # Deployment scripts (in-template provisioners). retentionInterval is P1D, so the script
    # resources disappear a day after the run; the phase results stay in the outputs.
    $expectedScripts = [ordered]@{}
    if ($appEnabled) { $expectedScripts['pcpro-onegrid-provision-app'] = 'app plane' }
    if ($fabricEnabled) { $expectedScripts['pcpro-onegrid-provision-fabric'] = 'Fabric plane' }
    if ([bool](Get-Output 'auroraScheduleDeployed') -and (Test-Deployed (Get-Output 'auroraAcrName'))) { $expectedScripts['pcpro-aurora-image-build'] = 'Aurora image build' }
    $scripts = Invoke-AzCli -Arguments (@('deployment-scripts', 'list', '--resource-group', $ResourceGroupName) + $subArgs)
    $present = if ($scripts.Ok) { @($scripts.Json) } else { @() }
    foreach ($name in $expectedScripts.Keys) {
        $scriptResource = $present | Where-Object { $_.name -eq $name } | Select-Object -First 1
        if (-not $scriptResource) {
            $why = if ($scripts.Ok) { 'script resource not found (deleted after the 1-day retention interval, or never created)' } else { "cannot list deployment scripts: $($scripts.Error)" }
            Add-Check -Row 'Provisioning' -Check "Deployment script $name" -Status WARN -Detail $why -Fix 'Use the phase results below; re-run the deployment to get a fresh log if needed.'
            continue
        }
        $scriptState = [string]$scriptResource.properties.provisioningState
        $logResult = Invoke-AzCli -Arguments (@('deployment-scripts', 'show-log', '--resource-group', $ResourceGroupName, '--name', $name) + $subArgs)
        $logText = if ($logResult.Ok -and $logResult.Json -and $logResult.Json.log) { [string]$logResult.Json.log } elseif ($logResult.Ok) { $logResult.Text } else { '' }
        $lines = @($logText -split "`r?`n" | Where-Object { $_.Trim() })
        $tail = @($lines | Select-Object -Last 15 | ForEach-Object { Protect-LogText $_ })
        $issueLines = @($lines | Where-Object { $_ -match '(?i)\b(FAIL(ED)?|ERROR|exception|finished with issues)\b' }).Count
        $evidence = [ordered]@{ provisioningState = $scriptState; logLines = $lines.Count; issueLines = $issueLines; logTail = $tail }
        if ($scriptState -eq 'Succeeded') {
            $status = if ($issueLines) { 'WARN' } else { 'PASS' }
            Add-Check -Row 'Provisioning' -Check "Deployment script $name" -Status $status -Detail "Succeeded ($($expectedScripts[$name])); $($lines.Count) log lines, $issueLines with error/fail markers" -Fix "Review the log: az deployment-scripts show-log --resource-group $ResourceGroupName --name $name" -Evidence $evidence
        } elseif ($scriptState -in 'Running', 'Creating', 'ProvisioningResources') {
            Add-Check -Row 'Provisioning' -Check "Deployment script $name" -Status WARN -Detail "$scriptState ($($expectedScripts[$name]))" -Fix 'Wait for it to finish; the Fabric plane can run for 2-3 hours.' -Evidence $evidence
        } else {
            $err = $scriptResource.properties.status.error
            $errText = if ($err) { "$($err.code): $($err.message)" } else { '' }
            if ($errText.Length -gt 300) { $errText = $errText.Substring(0, 300) + '...' }
            Add-Check -Row 'Provisioning' -Check "Deployment script $name" -Status FAIL -Detail "$scriptState $errText" -Fix "Read the log: az deployment-scripts show-log --resource-group $ResourceGroupName --name $name" -Evidence $evidence
        }
        if ($tail.Count) {
            Write-Host "    last log lines of $($name):" -ForegroundColor DarkGray
            $tail | Select-Object -Last 6 | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
        }
    }

    foreach ($plane in @(
            @{ Output = 'appPlaneProvisionResult'; Name = 'App plane phases'; Enabled = $appEnabled },
            @{ Output = 'fabricPlaneProvisionResult'; Name = 'Fabric plane phases'; Enabled = $fabricEnabled })) {
        if (-not $plane.Enabled) {
            Add-Check -Row 'Provisioning' -Check $plane.Name -Status 'N/A' -Detail 'plane not deployed'
            continue
        }
        $result = Get-Output $plane.Output
        $exit = if ($result) { $result.deployExit } else { $null }
        $evidence = [ordered]@{ phases = $result.phases; deployExit = $exit; workspaceId = $result.workspaceId; appUrl = $result.appUrl }
        if ($null -eq $exit) {
            Add-Check -Row 'Provisioning' -Check $plane.Name -Status WARN -Detail "no result in output $($plane.Output) (the script did not finish or was skipped)" -Fix 'Check the deployment-script state above.' -Evidence $evidence
        } elseif ([int]$exit -eq 0) {
            Add-Check -Row 'Provisioning' -Check $plane.Name -Status PASS -Detail "deploy.ps1 exit 0; phases $($result.phases)" -Evidence $evidence
        } else {
            Add-Check -Row 'Provisioning' -Check $plane.Name -Status FAIL -Detail "deploy.ps1 exit $exit; phases $($result.phases)" -Fix 'The log lists the per-phase summary; fix and redeploy (phases are idempotent).' -Evidence $evidence
        }
    }

    $inventory = Invoke-AzCli -Arguments (@('resource', 'list', '--resource-group', $ResourceGroupName) + $subArgs)
    if ($inventory.Ok) {
        $byType = [ordered]@{}
        foreach ($r in @($inventory.Json | Sort-Object type, name)) {
            if (-not $byType.Contains($r.type)) { $byType[$r.type] = [System.Collections.Generic.List[string]]::new() }
            $byType[$r.type].Add([string]$r.id)
        }
        Add-Check -Row 'Provisioning' -Check 'Selected resource IDs' -Status PASS -Detail "$(@($inventory.Json).Count) resources of $($byType.Count) types recorded" -Evidence $byType
    } else {
        Add-Check -Row 'Provisioning' -Check 'Selected resource IDs' -Status WARN -Detail "cannot list resources: $($inventory.Error)"
    }
}

# ------------------------------------------------------------------------------------------
# App, sign-in and governance (the OneGrid web app)
# ------------------------------------------------------------------------------------------
$appUrl = [string](Get-Output 'oneGridAppUrl')
$appName = $null
$appSettings = @{}
$appPrincipalId = $null
$health = $null
if (-not $appEnabled -or -not (Test-Deployed $appUrl)) {
    foreach ($row in 'App', 'Sign-in', 'Governance') { Add-Check -Row $row -Check 'OneGrid web app' -Status 'N/A' -Detail 'deployOneGridApp was off (or the Fabric plane it needs)' }
} else {
    $appUrl = $appUrl.TrimEnd('/')
    $appHost = ([uri]$appUrl).Host
    $appName = $appHost.Split('.')[0]
    $site = Invoke-AzCli -Arguments (@('webapp', 'show', '--resource-group', $ResourceGroupName, '--name', $appName) + $subArgs)
    if ($site.Ok) {
        $appPrincipalId = [string]$site.Json.identity.principalId
        $siteEvidence = [ordered]@{ name = $appName; state = $site.Json.state; httpsOnly = $site.Json.httpsOnly; defaultHostName = $site.Json.defaultHostName }
        if ($site.Json.state -eq 'Running') {
            Add-Check -Row 'App' -Check 'Web app state' -Status PASS -Detail "$appName is Running (httpsOnly=$($site.Json.httpsOnly))" -Evidence $siteEvidence
        } else {
            Add-Check -Row 'App' -Check 'Web app state' -Status FAIL -Detail "$appName is $($site.Json.state)" -Fix "az webapp start --resource-group $ResourceGroupName --name $appName" -Evidence $siteEvidence
        }
    } else {
        Add-Check -Row 'App' -Check 'Web app state' -Status FAIL -Detail "cannot read web app $($appName): $($site.Error)" -Fix 'Check the oneGridAppUrl output and your access to the resource group.'
    }

    $settingsResult = Invoke-AzCli -Arguments (@('webapp', 'config', 'appsettings', 'list', '--resource-group', $ResourceGroupName, '--name', $appName) + $subArgs)
    if ($settingsResult.Ok) {
        foreach ($s in @($settingsResult.Json)) { $appSettings[[string]$s.name] = [string]$s.value }
        $recorded = [ordered]@{}
        foreach ($name in $RecordedSettings) { if ($appSettings.ContainsKey($name)) { $recorded[$name] = $appSettings[$name] } }
        $recorded['settingNames'] = @($appSettings.Keys | Sort-Object)
        $package = $appSettings['WEBSITE_RUN_FROM_PACKAGE']
        $storageAccount = [string](Get-Output 'sampleStorageAccount')
        if (-not $package) {
            Add-Check -Row 'App' -Check 'Application package' -Status FAIL -Detail 'WEBSITE_RUN_FROM_PACKAGE is not set; the app has no code to run' -Fix 'Re-run the deployment so the app plane re-applies its settings.' -Evidence $recorded
        } elseif ($storageAccount -and $package -match "^https://$([regex]::Escape($storageAccount))\.blob\.") {
            Add-Check -Row 'App' -Check 'Application package' -Status PASS -Detail "mounted from private storage ($package)" -Evidence $recorded
        } else {
            Add-Check -Row 'App' -Check 'Application package' -Status WARN -Detail "mounted from $package, not re-hosted in $storageAccount" -Fix 'The provisioner upgrades the setting only after a verified upload; check the app-plane log for the re-host step.' -Evidence $recorded
        }
    } else {
        Add-Check -Row 'App' -Check 'Application package' -Status WARN -Detail "cannot read app settings (needs Website Contributor or Contributor): $($settingsResult.Error)"
    }

    $healthResponse = Invoke-Http -Uri "$appUrl/api/health" -Attempts 3 -TimeoutSec 60
    if ($healthResponse.Status -eq 200 -and $healthResponse.Json.ok -eq $true) {
        $health = $healthResponse.Json
        Add-Check -Row 'App' -Check 'GET /api/health' -Status PASS -Detail "200 ok; target workspace $($health.target.workspaceId), dataset $($health.target.datasetId), dataAgent=$($health.dataAgent)" -Evidence ([ordered]@{ target = $health.target; dataAgent = $health.dataAgent; manuals = $health.manuals })
    } else {
        $why = if ($healthResponse.Error) { $healthResponse.Error } else { "HTTP $($healthResponse.Status)" }
        Add-Check -Row 'App' -Check 'GET /api/health' -Status FAIL -Detail $why -Fix "The first request after a deployment can take minutes. Check az webapp log tail --resource-group $ResourceGroupName --name $appName"
    }

    $statusResponse = Invoke-Http -Uri "$appUrl/api/status" -Attempts 2 -TimeoutSec 90
    $st = $statusResponse.Json
    if ($statusResponse.Status -eq 200 -and $st) {
        $ev = [ordered]@{ ok = $st.ok; configured = $st.configured; capacityPaused = $st.capacityPaused; capacityState = $st.capacityState; message = $st.message }
        if ($st.ok -eq $true) {
            Add-Check -Row 'App' -Check 'GET /api/status' -Status PASS -Detail "live data available$(if ($st.capacityState) { " (capacity $($st.capacityState))" })" -Evidence $ev
        } elseif ($st.capacityPaused -eq $true) {
            Add-Check -Row 'App' -Check 'GET /api/status' -Status WARN -Detail 'the Fabric capacity is paused' -Fix 'Resume the capacity, then re-run.' -Evidence $ev
        } elseif ($st.configured -eq $false) {
            $status = if ($fabricEnabled) { 'FAIL' } else { 'WARN' }
            Add-Check -Row 'App' -Check 'GET /api/status' -Status $status -Detail 'no Fabric target is configured for the app (PBI_WORKSPACE/PBI_DATASET unset)' -Fix 'Check the Fabric plane phases (semantic/unified/chatagent) in the provisioning results.' -Evidence $ev
        } else {
            Add-Check -Row 'App' -Check 'GET /api/status' -Status FAIL -Detail "$($st.message)" -Fix 'Check the app identity''s access to the workspace and semantic model (Fabric target row).' -Evidence $ev
        }
    } else {
        $why = if ($statusResponse.Error) { $statusResponse.Error } else { "HTTP $($statusResponse.Status)" }
        Add-Check -Row 'App' -Check 'GET /api/status' -Status FAIL -Detail $why
    }

    $webappResponse = Invoke-Http -Uri "$appUrl/webapp/app" -Attempts 2 -TimeoutSec 90
    if ($webappResponse.Status -eq 200 -and $webappResponse.ContentType -match 'text/html') {
        Add-Check -Row 'App' -Check 'GET /webapp/app' -Status PASS -Detail "200 text/html ($($webappResponse.Content.Length) bytes)"
    } else {
        $why = if ($webappResponse.Error) { $webappResponse.Error } else { "HTTP $($webappResponse.Status) $($webappResponse.ContentType)" }
        Add-Check -Row 'App' -Check 'GET /webapp/app' -Status FAIL -Detail $why -Fix 'The SSR web app runs as a child of report-app; check the app log for webapp start errors.'
    }

    # Sign-in
    $signInEnabled = [bool](Get-DeploymentParameter 'enableEntraSignIn' $true)
    $clientId = $appSettings['ENTRA_CLIENT_ID']
    if (-not $signInEnabled) {
        Add-Check -Row 'Sign-in' -Check 'Entra sign-in wiring' -Status 'N/A' -Detail 'enableEntraSignIn was false'
    } elseif (-not $clientId) {
        Add-Check -Row 'Sign-in' -Check 'Entra sign-in wiring' -Status WARN -Detail 'ENTRA_CLIENT_ID is not set, so the sign-in tile is unconfigured' -Fix 'Supply entraSignInClientId or enable grantProvisionerGraphPermission and redeploy.'
    } else {
        $registration = Invoke-AzCli -Arguments @('ad', 'app', 'show', '--id', $clientId)
        $redirect = "https://$appHost/auth/callback"
        if ($registration.Ok) {
            $uris = @($registration.Json.spa.redirectUris)
            if ($uris -contains $redirect) {
                Add-Check -Row 'Sign-in' -Check 'Entra sign-in wiring' -Status PASS -Detail "app $clientId has SPA redirect $redirect" -Evidence ([ordered]@{ clientId = $clientId; tenantId = $appSettings['ENTRA_TENANT_ID']; redirectUris = $uris })
            } else {
                Add-Check -Row 'Sign-in' -Check 'Entra sign-in wiring' -Status FAIL -Detail "app $clientId lacks the SPA redirect $redirect" -Fix 'Add it: DEPLOY-WITH-COPILOT.md step 2.6 shows the az rest PATCH.' -Evidence ([ordered]@{ clientId = $clientId; redirectUris = $uris })
            }
        } else {
            Add-Check -Row 'Sign-in' -Check 'Entra sign-in wiring' -Status WARN -Detail "cannot read app registration $($clientId): $($registration.Error)" -Fix 'Check the registration in Entra ID > App registrations.'
        }
    }
    Add-Check -Row 'Sign-in' -Check 'User journey (manual)' -Status MANUAL -Detail 'sign in as an authorized user and confirm protected-data requests without permission are denied'

    # Governance: the review plane rejects unauthenticated callers when GOVERNANCE_REQUIRE_AUTH=1
    # (report-app/server/governance.js isAuthorized).
    $govResponse = Invoke-Http -Uri "$appUrl/api/governance/posture" -TimeoutSec 60
    if ($govResponse.Status -in 401, 403) {
        Add-Check -Row 'Governance' -Check 'Unauthenticated governance request' -Status PASS -Detail "denied (HTTP $($govResponse.Status))"
    } elseif ($appSettings['GOVERNANCE_REQUIRE_AUTH'] -eq '1') {
        $why = if ($govResponse.Error) { $govResponse.Error } else { "HTTP $($govResponse.Status)" }
        Add-Check -Row 'Governance' -Check 'Unauthenticated governance request' -Status FAIL -Detail "GOVERNANCE_REQUIRE_AUTH=1 but the request without credentials returned $why" -Fix 'Governance endpoints must deny callers without the Governance.Reader role.'
    } else {
        $setting = if ($appSettings.Count) { 'GOVERNANCE_REQUIRE_AUTH is not 1' } else { 'app settings unreadable' }
        Add-Check -Row 'Governance' -Check 'Unauthenticated governance request' -Status WARN -Detail "/api/governance/* answered HTTP $($govResponse.Status) without sign-in ($setting)" -Fix 'Set GOVERNANCE_REQUIRE_AUTH=1 with App Service authentication when governance data must be restricted.'
    }
    Add-Check -Row 'Governance' -Check 'Data access matrix (manual)' -Status MANUAL -Detail 'positive and negative access through the API, DAX/KQL, chat, SQL and export paths'
}

# ------------------------------------------------------------------------------------------
# Fabric target, semantic model, telemetry, asset context
# ------------------------------------------------------------------------------------------
$fabricRows = 'Fabric target', 'Semantic model', 'Telemetry', 'Asset context'
if (-not $fabricEnabled) {
    foreach ($row in $fabricRows) { Add-Check -Row $row -Check 'Fabric plane' -Status 'N/A' -Detail 'deployFabricPlane was off (or sample storage it needs)' }
} elseif ($SkipFabric) {
    foreach ($row in $fabricRows) { Add-Check -Row $row -Check 'Fabric plane' -Status SKIPPED -Detail '-SkipFabric' }
} else {
    $fabricResult = Get-Output 'fabricPlaneProvisionResult'
    $workspaceId = @([string]$fabricResult.workspaceId, [string]$health.target.workspaceId, $appSettings['PBI_WORKSPACE']) | Where-Object { $_ } | Select-Object -First 1
    $fabricToken = Get-AccessToken -Resource 'https://api.fabric.microsoft.com'
    $datasetId = @([string]$health.target.datasetId, $appSettings['PBI_DATASET']) | Where-Object { $_ } | Select-Object -First 1
    $kustoUri = @([string]$health.target.kustoUri, $appSettings['KUSTO_CLUSTER'], [string]$fabricResult.kustoUri) | Where-Object { $_ } | Select-Object -First 1
    $kqlDatabase = @([string]$health.target.kqlDatabase, $appSettings['KUSTO_DATABASE']) | Where-Object { $_ } | Select-Object -First 1
    if (-not $kqlDatabase) { $kqlDatabase = Get-ProvisionerName 'kqlDatabaseName' 'pi-realtime-db' }

    if (-not $fabricToken) {
        Add-Check -Row 'Fabric target' -Check 'Fabric API access' -Status WARN -Detail 'cannot get a Fabric token for the signed-in account' -Fix 'Sign in with an account in the Fabric tenant, or re-run with -SkipFabric.'
    } elseif (-not $workspaceId) {
        Add-Check -Row 'Fabric target' -Check 'Workspace' -Status FAIL -Detail 'no workspace ID in the Fabric plane outputs or the app target' -Fix 'The workspace phase did not complete; check the Fabric plane log.'
    } else {
        $ws = Get-JsonWithToken -Uri "$FabricApi/workspaces/$workspaceId" -Token $fabricToken
        $expectedName = [string](Get-DeploymentParameter 'fabricWorkspaceName' 'OneGrid')
        if ($ws.Status -eq 200) {
            $status = if ($ws.Json.displayName -eq $expectedName) { 'PASS' } else { 'WARN' }
            Add-Check -Row 'Fabric target' -Check 'Workspace' -Status $status -Detail "$($ws.Json.displayName) [$workspaceId] (expected name $expectedName)" -Fix 'The provisioner reuses a workspace by name; confirm the right workspace is targeted.' -Evidence ([ordered]@{ id = $workspaceId; displayName = $ws.Json.displayName; capacityId = $ws.Json.capacityId })
            $capacities = Get-JsonWithToken -Uri "$FabricApi/capacities" -Token $fabricToken
            $capacity = @($capacities.Json.value | Where-Object { $_.id -eq $ws.Json.capacityId }) | Select-Object -First 1
            if ($capacity) {
                $status = if ($capacity.state -eq 'Active') { 'PASS' } else { 'WARN' }
                Add-Check -Row 'Fabric target' -Check 'Capacity' -Status $status -Detail "$($capacity.displayName) $($capacity.sku) in $($capacity.region) is $($capacity.state)" -Fix 'Resume the capacity; queries fail while it is paused.' -Evidence ([ordered]@{ id = $capacity.id; name = $capacity.displayName; sku = $capacity.sku; state = $capacity.state; expected = Get-Output 'fabricPlaneCapacityId' })
            } else {
                Add-Check -Row 'Fabric target' -Check 'Capacity' -Status WARN -Detail "workspace capacity $($ws.Json.capacityId) is not visible to the caller" -Fix 'Capacity admins can see its state in the Fabric Admin portal.'
            }
        } else {
            Add-Check -Row 'Fabric target' -Check 'Workspace' -Status FAIL -Detail "GET workspace $workspaceId returned HTTP $($ws.Status) $($ws.Error)" -Fix 'Make sure you are a member of the workspace (the deployer is added as Admin), or re-run with -SkipFabric.'
        }

        # Items, paged.
        $items = [System.Collections.Generic.List[object]]::new()
        $next = "$FabricApi/workspaces/$workspaceId/items"
        for ($page = 0; $next -and $page -lt 20; $page++) {
            $resp = Get-JsonWithToken -Uri $next -Token $fabricToken
            if ($resp.Status -ne 200) { break }
            foreach ($item in @($resp.Json.value)) { $items.Add($item) }
            $next = [string]$resp.Json.continuationUri
        }
        $expected = [ordered]@{
            (Get-ProvisionerName 'lakehouseName' 'lh_poc')                = 'Lakehouse'
            (Get-ProvisionerName 'eventhouseName' 'pi-realtime-eventhouse') = 'Eventhouse'
            (Get-ProvisionerName 'kqlDatabaseName' 'pi-realtime-db')      = 'KQLDatabase'
        }
        # Item names from planetary-computer-pro-poc/infra/deploy.ps1 (unified and dataagent phases).
        if ([bool](Get-DeploymentParameter 'deployUnifiedModel' $true)) { $expected['OneGridModelImport'] = 'SemanticModel' }
        if ($appEnabled) { $expected['OneGridOntologyAgent'] = 'DataAgent' }
        if ($items.Count) {
            $missing = @($expected.GetEnumerator() | Where-Object { $e = $_; -not ($items | Where-Object { $_.displayName -eq $e.Key -and $_.type -eq $e.Value }) } | ForEach-Object { "$($_.Value) $($_.Key)" })
            $itemEvidence = [ordered]@{ count = $items.Count; byType = ($items | Group-Object type | ForEach-Object { [ordered]@{ type = $_.Name; count = $_.Count } }) }
            if ($missing.Count) {
                Add-Check -Row 'Fabric target' -Check 'Workspace items' -Status FAIL -Detail "missing: $($missing -join ', ') ($($items.Count) items present)" -Fix 'Re-run the deployment; the Fabric phases reuse existing items by name.' -Evidence $itemEvidence
            } else {
                Add-Check -Row 'Fabric target' -Check 'Workspace items' -Status PASS -Detail "$($items.Count) items incl. $(($expected.GetEnumerator() | ForEach-Object { $_.Key }) -join ', ')" -Evidence $itemEvidence
            }
        } else {
            Add-Check -Row 'Fabric target' -Check 'Workspace items' -Status WARN -Detail 'cannot list workspace items (or the workspace is empty)'
        }

        if ($health) {
            $model = $items | Where-Object { $_.type -eq 'SemanticModel' -and $_.displayName -eq 'OneGridModelImport' } | Select-Object -First 1
            $problems = @()
            if ($health.target.workspaceId -ne $workspaceId) { $problems += "workspace $($health.target.workspaceId)" }
            if ($model -and $health.target.datasetId -ne $model.id) { $problems += "dataset $($health.target.datasetId) is not OneGridModelImport ($($model.id))" }
            $eventhouse = $items | Where-Object { $_.type -eq 'Eventhouse' } | Select-Object -First 1
            if ($eventhouse) {
                $eh = Get-JsonWithToken -Uri "$FabricApi/workspaces/$workspaceId/eventhouses/$($eventhouse.id)" -Token $fabricToken
                $queryUri = [string]$eh.Json.properties.queryServiceUri
                if ($queryUri -and $health.target.kustoUri -and $health.target.kustoUri.TrimEnd('/') -ne $queryUri.TrimEnd('/')) { $problems += "Kusto $($health.target.kustoUri) is not $queryUri" }
            }
            if ($problems.Count) {
                Add-Check -Row 'Fabric target' -Check 'App target (/api/health)' -Status FAIL -Detail "the app points at a different target: $($problems -join '; ')" -Fix 'Re-run the deployment so chatagent re-applies PBI_*/KUSTO_* settings.'
            } else {
                Add-Check -Row 'Fabric target' -Check 'App target (/api/health)' -Status PASS -Detail "workspace, dataset and KQL endpoint match ($($health.target.kqlDatabase))"
            }
            if ($appPrincipalId) {
                $roles = Get-JsonWithToken -Uri "$FabricApi/workspaces/$workspaceId/roleAssignments" -Token $fabricToken
                if ($roles.Status -eq 200) {
                    $assignment = @($roles.Json.value | Where-Object { $_.principal.id -eq $appPrincipalId }) | Select-Object -First 1
                    if ($assignment) {
                        Add-Check -Row 'Fabric target' -Check 'Runtime identity' -Status PASS -Detail "app identity $appPrincipalId has workspace role $($assignment.role)"
                    } else {
                        Add-Check -Row 'Fabric target' -Check 'Runtime identity' -Status FAIL -Detail "app identity $appPrincipalId has no workspace role" -Fix 'The permissions phase grants it; re-run the deployment or add it as Viewer/Contributor.'
                    }
                } else {
                    Add-Check -Row 'Fabric target' -Check 'Runtime identity' -Status WARN -Detail "cannot list workspace role assignments (HTTP $($roles.Status)); workspace Admin or Member is needed"
                }
            }
        }
    }

    # Semantic model refresh and binding (Power BI REST).
    $pbiToken = Get-AccessToken -Resource 'https://analysis.windows.net/powerbi/api'
    if (-not ($workspaceId -and $datasetId)) {
        Add-Check -Row 'Semantic model' -Check 'Refresh' -Status FAIL -Detail 'the app has no dataset target' -Fix 'Check the semantic/unified phases.'
    } elseif (-not $pbiToken) {
        Add-Check -Row 'Semantic model' -Check 'Refresh' -Status WARN -Detail 'cannot get a Power BI token for the signed-in account'
    } else {
        $refreshes = Get-JsonWithToken -Uri "$PowerBiApi/groups/$workspaceId/datasets/$datasetId/refreshes?`$top=1" -Token $pbiToken
        $latest = @($refreshes.Json.value) | Select-Object -First 1
        if ($refreshes.Status -ne 200) {
            Add-Check -Row 'Semantic model' -Check 'Refresh' -Status WARN -Detail "refresh history returned HTTP $($refreshes.Status)"
        } elseif (-not $latest) {
            Add-Check -Row 'Semantic model' -Check 'Refresh' -Status FAIL -Detail 'the model has never been refreshed' -Fix 'A refresh identity (Graph grant or refreshServicePrincipal*) is needed; see DEPLOY-WITH-COPILOT.md step 2.6.'
        } elseif ($latest.status -eq 'Completed') {
            Add-Check -Row 'Semantic model' -Check 'Refresh' -Status PASS -Detail "$($latest.refreshType) refresh completed at $($latest.endTime)" -Evidence ([ordered]@{ status = $latest.status; startTime = $latest.startTime; endTime = $latest.endTime })
        } elseif ($latest.status -eq 'Failed') {
            $why = [string]$latest.serviceExceptionJson
            if ($why.Length -gt 300) { $why = $why.Substring(0, 300) + '...' }
            Add-Check -Row 'Semantic model' -Check 'Refresh' -Status FAIL -Detail "latest refresh failed at $($latest.endTime): $why" -Fix 'Check the model''s SQL endpoint binding and credentials, then refresh.'
        } else {
            Add-Check -Row 'Semantic model' -Check 'Refresh' -Status WARN -Detail "latest refresh is $($latest.status) (started $($latest.startTime))"
        }
        $sources = Get-JsonWithToken -Uri "$PowerBiApi/groups/$workspaceId/datasets/$datasetId/datasources" -Token $pbiToken
        $bound = @($sources.Json.value)
        if ($sources.Status -eq 200 -and $bound.Count) {
            $desc = ($bound | ForEach-Object { "$($_.datasourceType) $($_.connectionDetails.server)/$($_.connectionDetails.database)" }) -join '; '
            Add-Check -Row 'Semantic model' -Check 'Bound connection' -Status PASS -Detail $desc
        } else {
            Add-Check -Row 'Semantic model' -Check 'Bound connection' -Status WARN -Detail "no data sources returned (HTTP $($sources.Status))"
        }
    }
    Add-Check -Row 'Semantic model' -Check 'Expected counts (manual)' -Status MANUAL -Detail 'compare table counts and source timestamps with the loaded data'

    # Telemetry (Kusto REST).
    if (-not $kustoUri) {
        Add-Check -Row 'Telemetry' -Check 'PiEvents' -Status FAIL -Detail 'no Eventhouse query endpoint in the outputs or app target'
    } else {
        $kustoToken = Get-AccessToken -Resource $kustoUri.TrimEnd('/')
        if (-not $kustoToken) {
            Add-Check -Row 'Telemetry' -Check 'PiEvents' -Status WARN -Detail "cannot get a token for $kustoUri"
        } else {
            $body = @{ db = $kqlDatabase; csl = 'PiEvents | summarize Rows = count(), Latest = max(ingestion_time())' } | ConvertTo-Json -Compress
            $query = Invoke-Http -Uri "$($kustoUri.TrimEnd('/'))/v1/rest/query" -Method POST -Body $body -Headers @{ Authorization = "Bearer $kustoToken" }
            $row = if ($query.Status -eq 200) { @($query.Json.Tables)[0].Rows | Select-Object -First 1 } else { $null }
            $seeded = [bool](Get-DeploymentParameter 'deployOneGridData' $false)
            if ($row -and [long]$row[0] -gt 0) {
                Add-Check -Row 'Telemetry' -Check 'PiEvents' -Status PASS -Detail "$($row[0]) rows, latest ingestion $($row[1]) ($kqlDatabase)" -Evidence ([ordered]@{ database = $kqlDatabase; rows = $row[0]; latestIngestion = $row[1] })
            } elseif ($row) {
                $status = if ($seeded) { 'FAIL' } else { 'WARN' }
                Add-Check -Row 'Telemetry' -Check 'PiEvents' -Status $status -Detail "PiEvents is empty (historical seed $(if ($seeded) { 'was selected' } else { 'was off' }))" -Fix 'Seed the data (deployOneGridData) or connect the live Eventstream (docs/deployment-and-data-guide.md, Telemetry).'
            } else {
                $safe = Protect-LogText ([string]$query.Content)
                $why = if ($query.Error) { $query.Error } else { "HTTP $($query.Status) $($safe.Substring(0, [math]::Min(200, $safe.Length)))" }
                Add-Check -Row 'Telemetry' -Check 'PiEvents' -Status WARN -Detail "query failed: $why" -Fix 'Confirm the PiEvents table exists and you can query the KQL database.'
            }
        }
    }
    Add-Check -Row 'Telemetry' -Check 'Source heartbeat (manual)' -Status MANUAL -Detail 'confirm the producer heartbeat and latest event time for live telemetry'

    # Asset context through the app.
    if ($appEnabled -and (Test-Deployed $appUrl)) {
        $watch = Invoke-Http -Uri "$appUrl/api/watchlist?limit=5" -TimeoutSec 90
        $rows = @($watch.Json)
        if ($watch.Json -and -not ($watch.Json -is [array]) -and $watch.Json.rows) { $rows = @($watch.Json.rows) }
        if ($watch.Status -eq 200 -and $rows.Count) {
            Add-Check -Row 'Asset context' -Check 'GET /api/watchlist' -Status PASS -Detail "200 with $($rows.Count) row(s)"
        } elseif ($watch.Status -eq 200) {
            Add-Check -Row 'Asset context' -Check 'GET /api/watchlist' -Status WARN -Detail '200 but no rows' -Fix 'Load or seed asset data, then refresh the Import model.'
        } elseif ($watch.Status -eq 503) {
            Add-Check -Row 'Asset context' -Check 'GET /api/watchlist' -Status WARN -Detail '503: the Fabric capacity is paused'
        } else {
            Add-Check -Row 'Asset context' -Check 'GET /api/watchlist' -Status FAIL -Detail "HTTP $($watch.Status) $($watch.Error)"
        }
    }
    Add-Check -Row 'Asset context' -Check 'Joins and exposure (manual)' -Status MANUAL -Detail 'site/asset joins, watchlist, twin and weather exposure use the intended data'
}

# ------------------------------------------------------------------------------------------
# Storage containers (Geospatial, Weather, App)
# ------------------------------------------------------------------------------------------
$storageAccount = [string](Get-Output 'sampleStorageAccount')
$containers = @()
if (Test-Deployed $storageAccount) {
    $containerList = Invoke-AzCli -Arguments (@('storage', 'container-rm', 'list', '--storage-account', $storageAccount, '--resource-group', $ResourceGroupName) + $subArgs)
    if ($containerList.Ok) { $containers = @($containerList.Json | ForEach-Object { [string]$_.name }) }
}
$blobBase = if (Test-Deployed (Get-Output 'sampleContainerUrl')) { ([string](Get-Output 'sampleContainerUrl')) -replace '/[^/]+/?$', '' } else { $null }

function Test-Container {
    param([string] $Row, [string] $Name, [bool] $Expected)
    if (-not $Expected) { return }
    if ($containers -contains $Name) { Add-Check -Row $Row -Check "Blob container $Name" -Status PASS -Detail "present in $storageAccount" }
    elseif ($containers.Count) { Add-Check -Row $Row -Check "Blob container $Name" -Status FAIL -Detail "missing from $storageAccount" -Fix 'Redeploy; the template declares the container.' }
    else { Add-Check -Row $Row -Check "Blob container $Name" -Status WARN -Detail "cannot list containers of $storageAccount" }
}
Test-Container -Row 'App' -Name 'onegrid-app-package' -Expected ($appEnabled -and (Test-Deployed $storageAccount))

# ------------------------------------------------------------------------------------------
# Geospatial
# ------------------------------------------------------------------------------------------
if (-not (Test-Deployed $geoCatalogId)) {
    Add-Check -Row 'Geospatial' -Check 'GeoCatalog' -Status 'N/A' -Detail 'deployGeoCatalog was off'
} else {
    $catalog = Invoke-AzCli -Arguments (@('resource', 'show', '--ids', $geoCatalogId) + $subArgs)
    if ($catalog.Ok -and $catalog.Json.properties.provisioningState -eq 'Succeeded') {
        Add-Check -Row 'Geospatial' -Check 'GeoCatalog resource' -Status PASS -Detail "$($catalog.Json.name) Succeeded ($($catalog.Json.properties.tier))"
    } elseif ($catalog.Ok) {
        Add-Check -Row 'Geospatial' -Check 'GeoCatalog resource' -Status FAIL -Detail "$($catalog.Json.name) is $($catalog.Json.properties.provisioningState)"
    } else {
        Add-Check -Row 'Geospatial' -Check 'GeoCatalog resource' -Status FAIL -Detail "cannot read $($geoCatalogId): $($catalog.Error)"
    }
    $catalogUri = ([string](Get-Output 'geoCatalogUri')).TrimEnd('/')
    if (Test-Deployed $catalogUri) {
        $apiVersion = if ($appSettings['GEOCATALOG_API_VERSION']) { $appSettings['GEOCATALOG_API_VERSION'] } else { $DefaultGeoCatalogApiVersion }
        $geoToken = Get-AccessToken -Resource 'https://geocatalog.spatio.azure.com'
        $headers = if ($geoToken) { @{ Authorization = "Bearer $geoToken" } } else { @{} }
        $stac = Invoke-Http -Uri "$catalogUri/stac/collections?api-version=$apiVersion" -Headers $headers
        if ($stac.Status -eq 200) {
            Add-Check -Row 'Geospatial' -Check 'STAC endpoint' -Status PASS -Detail "$catalogUri reachable; $(@($stac.Json.collections).Count) collection(s)"
        } elseif ($stac.Status -in 401, 403) {
            Add-Check -Row 'Geospatial' -Check 'STAC endpoint' -Status WARN -Detail "$catalogUri reachable but HTTP $($stac.Status) for the caller" -Fix "Grant yourself GeoCatalog Administrator or Reader: az role assignment create --assignee <object-id> --role 'GeoCatalog Administrator' --scope $geoCatalogId"
        } else {
            $why = if ($stac.Error) { $stac.Error } else { "HTTP $($stac.Status)" }
            Add-Check -Row 'Geospatial' -Check 'STAC endpoint' -Status FAIL -Detail "$catalogUri : $why"
        }
        if ($appEnabled -and $appSettings.Count) {
            if (([string]$appSettings['GEOCATALOG_URI']).TrimEnd('/') -eq $catalogUri) {
                Add-Check -Row 'Geospatial' -Check 'App GeoCatalog wiring' -Status PASS -Detail 'GEOCATALOG_URI matches the deployed catalog'
            } else {
                Add-Check -Row 'Geospatial' -Check 'App GeoCatalog wiring' -Status FAIL -Detail "GEOCATALOG_URI is '$($appSettings['GEOCATALOG_URI'])'" -Fix 'Without it the Explorer serves the synthetic sample; re-run the deployment (app plane).'
            }
        }
    }
    Test-Container -Row 'Geospatial' -Name 'sample-assets' -Expected (Test-Deployed $storageAccount)
    Add-Check -Row 'Geospatial' -Check 'Upload, ingestion and tiles (manual)' -Status MANUAL -Detail 'authorized upload/ingestion, STAC search and tile retrieval'
}

# ------------------------------------------------------------------------------------------
# AI
# ------------------------------------------------------------------------------------------
$aiEndpoint = [string](Get-Output 'aiAgentEndpoint')
$aiDeploymentName = [string](Get-Output 'aiAgentDeployment')
if (-not (Test-Deployed $aiEndpoint)) {
    Add-Check -Row 'AI' -Check 'Azure OpenAI' -Status 'N/A' -Detail 'deployAiAgent was off'
} else {
    $accounts = Invoke-AzCli -Arguments (@('cognitiveservices', 'account', 'list', '--resource-group', $ResourceGroupName) + $subArgs)
    $aiAccount = if ($accounts.Ok) { @($accounts.Json | Where-Object { ([string]$_.properties.endpoint).TrimEnd('/') -eq $aiEndpoint.TrimEnd('/') }) | Select-Object -First 1 } else { $null }
    if (-not $aiAccount) {
        Add-Check -Row 'AI' -Check 'Model deployment' -Status FAIL -Detail "no Cognitive Services account with endpoint $aiEndpoint in $ResourceGroupName" -Fix 'Check the openAi resource in the deployment operations.'
    } else {
        $md = Invoke-AzCli -Arguments (@('cognitiveservices', 'account', 'deployment', 'show', '--resource-group', $ResourceGroupName, '--name', $aiAccount.name, '--deployment-name', $aiDeploymentName) + $subArgs)
        if ($md.Ok -and $md.Json.properties.provisioningState -eq 'Succeeded') {
            $m = $md.Json.properties.model
            Add-Check -Row 'AI' -Check 'Model deployment' -Status PASS -Detail "$($aiAccount.name)/$aiDeploymentName serves $($m.name) $($m.version) ($($md.Json.sku.name), capacity $($md.Json.sku.capacity))" -Evidence ([ordered]@{ account = $aiAccount.name; deployment = $aiDeploymentName; model = $m.name; version = $m.version; sku = $md.Json.sku.name })
        } else {
            $why = if ($md.Ok) { $md.Json.properties.provisioningState } else { $md.Error }
            Add-Check -Row 'AI' -Check 'Model deployment' -Status FAIL -Detail "$aiDeploymentName on $($aiAccount.name): $why" -Fix 'Check model availability and quota in the region (Test-OneGridPrerequisites.ps1).'
        }
    }
    if ($appEnabled -and $appSettings.Count) {
        $appModel = $appSettings['AI_DEFAULT_MODEL']
        if ($appModel -eq $aiDeploymentName) {
            Add-Check -Row 'AI' -Check 'App model wiring' -Status PASS -Detail "AI_DEFAULT_MODEL=$appModel"
        } else {
            Add-Check -Row 'AI' -Check 'App model wiring' -Status FAIL -Detail "AI_DEFAULT_MODEL is '$appModel' but the deployment is '$aiDeploymentName' (chat replies DeploymentNotFound)" -Fix 'Re-run the deployment so the app plane re-applies AI settings.'
        }
    }
    Add-Check -Row 'AI' -Check 'Grounded answer (manual)' -Status MANUAL -Detail 'ask the assistant a data question; it should answer with tool/query results and authorized manual context'
}

# ------------------------------------------------------------------------------------------
# Weather
# ------------------------------------------------------------------------------------------
if ($SkipWeather) {
    Add-Check -Row 'Weather' -Check 'Aurora' -Status SKIPPED -Detail '-SkipWeather'
} elseif (-not (Test-Deployed $auroraWorkspace)) {
    Add-Check -Row 'Weather' -Check 'Aurora' -Status 'N/A' -Detail 'deployAuroraModel was off'
} else {
    $subPath = "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroupName/providers"
    $endpointName = [string](Get-Output 'auroraEndpoint')
    $endpointId = "$subPath/Microsoft.MachineLearningServices/workspaces/$auroraWorkspace/onlineEndpoints/$endpointName"
    $endpoint = Invoke-AzCli -Arguments (@('resource', 'show', '--ids', $endpointId, '--api-version', '2023-10-01') + $subArgs)
    if ($endpoint.Ok -and $endpoint.Json.properties.provisioningState -eq 'Succeeded') {
        Add-Check -Row 'Weather' -Check 'Aurora endpoint' -Status PASS -Detail "$endpointName Succeeded; scoring $($endpoint.Json.properties.scoringUri)" -Evidence ([ordered]@{ endpoint = $endpointName; scoringUri = $endpoint.Json.properties.scoringUri; appSetting = $appSettings['AURORA_ENDPOINT'] })
    } else {
        $why = if ($endpoint.Ok) { $endpoint.Json.properties.provisioningState } else { $endpoint.Error }
        Add-Check -Row 'Weather' -Check 'Aurora endpoint' -Status FAIL -Detail "$($endpointName): $why"
    }
    if ([bool](Get-Output 'auroraModelDeployed')) {
        $md = Invoke-AzCli -Arguments (@('resource', 'show', '--ids', "$endpointId/deployments/aurora", '--api-version', '2023-10-01') + $subArgs)
        if ($md.Ok -and $md.Json.properties.provisioningState -eq 'Succeeded') {
            Add-Check -Row 'Weather' -Check 'Aurora model deployment' -Status PASS -Detail "aurora on $($md.Json.properties.instanceType): $($md.Json.properties.model)"
        } else {
            $why = if ($md.Ok) { $md.Json.properties.provisioningState } else { $md.Error }
            Add-Check -Row 'Weather' -Check 'Aurora model deployment' -Status FAIL -Detail $why -Fix 'Usually A100 quota or unaccepted model terms (Test-OneGridPrerequisites.ps1, Aurora).'
        }
    } else {
        Add-Check -Row 'Weather' -Check 'Aurora model deployment' -Status WARN -Detail 'the endpoint has no model deployment (no model asset was requested)' -Fix 'Deploy Aurora from the studio and set AURORA_ENDPOINT, or redeploy with createAuroraModelDeployment=true.'
    }

    if ([bool](Get-Output 'auroraScheduleDeployed')) {
        $jobName = [string](Get-Output 'auroraJobName')
        $jobId = "$subPath/Microsoft.App/jobs/$jobName"
        $job = Invoke-AzCli -Arguments (@('resource', 'show', '--ids', $jobId, '--api-version', '2024-03-01') + $subArgs)
        if ($job.Ok -and $job.Json.properties.provisioningState -eq 'Succeeded') {
            Add-Check -Row 'Weather' -Check 'Forecast job' -Status PASS -Detail "$jobName on '$($job.Json.properties.configuration.scheduleTriggerConfig.cronExpression)' (UTC)"
        } else {
            $why = if ($job.Ok) { $job.Json.properties.provisioningState } else { $job.Error }
            Add-Check -Row 'Weather' -Check 'Forecast job' -Status FAIL -Detail "$($jobName): $why"
        }
        $executions = Invoke-AzCli -Arguments (@('rest', '--method', 'get', '--url', "$ArmBase$jobId/executions?api-version=2024-03-01"))
        $latest = if ($executions.Ok) { @($executions.Json.value | Sort-Object { [datetime]$_.properties.startTime } -Descending) | Select-Object -First 1 } else { $null }
        if ($latest) {
            $ev = [ordered]@{ name = $latest.name; status = $latest.properties.status; startTime = $latest.properties.startTime; endTime = $latest.properties.endTime }
            switch ([string]$latest.properties.status) {
                'Succeeded' { Add-Check -Row 'Weather' -Check 'Latest job execution' -Status PASS -Detail "$($latest.name) succeeded at $($latest.properties.endTime)" -Evidence $ev }
                { $_ -in 'Running', 'Processing' } { Add-Check -Row 'Weather' -Check 'Latest job execution' -Status WARN -Detail "$($latest.name) is running since $($latest.properties.startTime)" -Evidence $ev }
                default { Add-Check -Row 'Weather' -Check 'Latest job execution' -Status FAIL -Detail "$($latest.name) $($latest.properties.status) at $($latest.properties.endTime)" -Fix "Inspect the job logs in the Container Apps environment (Log Analytics) for $jobName." -Evidence $ev }
            }
        } elseif ($executions.Ok) {
            Add-Check -Row 'Weather' -Check 'Latest job execution' -Status WARN -Detail 'the job has not run yet' -Fix "Wait for the next cron slot or start it: az containerapp job start --name $jobName --resource-group $ResourceGroupName"
        } else {
            Add-Check -Row 'Weather' -Check 'Latest job execution' -Status WARN -Detail "cannot list executions: $($executions.Error)"
        }
        Test-Container -Row 'Weather' -Name 'aurora-channel' -Expected (Test-Deployed $storageAccount)
    } else {
        Add-Check -Row 'Weather' -Check 'Forecast job' -Status 'N/A' -Detail 'deployAuroraSchedule was off'
    }

    if ($appEnabled -and (Test-Deployed $appUrl)) {
        $auroraStatus = Invoke-Http -Uri "$appUrl/api/aurora/status" -TimeoutSec 60
        if ($auroraStatus.Status -eq 200 -and $auroraStatus.Json.configured -eq $true) {
            Add-Check -Row 'Weather' -Check 'GET /api/aurora/status' -Status PASS -Detail "configured; latest run $($auroraStatus.Json.latest.status) $($auroraStatus.Json.latest.startTime)"
        } elseif ($auroraStatus.Status -eq 200 -and [bool](Get-Output 'auroraScheduleDeployed')) {
            Add-Check -Row 'Weather' -Check 'GET /api/aurora/status' -Status WARN -Detail "$($auroraStatus.Json.message)" -Fix 'AURORA_JOB_NAME / AURORA_JOB_RESOURCE_GROUP are set by the app plane; re-run the deployment.'
        } elseif ($auroraStatus.Status -ne 200) {
            Add-Check -Row 'Weather' -Check 'GET /api/aurora/status' -Status WARN -Detail "HTTP $($auroraStatus.Status) $($auroraStatus.Error)"
        }
    }

    Test-Container -Row 'Weather' -Name 'model-outputs' -Expected (Test-Deployed $storageAccount)
    if ($blobBase) {
        $storageToken = Get-AccessToken -Resource 'https://storage.azure.com/'
        if ($storageToken) {
            $blob = Invoke-Http -Uri "$blobBase/model-outputs/weather-events.json" -Headers @{ Authorization = "Bearer $storageToken"; 'x-ms-version' = '2021-08-06' }
            if ($blob.Status -eq 200 -and $blob.Json) {
                # Schema written by planetary-computer-pro-poc/aurora/aurora_pipeline/publish.py.
                $doc = $blob.Json
                $weatherEvents = @($doc.events)
                $problems = @()
                if ($null -eq $doc.events) { $problems += 'events missing' }
                if (-not $doc.generatedAtIso) { $problems += 'generatedAtIso missing' }
                if (-not $doc.analysisTimeIso) { $problems += 'analysisTimeIso missing' }
                if ($null -ne $doc.eventCount -and [int]$doc.eventCount -ne $weatherEvents.Count) { $problems += "eventCount $($doc.eventCount) != $($weatherEvents.Count) events" }
                $ev = [ordered]@{ analysisTimeIso = $doc.analysisTimeIso; generatedAtIso = $doc.generatedAtIso; horizonHours = $doc.horizonHours; eventCount = $weatherEvents.Count }
                if ($problems.Count) {
                    Add-Check -Row 'Weather' -Check 'weather-events.json' -Status FAIL -Detail "schema: $($problems -join '; ')" -Fix 'Compare with aurora/aurora_pipeline/publish.py.' -Evidence $ev
                } else {
                    Add-Check -Row 'Weather' -Check 'weather-events.json' -Status PASS -Detail "input cycle $($doc.analysisTimeIso), published $($doc.generatedAtIso), $($weatherEvents.Count) event(s) (an empty list is valid when no storms are detected)" -Evidence $ev
                }
            } elseif ($blob.Status -eq 404) {
                Add-Check -Row 'Weather' -Check 'weather-events.json' -Status WARN -Detail 'not published yet' -Fix 'Run the forecast job (or the notebook) once.'
            } elseif ($blob.Status -eq 403) {
                Add-Check -Row 'Weather' -Check 'weather-events.json' -Status WARN -Detail "HTTP 403 reading $storageAccount" -Fix 'Reading blobs needs Storage Blob Data Reader on the sample storage account.'
            } else {
                Add-Check -Row 'Weather' -Check 'weather-events.json' -Status WARN -Detail "HTTP $($blob.Status) $($blob.Error)"
            }
        } else {
            Add-Check -Row 'Weather' -Check 'weather-events.json' -Status WARN -Detail 'cannot get a storage token for the signed-in account'
        }
    }
    Add-Check -Row 'Weather' -Check 'Map events (manual)' -Status MANUAL -Detail 'storms (or a valid empty result) appear on the Weather map'
}

# ------------------------------------------------------------------------------------------
# Operations (facts for the manual review)
# ------------------------------------------------------------------------------------------
$opsFacts = [ordered]@{
    fabricCapacityId    = Get-Output 'fabricPlaneCapacityId'
    auroraJobSchedule   = Get-Output 'auroraJobSchedule'
    appServiceSku       = Get-DeploymentParameter 'chatAgentAppServiceSku'
    oneGridRef          = Get-DeploymentParameter 'oneGridRef'
    oneGridRepoUrl      = Get-DeploymentParameter 'oneGridRepoUrl'
    appPackageUrl       = Get-DeploymentParameter 'oneGridAppPackageUrl'
    openAiModel         = "$(Get-DeploymentParameter 'openAiModelName') $(Get-DeploymentParameter 'openAiModelVersion')"
    historicalDataSeed  = Get-DeploymentParameter 'deployOneGridData'
    unifiedModel        = Get-DeploymentParameter 'deployUnifiedModel'
    managedIdentities   = @('pcpro-ingest-identity', 'pcpro-fabricplane-identity', 'pcpro-aurora-job-identity')
}
Add-Check -Row 'Operations' -Check 'Operations review (manual)' -Status MANUAL -Detail 'alerts, refresh/job schedules, identity ownership, costs and recovery responsibilities' -Evidence $opsFacts

# ------------------------------------------------------------------------------------------
# Summary and evidence
# ------------------------------------------------------------------------------------------
$statuses = 'PASS', 'WARN', 'FAIL', 'N/A', 'SKIPPED', 'MANUAL'
$counts = [ordered]@{}
foreach ($s in $statuses) { $counts[$s] = @($script:Checks | Where-Object { $_.Status -eq $s }).Count }
$rowSummary = foreach ($row in $AcceptanceRows) {
    $rowChecks = @($script:Checks | Where-Object { $_.Row -eq $row })
    $rowStatus = if ($rowChecks.Status -contains 'FAIL') { 'FAIL' }
    elseif ($rowChecks.Status -contains 'WARN') { 'WARN' }
    elseif ($rowChecks.Status -contains 'PASS') { if ($rowChecks.Status -contains 'MANUAL') { 'PASS+MANUAL' } else { 'PASS' } }
    elseif ($rowChecks.Status -contains 'MANUAL') { 'MANUAL' }
    elseif ($rowChecks.Status -contains 'SKIPPED') { 'SKIPPED' }
    else { 'N/A' }
    [pscustomobject]@{ Row = $row; Result = $rowStatus; Checks = $rowChecks.Count; Failed = @($rowChecks | Where-Object Status -eq 'FAIL').Count; Warnings = @($rowChecks | Where-Object Status -eq 'WARN').Count }
}
Write-Host ''
$rowSummary | Format-Table Row, Result, Checks, Failed, Warnings -AutoSize | Out-String -Width 200 | Write-Host
$color = if ($counts.FAIL) { 'Red' } elseif ($counts.WARN) { 'Yellow' } else { 'Green' }
Write-Host ('ACCEPTANCE: {0} pass, {1} warn, {2} fail, {3} manual, {4} n/a, {5} skipped' -f $counts.PASS, $counts.WARN, $counts.FAIL, $counts.MANUAL, $counts.'N/A', $counts.SKIPPED) -ForegroundColor $color

$evidence = [ordered]@{
    schema      = 'onegrid-acceptance/v1'
    tool        = [ordered]@{ name = 'Test-OneGridDeployment.ps1'; version = $ToolVersion }
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    context     = [ordered]@{
        subscriptionId = $SubscriptionId
        tenantId       = $subscription.tenantId
        caller         = $subscription.user.name
        resourceGroup  = $ResourceGroupName
        deploymentName = $DeploymentName
        deploymentId   = $(if ($deployment) { $deployment.id } else { $null })
        appUrl         = $(if (Test-Deployed $appUrl) { $appUrl } else { $null })
        skipFabric     = [bool]$SkipFabric
        skipWeather    = [bool]$SkipWeather
    }
    summary     = $counts
    rows        = $rowSummary
    checks      = $script:Checks
}
$target = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
$folder = Split-Path -Parent $target
if ($folder -and -not (Test-Path -LiteralPath $folder)) { New-Item -ItemType Directory -Path $folder -Force | Out-Null }
[IO.File]::WriteAllText($target, ($evidence | ConvertTo-Json -Depth 10), [Text.UTF8Encoding]::new($false))
Write-Host "Evidence written to $target" -ForegroundColor Cyan

if ($counts.FAIL) { exit 1 }
exit 0
