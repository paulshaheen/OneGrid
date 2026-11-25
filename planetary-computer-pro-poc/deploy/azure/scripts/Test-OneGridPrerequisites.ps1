#Requires -Version 7.0
<#
.SYNOPSIS
  Checks that a subscription, region and signed-in caller are ready for a OneGrid deployment.

.DESCRIPTION
  Read-only preflight for planetary-computer-pro-poc/deploy/azure (azuredeploy.json / main.bicep).
  It never registers providers, selects a subscription, requests quota or creates anything; each
  failed check prints the command or portal step that fixes it.

  Every check reports PASS, WARN, FAIL or SKIP:
    Tooling      Azure CLI present and 2.62 or later.
    Context      Signed-in account, subscription access and state.
    Parameters   The parameter file's names exist in main.bicep, its location matches -Location,
                 and its component switches are consistent (the template silently skips a
                 component whose dependency is off).
    Access       Resource group, and the caller's effective permissions: Owner, or Contributor plus
                 User Access Administrator (the template creates role assignments).
    Providers    Registration of every resource-provider namespace main.bicep declares for the
                 selected components (derived from main.bicep at run time), plus
                 Microsoft.ContainerInstance, which deploymentScripts use to run their container.
    Region       -Location is in main.bicep's allowed region list (and the portal form's), and every
                 selected resource type and API version is offered there.
    Fabric       New capacity: SKU offered in the region and capacity-unit quota. Existing capacity
                 (fabricCapacityId): it exists, is Active and is visible to the caller. Tenant setting
                 reminder.
    AI           Azure OpenAI model/version/SKU offered in the region, TPM quota, and soft-deleted
                 accounts that block a redeploy into the same resource group.
    Aurora       NC A100 v4 size offered to the subscription and Azure ML dedicated-core quota for it
                 (with the 20% managed-endpoint reserve), when the Aurora model is deployed.
    App Service  Plan SKU offered for Linux in the region, and the Node runtime main.bicep pins.
    Policy       Informational: assignments that commonly block this template (storage shared-key or
                 public network access, allowed locations, key vault purge protection, local auth on
                 AI services) and the signs DEPLOY-WITH-COPILOT.md looks for.
    Identity     Microsoft Graph directory role when grantProvisionerGraphPermission is on, and
                 sign-in / Import-model refresh identity consistency.

  With -ParameterFile, only the checks for the selected components apply and a failed check is a
  FAIL. Without it the component selection is unknown: every check runs, and a failure that only
  matters for an optional component is reported as WARN.

  preflight-quota.ps1 remains available for the quota-only check and its opt-in -RequestGpuQuota
  request. This script supersedes it for readiness checks.

.PARAMETER SubscriptionId
  Target subscription ID (GUID). Used with --subscription on every call; the CLI's default
  subscription is not changed.

.PARAMETER Location
  Target region, for example westeurope. Must be one of the regions main.bicep allows.

.PARAMETER ResourceGroupName
  Target resource group. When it exists, permissions are evaluated at its scope; when it does not,
  the check confirms the caller can create it.

.PARAMETER ParameterFile
  ARM parameter file (.json) or .bicepparam file for the deployment. Its component switches
  (deployFabricPlane, deployOneGridApp, deployAuroraModel, createFabricCapacity, fabricCapacityId,
  grantProvisionerGraphPermission, ...) decide which checks apply. Values it omits fall back to the
  main.bicep defaults. Secure values are never read into the evidence file.

.PARAMETER OutputPath
  Optional path for a JSON evidence file (context, component selection and every result).

.EXAMPLE
  ./Test-OneGridPrerequisites.ps1 -SubscriptionId 00000000-0000-0000-0000-000000000000 -Location westeurope

  General readiness scan of a subscription and region without a component selection.

.EXAMPLE
  ./Test-OneGridPrerequisites.ps1 -SubscriptionId 00000000-0000-0000-0000-000000000000 -Location eastus `
    -ResourceGroupName onegrid-rg -ParameterFile C:\deployment\onegrid.parameters.json `
    -OutputPath .\onegrid-prerequisites.json

  Checks exactly what the prepared parameter file deploys and records the evidence.

.OUTPUTS
  A result table on the host and, with -OutputPath, a JSON evidence file. Exit code 1 when any check
  FAILs, otherwise 0.

.NOTES
  Requires PowerShell 7 and the Azure CLI 2.62 or later, signed in with az login. Reader on the
  subscription is enough to run it; some checks need directory (Graph) read access and report WARN
  without it. Fabric tenant settings and Aurora model terms cannot be read and are reported as
  reminders.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$')]
    [string] $SubscriptionId,

    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string] $Location,

    [string] $ResourceGroupName,

    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
    [string] $ParameterFile,

    [string] $OutputPath
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$env:PYTHONUTF8 = '1'   # lets the Python-based az CLI print non-ASCII on Windows consoles

$ToolVersion = '1.0.0'
$Location = ($Location -replace '\s', '').ToLowerInvariant()
$DeployDir = Split-Path -Parent $PSScriptRoot
$MainBicepPath = Join-Path $DeployDir 'main.bicep'
$CompiledTemplatePath = Join-Path $DeployDir 'azuredeploy.json'
$UiDefinitionPath = Join-Path $DeployDir 'createUiDefinition.json'
$QuotasBlade = 'https://portal.azure.com/#view/Microsoft_Azure_Capacity/QuotaMenuBlade/~/myQuotas'
$ArmBase = 'https://management.azure.com'

$script:Results = [System.Collections.Generic.List[object]]::new()

# ------------------------------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------------------------------
function Add-Result {
    param(
        [Parameter(Mandatory)] [string] $Area,
        [Parameter(Mandatory)] [string] $Check,
        [Parameter(Mandatory)] [ValidateSet('PASS', 'WARN', 'FAIL', 'SKIP')] [string] $Status,
        [string] $Detail = '',
        [string] $Fix = '',
        [ValidateSet('yes', 'no', 'unknown')] [string] $Applies = 'yes'
    )
    if ($Applies -eq 'unknown' -and $Status -eq 'FAIL') {
        $Status = 'WARN'
        $Detail = "$Detail (matters only if you deploy this component; pass -ParameterFile to make it a hard check)"
    }
    $script:Results.Add([pscustomobject]@{
            Area   = $Area
            Check  = $Check
            Status = $Status
            Detail = $Detail
            Fix    = $(if ($Status -in 'WARN', 'FAIL') { $Fix } else { '' })
        })
    $color = switch ($Status) { 'PASS' { 'Green' } 'WARN' { 'Yellow' } 'FAIL' { 'Red' } default { 'DarkGray' } }
    Write-Host ('[{0}] {1,-4} {2} | {3}: {4}' -f (Get-Date -Format 'HH:mm:ss'), $Status, $Area, $Check, $Detail) -ForegroundColor $color
    if ($Fix -and $Status -in 'WARN', 'FAIL') { Write-Host "                 fix: $Fix" -ForegroundColor DarkYellow }
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

function Invoke-ArmGet {
    # GET an ARM URL that has a single query parameter (api-version). Avoids '&' in arguments,
    # which az.cmd on Windows would hand to cmd.exe as a command separator.
    param([Parameter(Mandatory)] [string] $Path, [Parameter(Mandatory)] [string] $ApiVersion)
    Invoke-AzCli -Arguments @('rest', '--method', 'get', '--url', "$ArmBase$($Path)?api-version=$ApiVersion")
}

function Get-AccessToken {
    param([Parameter(Mandatory)] [string] $Resource)
    $r = Invoke-AzCli -Arguments @('account', 'get-access-token', '--resource', $Resource, '--subscription', $SubscriptionId)
    if ($r.Ok -and $r.Json.accessToken) { return $r.Json.accessToken }
    return $null
}

function ConvertTo-RegionName {
    param([string] $Name)
    if (-not $Name) { return '' }
    ($Name -replace '\s', '').ToLowerInvariant()
}

function Test-RegionInList {
    param([string] $Region, [object[]] $List)
    $wanted = ConvertTo-RegionName $Region
    foreach ($item in @($List)) { if ((ConvertTo-RegionName ([string]$item)) -eq $wanted) { return $true } }
    return $false
}

function ConvertFrom-BicepLiteral {
    # Converts a Bicep default value to a PowerShell value; $null for expressions.
    param([string] $Text)
    $t = $Text.Trim()
    if ($t -match "^'((?:\\'|[^'])*)'") { return ($Matches[1] -replace "\\'", "'") }
    if ($t -match '^(true|false)\b') { return ($Matches[1] -eq 'true') }
    if ($t -match '^(-?\d+)\b') { return [int]$Matches[1] }
    return $null
}

# Three-valued evaluation of a Bicep boolean condition such as
# "deployAuroraJob && empty(auroraJobImage)". Unknown identifiers or syntax return $null.
function Resolve-Condition {
    param([string] $Expression, [hashtable] $Facts)
    $tokens = @([regex]::Matches($Expression, '\s*(&&|\|\||!|\(|\)|,|[A-Za-z_][A-Za-z0-9_]*|\S)') | ForEach-Object { $_.Groups[1].Value })
    if ($tokens.Count -eq 0) { return $null }
    $state = @{ T = $tokens; P = 0; Bad = $false }
    $value = Resolve-OrExpression -State $state -Facts $Facts
    if ($state.Bad -or $state.P -lt $tokens.Count) { return $null }
    return $value
}

function Resolve-OrExpression {
    param([hashtable] $State, [hashtable] $Facts)
    $value = Resolve-AndExpression -State $State -Facts $Facts
    while ($State.P -lt $State.T.Count -and $State.T[$State.P] -eq '||') {
        $State.P++
        $right = Resolve-AndExpression -State $State -Facts $Facts
        $value = if ($value -eq $true -or $right -eq $true) { $true } elseif ($null -eq $value -or $null -eq $right) { $null } else { $false }
    }
    return $value
}

function Resolve-AndExpression {
    param([hashtable] $State, [hashtable] $Facts)
    $value = Resolve-PrimaryExpression -State $State -Facts $Facts
    while ($State.P -lt $State.T.Count -and $State.T[$State.P] -eq '&&') {
        $State.P++
        $right = Resolve-PrimaryExpression -State $State -Facts $Facts
        $value = if ($value -eq $false -or $right -eq $false) { $false } elseif ($null -eq $value -or $null -eq $right) { $null } else { $true }
    }
    return $value
}

function Resolve-PrimaryExpression {
    param([hashtable] $State, [hashtable] $Facts)
    if ($State.P -ge $State.T.Count) { $State.Bad = $true; return $null }
    $token = $State.T[$State.P]
    $State.P++
    if ($token -eq '!') {
        $inner = Resolve-PrimaryExpression -State $State -Facts $Facts
        if ($null -eq $inner) { return $null }
        return (-not $inner)
    }
    if ($token -eq '(') {
        $inner = Resolve-OrExpression -State $State -Facts $Facts
        if ($State.P -ge $State.T.Count -or $State.T[$State.P] -ne ')') { $State.Bad = $true; return $null }
        $State.P++
        return $inner
    }
    if ($token -match '^[A-Za-z_]\w*$') {
        if ($State.P -lt $State.T.Count -and $State.T[$State.P] -eq '(') {
            $argName = if ($State.P + 1 -lt $State.T.Count) { $State.T[$State.P + 1] } else { '' }
            $close = if ($State.P + 2 -lt $State.T.Count) { $State.T[$State.P + 2] } else { '' }
            if ($token -eq 'empty' -and $argName -match '^[A-Za-z_]\w*$' -and $close -eq ')') {
                $State.P += 3
                if ($Facts.ContainsKey("empty:$argName")) { return [bool]$Facts["empty:$argName"] }
                return $null
            }
            $State.Bad = $true
            return $null
        }
        if ($token -eq 'true') { return $true }
        if ($token -eq 'false') { return $false }
        if ($Facts.ContainsKey($token) -and $Facts[$token] -is [bool]) { return $Facts[$token] }
        return $null
    }
    $State.Bad = $true
    return $null
}

function Test-ActionAllowed {
    # Effective ARM permissions: union over entries of (actions minus notActions).
    param([object[]] $Permissions, [string] $Action)
    foreach ($entry in @($Permissions)) {
        $allowed = $false
        foreach ($pattern in @($entry.actions)) {
            if ($Action -match ('^' + [regex]::Escape([string]$pattern).Replace('\*', '.*') + '$')) { $allowed = $true; break }
        }
        if (-not $allowed) { continue }
        $denied = $false
        foreach ($pattern in @($entry.notActions)) {
            if ($Action -match ('^' + [regex]::Escape([string]$pattern).Replace('\*', '.*') + '$')) { $denied = $true; break }
        }
        if (-not $denied) { return $true }
    }
    return $false
}

# ------------------------------------------------------------------------------------------
# Template model (derived from main.bicep at run time; azuredeploy.json as a fallback)
# ------------------------------------------------------------------------------------------
function Read-TemplateModel {
    $model = [ordered]@{
        Source           = ''
        Parameters       = @{}
        Defaults         = @{}
        Variables        = [ordered]@{}
        Resources        = @()
        AllowedLocations = @()
        LinuxFxVersion   = ''
    }
    if (Test-Path -LiteralPath $MainBicepPath) {
        $text = Get-Content -LiteralPath $MainBicepPath -Raw
        $model.Source = 'main.bicep'
        foreach ($m in [regex]::Matches($text, '(?m)^param\s+(\w+)\s+(\w+)(?:\s*=\s*(.+?))?\s*$')) {
            $name = $m.Groups[1].Value
            $model.Parameters[$name] = $m.Groups[2].Value
            if ($m.Groups[3].Success) {
                $value = ConvertFrom-BicepLiteral $m.Groups[3].Value
                if ($null -ne $value) { $model.Defaults[$name] = $value }
            }
        }
        foreach ($m in [regex]::Matches($text, '(?ms)^param\s+(\w+)\s+array\s*=\s*\[(.*?)\]')) {
            $model.Defaults[$m.Groups[1].Value] = @([regex]::Matches($m.Groups[2].Value, "'([^']*)'") | ForEach-Object { $_.Groups[1].Value })
        }
        foreach ($m in [regex]::Matches($text, '(?m)^var\s+(\w+)\s*=\s*(.+?)\s*$')) {
            $model.Variables[$m.Groups[1].Value] = $m.Groups[2].Value
        }
        $pattern = "(?m)^resource\s+(\w+)\s+'([^'@]+)@([^']+)'\s+(existing\s+)?=\s*(?:if\s*\((.*?)\)\s*)?\{"
        $model.Resources = @(foreach ($m in [regex]::Matches($text, $pattern)) {
                [pscustomobject]@{
                    Symbol     = $m.Groups[1].Value
                    Type       = $m.Groups[2].Value
                    ApiVersion = $m.Groups[3].Value
                    Existing   = $m.Groups[4].Success
                    Condition  = $(if ($m.Groups[5].Success) { $m.Groups[5].Value.Trim() } else { '' })
                }
            })
        $allowed = [regex]::Match($text, '@allowed\(\[(?<list>[^\]]*)\]\)\s*param\s+location\s+string')
        if ($allowed.Success) {
            $model.AllowedLocations = @([regex]::Matches($allowed.Groups['list'].Value, "'([^']+)'") | ForEach-Object { $_.Groups[1].Value })
        }
        $fx = [regex]::Match($text, "linuxFxVersion:\s*'([^']+)'")
        if ($fx.Success) { $model.LinuxFxVersion = $fx.Groups[1].Value }
    } elseif (Test-Path -LiteralPath $CompiledTemplatePath) {
        # Fallback: compiled template. Conditions are ARM expressions and are not evaluated.
        $arm = Get-Content -LiteralPath $CompiledTemplatePath -Raw | ConvertFrom-Json -AsHashtable -Depth 64
        $model.Source = 'azuredeploy.json'
        foreach ($p in $arm.parameters.GetEnumerator()) {
            $model.Parameters[$p.Key] = $p.Value.type
            if ($p.Value.ContainsKey('defaultValue') -and -not ([string]$p.Value.defaultValue).StartsWith('[')) { $model.Defaults[$p.Key] = $p.Value.defaultValue }
        }
        $model.AllowedLocations = @($arm.parameters.location.allowedValues)
        $resources = if ($arm.resources -is [System.Collections.IDictionary]) { $arm.resources.GetEnumerator() | ForEach-Object { $_.Value } } else { $arm.resources }
        $model.Resources = @(foreach ($r in $resources) {
                $typeParts = ([string]$r.type) -split '@'
                [pscustomobject]@{
                    Symbol     = [string]$r.name
                    Type       = $typeParts[0]
                    ApiVersion = $(if ($r.apiVersion) { $r.apiVersion } elseif ($typeParts.Count -gt 1) { $typeParts[1] } else { '' })
                    Existing   = [bool]$r.existing
                    Condition  = $(if ($r.ContainsKey('condition')) { '?' } else { '' })
                }
            })
    }
    return $model
}

function Read-ParameterValues {
    param([string] $Path)
    $values = @{}
    if ($Path -like '*.bicepparam') {
        # Best-effort reader: literal bool/int/string values and arrays of strings. Anything else
        # (getSecret(), readEnvironmentVariable(), objects) is recorded as an expression.
        $text = Get-Content -LiteralPath $Path -Raw
        foreach ($m in [regex]::Matches($text, '(?m)^\s*param\s+(\w+)\s*=\s*(.+?)\s*$')) {
            $value = ConvertFrom-BicepLiteral $m.Groups[2].Value
            if ($null -ne $value) { $values[$m.Groups[1].Value] = $value } else { $values[$m.Groups[1].Value] = '<expression>' }
        }
        foreach ($m in [regex]::Matches($text, '(?ms)^\s*param\s+(\w+)\s*=\s*\[(.*?)\]')) {
            $values[$m.Groups[1].Value] = @([regex]::Matches($m.Groups[2].Value, "'([^']*)'") | ForEach-Object { $_.Groups[1].Value })
        }
        return $values
    }
    $document = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -AsHashtable -Depth 64
    $parameters = if ($document.ContainsKey('parameters')) { $document.parameters } else { @{} }
    foreach ($entry in $parameters.GetEnumerator()) {
        if ($entry.Value -is [System.Collections.IDictionary]) {
            if ($entry.Value.ContainsKey('value')) { $values[$entry.Key] = $entry.Value.value }
            elseif ($entry.Value.ContainsKey('reference')) { $values[$entry.Key] = '<key-vault-reference>' }
        }
    }
    return $values
}

# ------------------------------------------------------------------------------------------
# Load the template and the component selection
# ------------------------------------------------------------------------------------------
Write-Host "OneGrid prerequisites check $ToolVersion - subscription $SubscriptionId, region $Location" -ForegroundColor Cyan
$template = Read-TemplateModel
if (-not $template.Source) {
    Write-Host "Cannot find main.bicep or azuredeploy.json next to this script ($DeployDir)." -ForegroundColor Red
    exit 1
}

$script:SelectionKnown = [bool]$ParameterFile
$paramValues = @{}
if ($ParameterFile) {
    try {
        $paramValues = Read-ParameterValues -Path $ParameterFile
    } catch {
        Add-Result -Area 'Parameters' -Check 'Parameter file' -Status FAIL -Detail "cannot read $($ParameterFile): $($_.Exception.Message)" -Fix 'Pass a valid ARM parameter file (deploymentParameters schema) or .bicepparam file.'
        $script:SelectionKnown = $false
    }
}

function Get-Setting {
    param([string] $Name)
    if ($paramValues.ContainsKey($Name)) { return $paramValues[$Name] }
    if ($template.Defaults.ContainsKey($Name)) { return $template.Defaults[$Name] }
    return $null
}

# Facts for condition evaluation: boolean parameters, emptiness of string parameters, then the
# boolean variables main.bicep derives from them (evaluated until stable, in any order).
$facts = @{}
foreach ($name in $template.Parameters.Keys) {
    $value = Get-Setting $name
    if ($value -is [bool]) { $facts[$name] = $value }
    elseif ($template.Parameters[$name] -in 'string', 'securestring' -or $value -is [string]) {
        if ($value -ne '<key-vault-reference>' -and $value -ne '<expression>') { $facts["empty:$name"] = [string]::IsNullOrEmpty([string]$value) }
    }
}
# effectiveAuroraModelAssetId is a string ternary in main.bicep; its emptiness follows from inputs.
$facts['empty:effectiveAuroraModelAssetId'] = [string]::IsNullOrEmpty([string](Get-Setting 'auroraModelAssetId')) -and -not [bool](Get-Setting 'createAuroraModelDeployment')
for ($pass = 0; $pass -lt 6; $pass++) {
    $changed = $false
    foreach ($v in $template.Variables.GetEnumerator()) {
        if ($facts.ContainsKey($v.Key)) { continue }
        $result = Resolve-Condition -Expression $v.Value -Facts $facts
        if ($null -ne $result) { $facts[$v.Key] = [bool]$result; $changed = $true }
    }
    if (-not $changed) { break }
}

function Get-Fact {
    param([string] $Name, [bool] $Default = $false)
    if ($facts.ContainsKey($Name)) { return [bool]$facts[$Name] }
    return $Default
}

$components = [ordered]@{
    geoCatalog         = [bool](Get-Setting 'deployGeoCatalog')
    sampleStorage      = [bool](Get-Setting 'deploySampleStorage')
    aiAgent            = [bool](Get-Setting 'deployAiAgent')
    fabricPlane        = Get-Fact 'deployFabricPlaneEffective'
    oneGridApp         = Get-Fact 'deployOneGridAppEffective'
    createCapacity     = Get-Fact 'createFabricCapacityEffective'
    existingCapacity   = (Get-Fact 'deployFabricPlaneEffective') -and -not (Get-Fact 'createFabricCapacityEffective') -and -not [string]::IsNullOrWhiteSpace([string](Get-Setting 'fabricCapacityId'))
    auroraModel        = [bool](Get-Setting 'deployAuroraModel')
    auroraDeployment   = Get-Fact 'deployAuroraDeployment'
    auroraJob          = Get-Fact 'deployAuroraJob'
    graphGrant         = Get-Fact 'grantGraphToProvisioner'
    exemptStorage      = [bool](Get-Setting 'exemptStorageFromPolicy')
}

function Get-Applies {
    param([string] $Component)
    if (-not $script:SelectionKnown) { return 'unknown' }
    if ($components[$Component]) { return 'yes' }
    return 'no'
}

function Add-Skip {
    param([string] $Area, [string] $Check, [string] $Why)
    Add-Result -Area $Area -Check $Check -Status SKIP -Detail $Why
}

# ------------------------------------------------------------------------------------------
# Tooling and context
# ------------------------------------------------------------------------------------------
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    Add-Result -Area 'Tooling' -Check 'Azure CLI' -Status FAIL -Detail 'az was not found on PATH' -Fix 'Install the Azure CLI 2.62 or later: https://aka.ms/installazurecli'
    $script:Results | Format-Table Area, Status, Check, Detail -AutoSize -Wrap | Out-String -Width 220 | Write-Host
    exit 1
}
$azVersion = Invoke-AzCli -Arguments @('version')
$cliVersion = if ($azVersion.Ok) { [string]$azVersion.Json.'azure-cli' } else { '' }
$parsedVersion = $null
if ($cliVersion -and [version]::TryParse($cliVersion, [ref]$parsedVersion) -and $parsedVersion -ge [version]'2.62.0') {
    Add-Result -Area 'Tooling' -Check 'Azure CLI' -Status PASS -Detail "azure-cli $cliVersion"
} else {
    Add-Result -Area 'Tooling' -Check 'Azure CLI' -Status WARN -Detail "azure-cli '$cliVersion' (2.62 or later expected)" -Fix 'Upgrade with az upgrade, or reinstall from https://aka.ms/installazurecli'
}

$account = Invoke-AzCli -Arguments @('account', 'show', '--subscription', $SubscriptionId)
if (-not $account.Ok) {
    $anyAccount = Invoke-AzCli -Arguments @('account', 'show')
    if (-not $anyAccount.Ok) {
        Add-Result -Area 'Context' -Check 'Signed-in account' -Status FAIL -Detail "not signed in to the Azure CLI ($($anyAccount.Error))" -Fix 'Run az login (az login --use-device-code without a browser), then re-run this script.'
    } else {
        Add-Result -Area 'Context' -Check 'Subscription access' -Status FAIL -Detail "the signed-in account cannot use subscription $SubscriptionId ($($account.Error))" -Fix 'Sign in with an account that has access (az login --tenant <tenant-id>), or check the subscription ID with az account list -o table.'
    }
    $script:Results | Format-Table Area, Status, Check, Detail -AutoSize -Wrap | Out-String -Width 220 | Write-Host
    exit 1
}
$sub = $account.Json
$callerType = [string]$sub.user.type
$callerName = [string]$sub.user.name
Add-Result -Area 'Context' -Check 'Signed-in account' -Status PASS -Detail "$callerType $callerName in tenant $($sub.tenantId)"
if ($sub.state -eq 'Enabled') {
    Add-Result -Area 'Context' -Check 'Subscription state' -Status PASS -Detail "$($sub.name) is Enabled"
} else {
    Add-Result -Area 'Context' -Check 'Subscription state' -Status FAIL -Detail "$($sub.name) is $($sub.state)" -Fix 'Deployments need an Enabled subscription; resolve billing or reactivate it in the portal.'
}

$callerObjectId = $null
if ($callerType -eq 'user') {
    $me = Invoke-AzCli -Arguments @('ad', 'signed-in-user', 'show')
    if ($me.Ok) { $callerObjectId = [string]$me.Json.id }
} else {
    $spLookup = Invoke-AzCli -Arguments @('ad', 'sp', 'show', '--id', $callerName)
    if ($spLookup.Ok) { $callerObjectId = [string]$spLookup.Json.id }
}

# ------------------------------------------------------------------------------------------
# Parameters
# ------------------------------------------------------------------------------------------
if ($ParameterFile -and $script:SelectionKnown) {
    Add-Result -Area 'Parameters' -Check 'Parameter file' -Status PASS -Detail "$(Split-Path -Leaf $ParameterFile): $($paramValues.Count) value(s); omitted values use $($template.Source) defaults"
    $unknown = @($paramValues.Keys | Where-Object { -not $template.Parameters.ContainsKey($_) } | Sort-Object)
    if ($unknown.Count) {
        Add-Result -Area 'Parameters' -Check 'Parameter names' -Status FAIL -Detail "not template parameters: $($unknown -join ', ')" -Fix 'Remove or rename them; ARM rejects unknown parameters.'
    } else {
        Add-Result -Area 'Parameters' -Check 'Parameter names' -Status PASS -Detail 'every name is a template parameter'
    }
    $fileLocation = ConvertTo-RegionName ([string](Get-Setting 'location'))
    if ($paramValues.ContainsKey('location') -and $fileLocation -ne $Location) {
        Add-Result -Area 'Parameters' -Check 'Location' -Status FAIL -Detail "parameter file location is '$fileLocation' but -Location is '$Location'" -Fix 'Use the same region in both; every resource deploys to the location parameter.'
    } elseif (-not $paramValues.ContainsKey('location')) {
        Add-Result -Area 'Parameters' -Check 'Location' -Status WARN -Detail "the file does not set location, so the template default '$(Get-Setting 'location')' is used" -Fix "Add `"location`": { `"value`": `"$Location`" } to the parameter file."
    } else {
        Add-Result -Area 'Parameters' -Check 'Location' -Status PASS -Detail "parameter file and -Location agree ($Location)"
    }
    if ([bool](Get-Setting 'deployFabricPlane') -and -not $components.sampleStorage) {
        Add-Result -Area 'Parameters' -Check 'Component dependencies' -Status WARN -Detail 'deployFabricPlane is true but deploySampleStorage is false; the template skips the Fabric plane and the web app' -Fix 'Set deploySampleStorage to true.'
    }
    if ([bool](Get-Setting 'deployOneGridApp') -and -not $components.fabricPlane) {
        Add-Result -Area 'Parameters' -Check 'Component dependencies' -Status WARN -Detail 'deployOneGridApp is true but the Fabric plane is off; the template skips the web app' -Fix 'Set deployFabricPlane (and deploySampleStorage) to true.'
    }
    if ([bool](Get-Setting 'deployAuroraSchedule') -and -not $components.auroraJob) {
        Add-Result -Area 'Parameters' -Check 'Component dependencies' -Status WARN -Detail 'deployAuroraSchedule is true but the Aurora model or sample storage is off; the forecast job is skipped' -Fix 'Set deployAuroraModel and deploySampleStorage to true.'
    }
    if ($components.oneGridApp -and (@(Get-Setting 'oneGridModules') -contains 'copilot') -and -not $components.aiAgent) {
        Add-Result -Area 'Parameters' -Check 'Component dependencies' -Status WARN -Detail "oneGridModules includes 'copilot' but deployAiAgent is false; the chat cannot answer" -Fix 'Set deployAiAgent to true or remove copilot from oneGridModules.'
    }
    if ($components.fabricPlane -and -not $components.createCapacity -and -not $components.existingCapacity) {
        Add-Result -Area 'Parameters' -Check 'Fabric capacity choice' -Status FAIL -Detail 'the Fabric plane is selected but createFabricCapacity is false and fabricCapacityId is empty' -Fix 'Set createFabricCapacity to true, or supply fabricCapacityId (resource ID or GUID).'
    }
    $selected = ($components.GetEnumerator() | Where-Object { $_.Value -eq $true } | ForEach-Object { $_.Key }) -join ', '
    Add-Result -Area 'Parameters' -Check 'Effective components' -Status PASS -Detail $(if ($selected) { $selected } else { 'none' })
} elseif (-not $ParameterFile) {
    Add-Result -Area 'Parameters' -Check 'Component selection' -Status WARN -Detail 'no -ParameterFile: every component check runs in advisory mode' -Fix 'Pass the deployment parameter file to check exactly what will be deployed.'
}

# ------------------------------------------------------------------------------------------
# Access: resource group and effective permissions
# ------------------------------------------------------------------------------------------
$subscriptionScope = "/subscriptions/$SubscriptionId"
$scope = $subscriptionScope
$rgExists = $false
if ($ResourceGroupName) {
    $rg = Invoke-AzCli -Arguments @('group', 'show', '--name', $ResourceGroupName, '--subscription', $SubscriptionId)
    if ($rg.Ok) {
        $rgExists = $true
        $scope = [string]$rg.Json.id
        if ((ConvertTo-RegionName $rg.Json.location) -eq $Location) {
            Add-Result -Area 'Access' -Check 'Resource group' -Status PASS -Detail "$ResourceGroupName exists in $($rg.Json.location)"
        } else {
            Add-Result -Area 'Access' -Check 'Resource group' -Status WARN -Detail "$ResourceGroupName exists in $($rg.Json.location), not $Location; resources still deploy to $Location" -Fix 'Keep the resource group and its resources in one region: recreate the empty group in the target region if needed.'
        }
    } elseif ($rg.Error -match 'ResourceGroupNotFound|could not be found') {
        Add-Result -Area 'Access' -Check 'Resource group' -Status WARN -Detail "$ResourceGroupName does not exist yet" -Fix "Create it before deploying: az group create --name $ResourceGroupName --location $Location --subscription $SubscriptionId"
    } else {
        Add-Result -Area 'Access' -Check 'Resource group' -Status WARN -Detail "cannot read $($ResourceGroupName): $($rg.Error)" -Fix 'Check that the account has at least Reader on the resource group.'
    }
} else {
    Add-Skip -Area 'Access' -Check 'Resource group' -Why 'no -ResourceGroupName; permissions are evaluated at subscription scope'
}

$roleNames = @()
if ($callerObjectId) {
    $ra = Invoke-AzCli -Arguments @('role', 'assignment', 'list', '--assignee', $callerObjectId, '--scope', $scope, '--include-inherited', '--include-groups')
    if (-not $ra.Ok) { $ra = Invoke-AzCli -Arguments @('role', 'assignment', 'list', '--assignee', $callerObjectId, '--scope', $scope, '--include-inherited') }
    if ($ra.Ok) { $roleNames = @($ra.Json | ForEach-Object { [string]$_.roleDefinitionName } | Sort-Object -Unique) }
}
$hasOwner = $roleNames -contains 'Owner'
$hasContributor = $roleNames -contains 'Contributor'
$hasRoleAdmin = ($roleNames -contains 'User Access Administrator') -or ($roleNames -contains 'Role Based Access Control Administrator')

$perm = Invoke-ArmGet -Path "$scope/providers/Microsoft.Authorization/permissions" -ApiVersion '2022-04-01'
$scopeLabel = if ($rgExists) { "resource group $ResourceGroupName" } else { 'the subscription' }
$roleText = if ($roleNames.Count) { "roles: $($roleNames -join ', ')" } else { 'role names not readable' }
if ($perm.Ok -and $perm.Json.value) {
    $p = @($perm.Json.value)
    $canDeploy = Test-ActionAllowed -Permissions $p -Action 'Microsoft.Resources/deployments/write'
    $canWrite = Test-ActionAllowed -Permissions $p -Action 'Microsoft.Storage/storageAccounts/write'
    $canAssign = Test-ActionAllowed -Permissions $p -Action 'Microsoft.Authorization/roleAssignments/write'
    $canScripts = Test-ActionAllowed -Permissions $p -Action 'Microsoft.Resources/deploymentScripts/write'
    $missing = @()
    if (-not $canDeploy) { $missing += 'Microsoft.Resources/deployments/write' }
    if (-not $canWrite) { $missing += 'resource write (*/write)' }
    if (-not $canAssign) { $missing += 'Microsoft.Authorization/roleAssignments/write' }
    if (-not $canScripts) { $missing += 'Microsoft.Resources/deploymentScripts/write' }
    if (-not $missing) {
        $how = if ($hasOwner) { 'Owner' } elseif ($hasContributor -and $hasRoleAdmin) { 'Contributor + role-assignment administrator' } else { 'effective permissions (custom or group roles)' }
        $note = if (($roleNames -contains 'Role Based Access Control Administrator') -and -not $hasOwner) { '; Role Based Access Control Administrator can carry conditions that restrict which roles it may assign - the template assigns Owner, Contributor, User Access Administrator and data-plane roles' } else { '' }
        Add-Result -Area 'Access' -Check 'Deployment permissions' -Status PASS -Detail "can deploy and create role assignments at $scopeLabel via $how ($roleText)$note"
    } else {
        Add-Result -Area 'Access' -Check 'Deployment permissions' -Status FAIL -Detail "missing at $($scopeLabel): $($missing -join ', ') ($roleText)" -Fix "Grant Owner, or Contributor plus User Access Administrator, on $scope (the template creates role assignments for its managed identities)."
    }
    if ($ResourceGroupName -and -not $rgExists) {
        if (Test-ActionAllowed -Permissions $p -Action 'Microsoft.Resources/subscriptions/resourceGroups/write') {
            Add-Result -Area 'Access' -Check 'Create resource group' -Status PASS -Detail 'the caller can create resource groups in the subscription'
        } else {
            Add-Result -Area 'Access' -Check 'Create resource group' -Status FAIL -Detail 'the caller cannot create resource groups in the subscription' -Fix 'Ask a subscription owner to create the resource group and grant you Owner on it.'
        }
    }
} elseif ($roleNames.Count) {
    if ($hasOwner -or ($hasContributor -and $hasRoleAdmin)) {
        Add-Result -Area 'Access' -Check 'Deployment permissions' -Status PASS -Detail "$roleText at or above $scopeLabel"
    } else {
        Add-Result -Area 'Access' -Check 'Deployment permissions' -Status FAIL -Detail "$roleText; Owner, or Contributor plus User Access Administrator, is required" -Fix "Grant Owner, or Contributor plus User Access Administrator, on $scope."
    }
} else {
    Add-Result -Area 'Access' -Check 'Deployment permissions' -Status WARN -Detail "could not read permissions or role assignments ($($perm.Error))" -Fix 'Confirm the account has Owner, or Contributor plus User Access Administrator, on the subscription or resource group.'
}

# ------------------------------------------------------------------------------------------
# Resource providers and regional availability (derived from main.bicep)
# ------------------------------------------------------------------------------------------
function Get-ResourceApplies {
    param($Resource)
    if (-not $Resource.Condition) { return 'yes' }
    if (-not $script:SelectionKnown) { return 'unknown' }
    $value = Resolve-Condition -Expression $Resource.Condition -Facts $facts
    if ($value -eq $true) { return 'yes' }
    if ($value -eq $false) { return 'no' }
    return 'unknown'
}

function Join-Applies {
    param([string[]] $Values)
    if ($Values -contains 'yes') { return 'yes' }
    if ($Values -contains 'unknown') { return 'unknown' }
    return 'no'
}

$declared = @($template.Resources | Where-Object { -not $_.Existing -and $_.Type -notlike 'Microsoft.Graph/*' })
foreach ($r in $declared) { $r | Add-Member -NotePropertyName Applies -NotePropertyValue (Get-ResourceApplies $r) -Force }
$namespaces = [ordered]@{}
foreach ($r in $declared) {
    $ns = ($r.Type -split '/')[0]
    if (-not $namespaces.Contains($ns)) { $namespaces[$ns] = [System.Collections.Generic.List[object]]::new() }
    $namespaces[$ns].Add($r)
}
$scriptApplies = Join-Applies @($declared | Where-Object { $_.Type -eq 'Microsoft.Resources/deploymentScripts' } | ForEach-Object { $_.Applies })
if ($scriptApplies -ne 'no' -and -not $namespaces.Contains('Microsoft.ContainerInstance')) {
    $namespaces['Microsoft.ContainerInstance'] = [System.Collections.Generic.List[object]]::new()
}

if ($template.AllowedLocations.Count) {
    if (Test-RegionInList -Region $Location -List $template.AllowedLocations) {
        Add-Result -Area 'Region' -Check 'Template region list' -Status PASS -Detail "$Location is allowed by $($template.Source) ($($template.AllowedLocations -join ', '))"
    } else {
        Add-Result -Area 'Region' -Check 'Template region list' -Status FAIL -Detail "$Location is not in the template's allowed regions: $($template.AllowedLocations -join ', ')" -Fix "Choose one of: $($template.AllowedLocations -join ', ') (the GeoCatalog regions)."
    }
} else {
    Add-Result -Area 'Region' -Check 'Template region list' -Status WARN -Detail "no @allowed list found for location in $($template.Source)" -Fix 'Check main.bicep: the location parameter should list the GeoCatalog regions.'
}
if (Test-Path -LiteralPath $UiDefinitionPath) {
    try {
        $ui = Get-Content -LiteralPath $UiDefinitionPath -Raw | ConvertFrom-Json -Depth 64
        $uiRegions = @($ui.parameters.config.basics.location.allowedValues)
        if ($uiRegions.Count -and (Compare-Object @($uiRegions | Sort-Object) @($template.AllowedLocations | Sort-Object))) {
            Add-Result -Area 'Region' -Check 'Portal form region list' -Status WARN -Detail "createUiDefinition.json offers $($uiRegions -join ', '); the template allows $($template.AllowedLocations -join ', ')" -Fix 'Keep config.basics.location.allowedValues in createUiDefinition.json equal to the template list.'
        } elseif ($uiRegions.Count -and -not (Test-RegionInList -Region $Location -List $uiRegions)) {
            Add-Result -Area 'Region' -Check 'Portal form region list' -Status WARN -Detail "$Location is not offered by the portal form" -Fix 'Deploy from the command line, or add the region to createUiDefinition.json.'
        }
    } catch {
        Add-Result -Area 'Region' -Check 'Portal form region list' -Status WARN -Detail "cannot read createUiDefinition.json: $($_.Exception.Message)"
    }
}

foreach ($ns in $namespaces.Keys) {
    $resources = @($namespaces[$ns])
    $applies = if ($ns -eq 'Microsoft.ContainerInstance' -and -not $resources.Count) { $scriptApplies } else { Join-Applies @($resources | ForEach-Object { $_.Applies }) }
    $types = @($resources | ForEach-Object { $_.Type } | Sort-Object -Unique)
    $why = if ($types.Count) { "declares $(($types | ForEach-Object { $_.Substring($ns.Length + 1) }) -join ', ')" } else { 'runs the deploymentScripts container' }
    if ($applies -eq 'no') {
        Add-Skip -Area 'Providers' -Check $ns -Why "not used by the selected components ($why)"
        continue
    }
    $provider = Invoke-AzCli -Arguments @('provider', 'show', '--namespace', $ns, '--subscription', $SubscriptionId)
    if (-not $provider.Ok) {
        Add-Result -Area 'Providers' -Check $ns -Status WARN -Detail "cannot read provider: $($provider.Error)" -Applies $applies
        continue
    }
    $state = [string]$provider.Json.registrationState
    switch ($state) {
        'Registered' { Add-Result -Area 'Providers' -Check $ns -Status PASS -Detail "Registered; $why" }
        'Registering' { Add-Result -Area 'Providers' -Check $ns -Status WARN -Detail "Registering; $why" -Fix "Wait until az provider show --namespace $ns --query registrationState returns Registered." -Applies $applies }
        default { Add-Result -Area 'Providers' -Check $ns -Status FAIL -Detail "$state; $why" -Fix "az provider register --namespace $ns --subscription $SubscriptionId (then wait for Registered)" -Applies $applies }
    }
    $missingRegion = @(); $missingApi = @(); $checked = @()
    foreach ($r in ($resources | Where-Object { $_.Applies -ne 'no' })) {
        $typeName = $r.Type.Substring($ns.Length + 1)
        $meta = @($provider.Json.resourceTypes | Where-Object { $_.resourceType -ieq $typeName }) | Select-Object -First 1
        if (-not $meta) { continue }
        $locations = @($meta.locations | Where-Object { $_ })
        if ($locations.Count) { $checked += $typeName }   # global types (no region list) are not region-checked
        if ($locations.Count -and -not (Test-RegionInList -Region $Location -List $locations)) { $missingRegion += $typeName }
        $apis = @($meta.apiVersions | Where-Object { $_ })
        if ($apis.Count -and $r.ApiVersion -and ($apis -notcontains $r.ApiVersion)) { $missingApi += "$typeName@$($r.ApiVersion)" }
    }
    if ($missingRegion.Count) {
        Add-Result -Area 'Region' -Check "$ns in $Location" -Status FAIL -Detail "not offered in $($Location): $(($missingRegion | Sort-Object -Unique) -join ', ')" -Fix 'Pick another allowed region, or turn off the component that needs this resource type.' -Applies $applies
    } elseif ($checked.Count) {
        Add-Result -Area 'Region' -Check "$ns in $Location" -Status PASS -Detail "offered: $(($checked | Sort-Object -Unique) -join ', ')"
    }
    if ($missingApi.Count) {
        Add-Result -Area 'Region' -Check "$ns API versions" -Status WARN -Detail "API versions not listed by the provider in this cloud: $(($missingApi | Sort-Object -Unique) -join ', ')" -Fix 'Check the provider''s supported API versions; update main.bicep if this cloud lags.' -Applies $applies
    }
}

# ------------------------------------------------------------------------------------------
# Fabric capacity
# ------------------------------------------------------------------------------------------
$fabricApplies = Get-Applies 'fabricPlane'
if ($fabricApplies -eq 'no') {
    Add-Skip -Area 'Fabric' -Check 'Fabric capacity' -Why 'the Fabric plane is not selected'
} else {
    $createApplies = if ($script:SelectionKnown) { Get-Applies 'createCapacity' } else { 'unknown' }
    if ($createApplies -ne 'no') {
        $sku = [string](Get-Setting 'fabricCapacitySku')
        if (-not $sku) { $sku = 'F2' }
        $cuNeeded = if ($sku -match '^F(\d+)$') { [int]$Matches[1] } else { 0 }
        $skus = Invoke-ArmGet -Path "/subscriptions/$SubscriptionId/providers/Microsoft.Fabric/skus" -ApiVersion '2023-11-01'
        if ($skus.Ok) {
            $entry = @($skus.Json.value | Where-Object { $_.name -eq $sku }) | Select-Object -First 1
            if ($entry -and (Test-RegionInList -Region $Location -List @($entry.locations))) {
                Add-Result -Area 'Fabric' -Check "Capacity SKU $sku" -Status PASS -Detail "offered in $Location"
            } elseif ($entry) {
                Add-Result -Area 'Fabric' -Check "Capacity SKU $sku" -Status FAIL -Detail "not offered in $Location" -Fix 'Pick another fabricCapacitySku or region, or reuse an existing capacity (fabricCapacityId).' -Applies $createApplies
            } else {
                Add-Result -Area 'Fabric' -Check "Capacity SKU $sku" -Status WARN -Detail 'SKU not returned by Microsoft.Fabric/skus' -Fix 'Check the SKU name (F2 ... F2048).' -Applies $createApplies
            }
        } else {
            Add-Result -Area 'Fabric' -Check "Capacity SKU $sku" -Status WARN -Detail "cannot list Fabric SKUs: $($skus.Error)" -Fix 'Register Microsoft.Fabric (see Providers) and re-run.' -Applies $createApplies
        }
        $usage = Invoke-ArmGet -Path "/subscriptions/$SubscriptionId/providers/Microsoft.Fabric/locations/$Location/usages" -ApiVersion '2023-11-01'
        $cap = if ($usage.Ok) { @($usage.Json.value | Where-Object { $_.name.value -eq 'CapacityQuota' }) | Select-Object -First 1 } else { $null }
        if ($cap) {
            $available = [int]$cap.limit - [int]$cap.currentValue
            if ($available -ge $cuNeeded) {
                Add-Result -Area 'Fabric' -Check 'Capacity-unit quota' -Status PASS -Detail "limit $($cap.limit), used $($cap.currentValue), available $available CU (need $cuNeeded for $sku)"
            } else {
                Add-Result -Area 'Fabric' -Check 'Capacity-unit quota' -Status FAIL -Detail "available $available CU, need $cuNeeded for $sku (limit $($cap.limit), used $($cap.currentValue))" -Fix "Request Fabric capacity-unit quota for $Location in the Quotas blade (self-serve): $QuotasBlade" -Applies $createApplies
            }
        } else {
            $why = if ($usage.Ok) { 'CapacityQuota not returned' } else { $usage.Error }
            Add-Result -Area 'Fabric' -Check 'Capacity-unit quota' -Status WARN -Detail "cannot read Fabric quota ($why)" -Fix "A zero Fabric quota is usually an unregistered Microsoft.Fabric provider; register it, wait a few minutes, re-run. Portal: $QuotasBlade" -Applies $createApplies
        }
    }

    $capacityId = [string](Get-Setting 'fabricCapacityId')
    if ($capacityId -and -not $components.createCapacity) {
        $existingApplies = if ($script:SelectionKnown) { 'yes' } else { 'unknown' }
        $capacityGuid = $null
        $capacityName = $null
        if ($capacityId -match '/providers/Microsoft\.Fabric/capacities/([^/]+)$') {
            $capacityName = $Matches[1]
            $capRes = Invoke-ArmGet -Path $capacityId -ApiVersion '2023-11-01'
            if ($capRes.Ok) {
                $stateText = [string]$capRes.Json.properties.state
                $detail = "$capacityName ($($capRes.Json.sku.name), $($capRes.Json.location)) is $stateText"
                if ($stateText -eq 'Active') { Add-Result -Area 'Fabric' -Check 'Existing capacity' -Status PASS -Detail $detail }
                else { Add-Result -Area 'Fabric' -Check 'Existing capacity' -Status FAIL -Detail $detail -Fix "Resume it: az fabric capacity resume --resource-group <rg> --capacity-name $capacityName (or from the portal)." -Applies $existingApplies }
                $admins = @($capRes.Json.properties.administration.members)
                $identity = if ($rgExists) { Invoke-AzCli -Arguments @('identity', 'show', '--name', 'pcpro-fabricplane-identity', '--resource-group', $ResourceGroupName, '--subscription', $SubscriptionId) } else { $null }
                if ($identity -and $identity.Ok) {
                    if ($admins -contains [string]$identity.Json.principalId) {
                        Add-Result -Area 'Fabric' -Check 'Capacity admin for the deployment identity' -Status PASS -Detail 'pcpro-fabricplane-identity is a capacity administrator'
                    } else {
                        Add-Result -Area 'Fabric' -Check 'Capacity admin for the deployment identity' -Status WARN -Detail 'pcpro-fabricplane-identity exists but is not a capacity administrator' -Fix "Add its object ID ($($identity.Json.principalId)) as a capacity admin, or give it Contributor on the capacity in the Fabric Admin portal."
                    }
                } else {
                    Add-Result -Area 'Fabric' -Check 'Capacity admin for the deployment identity' -Status WARN -Detail 'pcpro-fabricplane-identity is created by the first deployment and needs Contributor or Admin rights on this capacity' -Fix 'After the first run, add the identity as a capacity admin in the Fabric Admin portal and redeploy (safe to repeat).'
                }
            } else {
                Add-Result -Area 'Fabric' -Check 'Existing capacity' -Status FAIL -Detail "cannot read $($capacityId): $($capRes.Error)" -Fix 'Check the resource ID and that the account has at least Reader on the capacity.' -Applies $existingApplies
            }
        } elseif ($capacityId -match '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$') {
            $capacityGuid = $capacityId
        } else {
            Add-Result -Area 'Fabric' -Check 'Existing capacity' -Status FAIL -Detail "fabricCapacityId '$capacityId' is neither a capacity resource ID nor a GUID" -Fix 'Use /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Fabric/capacities/<name> or the capacity GUID.' -Applies $existingApplies
        }
        # Fabric REST: is the capacity visible to (usable by) the signed-in account?
        $fabricToken = if ($capacityGuid -or $capacityName) { Get-AccessToken -Resource 'https://api.fabric.microsoft.com' } else { $null }
        if (-not ($capacityGuid -or $capacityName)) {
            # fabricCapacityId is malformed; already reported above.
        } elseif ($fabricToken) {
            try {
                $list = Invoke-RestMethod -Uri 'https://api.fabric.microsoft.com/v1/capacities' -Headers @{ Authorization = "Bearer $fabricToken" } -TimeoutSec 60
                $match = @($list.value | Where-Object { ($capacityGuid -and $_.id -eq $capacityGuid) -or ($capacityName -and $_.displayName -eq $capacityName) }) | Select-Object -First 1
                if ($match) {
                    $status = if ($match.state -eq 'Active') { 'PASS' } else { 'FAIL' }
                    Add-Result -Area 'Fabric' -Check 'Capacity access (Fabric)' -Status $status -Detail "$($match.displayName) [$($match.id)] $($match.sku) in $($match.region) is $($match.state) and visible to the caller" -Fix 'Resume the capacity before deploying; the Fabric plane cannot create its workspace on a paused capacity.' -Applies $existingApplies
                } else {
                    Add-Result -Area 'Fabric' -Check 'Capacity access (Fabric)' -Status WARN -Detail 'the capacity is not in the list of capacities the caller can use' -Fix 'Ask a capacity admin to add you (and later pcpro-fabricplane-identity) as admin or contributor on the capacity.' -Applies $existingApplies
                }
            } catch {
                Add-Result -Area 'Fabric' -Check 'Capacity access (Fabric)' -Status WARN -Detail "Fabric REST call failed: $($_.Exception.Message)" -Applies $existingApplies
            }
        } else {
            Add-Result -Area 'Fabric' -Check 'Capacity access (Fabric)' -Status WARN -Detail 'cannot get a Fabric API token for the signed-in account' -Fix 'Sign in with an account in the Fabric tenant (az login) and re-run.' -Applies $existingApplies
        }
    }
    Add-Result -Area 'Fabric' -Check 'Fabric tenant setting (manual)' -Status WARN -Detail "cannot be read from Azure: 'Service principals can create workspaces, connections, and deployment pipelines' must be enabled for pcpro-fabricplane-identity or a group containing it" -Fix 'Ask a Fabric administrator to confirm it in the Fabric Admin portal > Tenant settings.' -Applies $fabricApplies
}

# ------------------------------------------------------------------------------------------
# Azure OpenAI (AI agent)
# ------------------------------------------------------------------------------------------
$aiApplies = Get-Applies 'aiAgent'
if ($aiApplies -eq 'no') {
    Add-Skip -Area 'AI' -Check 'Azure OpenAI model' -Why 'the AI agent is not selected'
} else {
    $modelName = [string](Get-Setting 'openAiModelName')
    $modelVersion = [string](Get-Setting 'openAiModelVersion')
    $modelSku = [string](Get-Setting 'openAiSkuName')
    $capacity = [int](Get-Setting 'openAiCapacity')
    $models = Invoke-AzCli -Arguments @('cognitiveservices', 'model', 'list', '--location', $Location, '--subscription', $SubscriptionId)
    if ($models.Ok) {
        $candidates = @($models.Json | Where-Object { $_.kind -eq 'OpenAI' -and $_.model.name -eq $modelName })
        $exact = @($candidates | Where-Object { $_.model.version -eq $modelVersion }) | Select-Object -First 1
        if (-not $candidates.Count) {
            Add-Result -Area 'AI' -Check "Model $modelName" -Status FAIL -Detail "not offered in $Location" -Fix 'Pick a region that offers the model, or override openAiModelName/openAiModelVersion.' -Applies $aiApplies
        } elseif (-not $exact) {
            $versions = ($candidates | ForEach-Object { $_.model.version } | Sort-Object -Unique) -join ', '
            Add-Result -Area 'AI' -Check "Model $modelName" -Status FAIL -Detail "version $modelVersion not offered in $Location (offered: $versions)" -Fix 'Set openAiModelVersion to an offered version.' -Applies $aiApplies
        } elseif (@($exact.model.skus | ForEach-Object { $_.name }) -notcontains $modelSku) {
            Add-Result -Area 'AI' -Check "Model $modelName" -Status FAIL -Detail "$modelVersion is offered but not with SKU $modelSku (offered: $(($exact.model.skus | ForEach-Object { $_.name }) -join ', '))" -Fix 'Set openAiSkuName to an offered deployment type.' -Applies $aiApplies
        } else {
            Add-Result -Area 'AI' -Check "Model $modelName" -Status PASS -Detail "$modelVersion with $modelSku offered in $Location"
        }
    } else {
        Add-Result -Area 'AI' -Check "Model $modelName" -Status WARN -Detail "cannot list models: $($models.Error)" -Applies $aiApplies
    }
    $usages = Invoke-AzCli -Arguments @('cognitiveservices', 'usage', 'list', '--location', $Location, '--subscription', $SubscriptionId)
    $quotaName = "OpenAI.$modelSku.$modelName"
    $quota = if ($usages.Ok) { @($usages.Json | Where-Object { $_.name.value -eq $quotaName }) | Select-Object -First 1 } else { $null }
    if ($quota) {
        $available = [int]$quota.limit - [int]$quota.currentValue
        if ($available -ge $capacity) {
            Add-Result -Area 'AI' -Check 'Azure OpenAI quota' -Status PASS -Detail "$quotaName available $available (need $capacity thousand TPM)"
        } else {
            Add-Result -Area 'AI' -Check 'Azure OpenAI quota' -Status FAIL -Detail "$quotaName available $available, need $capacity (limit $($quota.limit), used $($quota.currentValue))" -Fix 'Lower openAiCapacity, free quota from another deployment, or request more in the Foundry portal (Quotas).' -Applies $aiApplies
        }
    } else {
        $why = if ($usages.Ok) { "$quotaName not listed" } else { $usages.Error }
        Add-Result -Area 'AI' -Check 'Azure OpenAI quota' -Status WARN -Detail "cannot read quota ($why)" -Fix 'Check the quota in the Foundry portal > Management > Quota.' -Applies $aiApplies
    }
    if ($ResourceGroupName) {
        $deleted = Invoke-AzCli -Arguments @('cognitiveservices', 'account', 'list-deleted', '--subscription', $SubscriptionId)
        if ($deleted.Ok) {
            $rgPattern = '/resourceGroups/' + [regex]::Escape($ResourceGroupName) + '/deletedAccounts/pcpro-oai-'
            $blocking = @($deleted.Json | Where-Object { [string]$_.id -imatch $rgPattern })
            if ($blocking.Count) {
                $names = ($blocking | ForEach-Object { "$($_.name) ($($_.location))" }) -join ', '
                Add-Result -Area 'AI' -Check 'Soft-deleted Azure OpenAI accounts' -Status FAIL -Detail "$names was deleted from $ResourceGroupName and still holds the name the template derives for this resource group" -Fix "Purge it first: az cognitiveservices account purge --name <name> --resource-group $ResourceGroupName --location <location>" -Applies $aiApplies
            } else {
                Add-Result -Area 'AI' -Check 'Soft-deleted Azure OpenAI accounts' -Status PASS -Detail "none from $ResourceGroupName"
            }
        } else {
            Add-Result -Area 'AI' -Check 'Soft-deleted Azure OpenAI accounts' -Status WARN -Detail "cannot list deleted accounts: $($deleted.Error)" -Applies $aiApplies
        }
    }
}

# ------------------------------------------------------------------------------------------
# Aurora: NC A100 v4 availability and Azure ML quota
# ------------------------------------------------------------------------------------------
$auroraApplies = Get-Applies 'auroraModel'
if ($auroraApplies -eq 'no') {
    Add-Skip -Area 'Aurora' -Check 'GPU quota' -Why 'the Aurora model is not selected'
} else {
    $gpuApplies = if (-not $script:SelectionKnown) { 'unknown' } elseif ($components.auroraDeployment) { 'yes' } else { 'unknown' }
    $size = [string](Get-Setting 'auroraInstanceType')
    if (-not $size) { $size = 'Standard_NC24ads_A100_v4' }
    $family = $null
    $vcpus = 0
    $skuInfo = Invoke-AzCli -Arguments @('vm', 'list-skus', '--location', $Location, '--size', $size, '--resource-type', 'virtualMachines', '--subscription', $SubscriptionId)
    $skuEntry = if ($skuInfo.Ok) { @($skuInfo.Json | Where-Object { $_.name -eq $size }) | Select-Object -First 1 } else { $null }
    if ($skuEntry) {
        $family = [string]$skuEntry.family
        $vcpus = [int](@($skuEntry.capabilities | Where-Object { $_.name -eq 'vCPUs' }) | Select-Object -First 1).value
        $restricted = @($skuEntry.restrictions | Where-Object { $_.type -eq 'Location' })
        if ($restricted.Count) {
            Add-Result -Area 'Aurora' -Check "VM size $size" -Status FAIL -Detail "restricted for this subscription in $Location ($($restricted[0].reasonCode))" -Fix 'Request access to the size through a quota/support request, or use another region.' -Applies $gpuApplies
        } else {
            Add-Result -Area 'Aurora' -Check "VM size $size" -Status PASS -Detail "offered in $Location (family $family, $vcpus vCPUs)"
        }
    } else {
        Add-Result -Area 'Aurora' -Check "VM size $size" -Status FAIL -Detail "not offered in $Location$(if (-not $skuInfo.Ok) { " ($($skuInfo.Error))" })" -Fix 'Aurora needs an A100-class size; pick a region that offers it.' -Applies $gpuApplies
    }
    if (-not $family -and $size -match '^Standard_NC(\d+)ads_A100_v4$') { $family = 'standardNCADSA100v4Family'; $vcpus = [int]$Matches[1] }
    if ($family -and $vcpus) {
        # Managed online endpoints reserve about 20% extra for upgrades.
        $need = [int][math]::Ceiling(1.2 * $vcpus)
        $source = 'Azure ML'
        $aml = Invoke-ArmGet -Path "/subscriptions/$SubscriptionId/providers/Microsoft.MachineLearningServices/locations/$Location/usages" -ApiVersion '2024-04-01'
        $usage = if ($aml.Ok) { @($aml.Json.value | Where-Object { $_.name.value -ieq $family }) | Select-Object -First 1 } else { $null }
        if (-not $usage) {
            $source = 'Compute'
            $vmUsage = Invoke-AzCli -Arguments @('vm', 'list-usage', '--location', $Location, '--subscription', $SubscriptionId)
            $usage = if ($vmUsage.Ok) { @($vmUsage.Json | Where-Object { $_.name.value -ieq $family }) | Select-Object -First 1 } else { $null }
        }
        if ($usage) {
            $available = [int]$usage.limit - [int]$usage.currentValue
            $detail = "$source quota for $($family): limit $($usage.limit), used $($usage.currentValue), available $available (need $need incl. 20% endpoint reserve)"
            if ($available -ge $need) {
                Add-Result -Area 'Aurora' -Check 'A100 dedicated-core quota' -Status PASS -Detail $detail
            } else {
                $note = if ($components.auroraDeployment) { '' } else { '; the template only needs it when createAuroraModelDeployment or auroraModelAssetId is set' }
                Add-Result -Area 'Aurora' -Check 'A100 dedicated-core quota' -Status FAIL -Detail "$detail$note" -Fix "Request $family quota in $Location ($QuotasBlade, Machine Learning), or run preflight-quota.ps1 -RequestGpuQuota. The studio's shared-quota path does not apply to template deployments." -Applies $gpuApplies
            }
        } else {
            Add-Result -Area 'Aurora' -Check 'A100 dedicated-core quota' -Status WARN -Detail "cannot read quota for $family in $Location" -Fix "Check Machine Learning quota in $QuotasBlade." -Applies $gpuApplies
        }
    }
    if ($components.auroraDeployment -or -not $script:SelectionKnown) {
        Add-Result -Area 'Aurora' -Check 'Aurora model terms (manual)' -Status WARN -Detail 'the GPU model deployment needs accepted Azure Marketplace terms for the Aurora model; this cannot be read from Azure' -Fix 'Accept the terms once from the Aurora model card in the Azure AI Foundry / Azure ML model catalog.' -Applies $gpuApplies
    }
}

# ------------------------------------------------------------------------------------------
# App Service plan for the OneGrid web app
# ------------------------------------------------------------------------------------------
$appApplies = Get-Applies 'oneGridApp'
if ($appApplies -eq 'no') {
    Add-Skip -Area 'App Service' -Check 'Plan availability' -Why 'the OneGrid web app is not selected'
} else {
    $planSku = ([string](Get-Setting 'chatAgentAppServiceSku')).ToUpperInvariant()
    if (-not $planSku) { $planSku = 'B1' }
    $locations = Invoke-AzCli -Arguments @('appservice', 'list-locations', '--sku', $planSku, '--linux-workers-enabled', '--subscription', $SubscriptionId)
    if ($locations.Ok) {
        if (Test-RegionInList -Region $Location -List @($locations.Json | ForEach-Object { $_.name })) {
            Add-Result -Area 'App Service' -Check "Plan SKU $planSku (Linux)" -Status PASS -Detail "offered in $Location"
        } else {
            Add-Result -Area 'App Service' -Check "Plan SKU $planSku (Linux)" -Status FAIL -Detail "not offered for Linux in $Location" -Fix 'Pick another chatAgentAppServiceSku or region. Plan quota itself is reported by az deployment group validate (InternalSubscriptionIsOverQuotaForSku).' -Applies $appApplies
        }
    } else {
        Add-Result -Area 'App Service' -Check "Plan SKU $planSku (Linux)" -Status WARN -Detail "cannot list App Service locations: $($locations.Error)" -Applies $appApplies
    }
    if ($template.LinuxFxVersion) {
        $runtimes = Invoke-AzCli -Arguments @('webapp', 'list-runtimes', '--os-type', 'linux')
        if ($runtimes.Ok) {
            $wanted = $template.LinuxFxVersion.Replace('|', ':')
            $offered = @($runtimes.Json | ForEach-Object { ([string]$_).Replace('|', ':') })
            if ($offered -icontains $wanted) {
                Add-Result -Area 'App Service' -Check 'Node runtime' -Status PASS -Detail "$($template.LinuxFxVersion) is a supported Linux runtime"
            } else {
                Add-Result -Area 'App Service' -Check 'Node runtime' -Status WARN -Detail "$($template.LinuxFxVersion) (main.bicep linuxFxVersion) is not in az webapp list-runtimes" -Fix 'Move main.bicep to a supported Node LTS runtime and rebuild azuredeploy.json.' -Applies $appApplies
            }
        } else {
            Add-Result -Area 'App Service' -Check 'Node runtime' -Status WARN -Detail "cannot list runtimes: $($runtimes.Error)" -Applies $appApplies
        }
    }
}

# ------------------------------------------------------------------------------------------
# Azure Policy signals (informational)
# ------------------------------------------------------------------------------------------
# Built-in definitions that commonly block this template, by definition GUID.
$knownPolicies = @{
    '8c6a50c6-9ffd-4ae7-986f-5fa6111f9a54' = 'storage-shared-key'      # Storage accounts should prevent shared key access
    'b2982f36-99f2-4db5-8eff-283140c09693' = 'storage-public-network'  # Storage accounts should disable public network access
    'e56962a6-4747-49cd-b67b-bf8b01975c4c' = 'allowed-locations'       # Allowed locations
    'e765b5de-1225-4ba3-bd56-1ac6695af988' = 'allowed-locations'       # Allowed locations for resource groups
    '6c112d4e-5bc7-47ae-a041-ea2d9dccd749' = 'resource-types'          # Not allowed resource types
    'a08ec900-254a-4555-9bf5-e42af04b5c5c' = 'resource-types'          # Allowed resource types
    '0b60c0b2-2dc2-4e1c-b5c9-abbed971de53' = 'keyvault-purge'          # Key vaults should have deletion protection enabled
    '71ef260a-8f18-47b7-abcb-62d0673d94dc' = 'ai-local-auth'           # Azure AI Services resources should have key access disabled
}
$categoryText = @{
    'storage-shared-key'     = @('Storage shared-key access', 'deploymentScripts need shared-key storage (KeyBasedAuthenticationNotPermitted)', 'If your organization allows it, set exemptStorageFromPolicy=true with the tag the policy honors (MCAPS: SecurityControl=Ignore).')
    'storage-public-network' = @('Storage public network access', 'the web app mounts its package and deploymentScripts reach storage over the public endpoint', 'Set exemptStorageFromPolicy=true with the policy''s opt-out tag if allowed, or plan private networking (docs/deployment-and-data-guide.md).')
    'allowed-locations'      = @('Allowed locations', "the region $Location must be allowed for resources and resource groups", "Confirm $Location is in the policy's allowed list.")
    'resource-types'         = @('Allowed / not allowed resource types', 'GeoCatalog, Fabric capacity, deploymentScripts, Azure ML or Container Apps may be denied', 'Review the policy''s type list against the Providers results above.')
    'keyvault-purge'         = @('Key Vault deletion protection', 'the Aurora Azure ML key vault does not enable purge protection', 'Request an exemption for the Aurora resources, or leave deployAuroraModel off.')
    'ai-local-auth'          = @('AI services local auth', 'the Azure OpenAI account keeps key access enabled', 'Request an exemption, or confirm the policy effect is Audit.')
}
$assignments = @()
$pa = Invoke-AzCli -Arguments @('policy', 'assignment', 'list', '--scope', $subscriptionScope, '--disable-scope-strict-match', '--subscription', $SubscriptionId)
if ($pa.Ok) { $assignments += @($pa.Json) }
if ($rgExists) {
    $paRg = Invoke-AzCli -Arguments @('policy', 'assignment', 'list', '--resource-group', $ResourceGroupName, '--subscription', $SubscriptionId)
    if ($paRg.Ok) { $assignments += @($paRg.Json) }
}
if (-not $pa.Ok) {
    Add-Result -Area 'Policy' -Check 'Policy assignments' -Status WARN -Detail "cannot list policy assignments: $($pa.Error)" -Fix 'Ask the platform team which deny policies apply to the subscription.'
} else {
    $assignments = @($assignments | Where-Object { $_.enforcementMode -ne 'DoNotEnforce' } | Sort-Object id -Unique)
    $hits = @{}
    $definitionCache = @{}
    $fetches = 0
    foreach ($assignment in $assignments) {
        $definitionIds = @([string]$assignment.policyDefinitionId)
        if ($definitionIds[0] -match '/policySetDefinitions/' -and $fetches -lt 60) {
            $fetches++
            $set = Invoke-ArmGet -Path $definitionIds[0] -ApiVersion '2021-06-01'
            if ($set.Ok) { $definitionIds = @($set.Json.properties.policyDefinitions | ForEach-Object { [string]$_.policyDefinitionId }) }
        }
        foreach ($definitionId in $definitionIds) {
            $guid = ($definitionId -split '/')[-1].ToLowerInvariant()
            $category = $knownPolicies[$guid]
            if (-not $category -and $definitionId -notmatch '^/providers/Microsoft\.Authorization/policyDefinitions/' -and $fetches -lt 300) {
                # Custom definition: look for the aliases this template depends on.
                if (-not $definitionCache.ContainsKey($definitionId)) {
                    $fetches++
                    $def = Invoke-ArmGet -Path $definitionId -ApiVersion '2021-06-01'
                    $definitionCache[$definitionId] = if ($def.Ok) { $def.Json.properties.policyRule | ConvertTo-Json -Depth 32 -Compress } else { '' }
                }
                $rule = $definitionCache[$definitionId]
                if ($rule -match 'storageAccounts/allowSharedKeyAccess') { $category = 'storage-shared-key' }
                elseif ($rule -match 'storageAccounts/publicNetworkAccess|storageAccounts/networkAcls\.defaultAction') { $category = 'storage-public-network' }
                elseif ($rule -match '"field":"location"' -and $rule -match 'notIn') { $category = 'allowed-locations' }
            }
            if ($category) {
                if (-not $hits.ContainsKey($category)) { $hits[$category] = [System.Collections.Generic.List[string]]::new() }
                $label = if ($assignment.displayName) { $assignment.displayName } else { $assignment.name }
                if (-not $hits[$category].Contains($label)) { $hits[$category].Add($label) }
                if ($category -eq 'allowed-locations' -and $assignment.parameters.listOfAllowedLocations.value) {
                    $allowedList = @($assignment.parameters.listOfAllowedLocations.value)
                    if (-not (Test-RegionInList -Region $Location -List $allowedList)) { $hits[$category].Add("($label does not list $Location)") }
                }
            }
        }
    }
    if (-not $hits.Count) {
        Add-Result -Area 'Policy' -Check 'Blocking policy signals' -Status PASS -Detail "none found in $($assignments.Count) enforced assignment(s) visible to the caller (management-group assignments may be hidden)"
    }
    foreach ($category in $hits.Keys) {
        $text = $categoryText[$category]
        $status = 'WARN'
        $detail = "$($text[1]); assignment(s): $(($hits[$category] | Select-Object -First 4) -join '; ')"
        if ($category -in 'storage-shared-key', 'storage-public-network' -and $components.exemptStorage) {
            $status = 'PASS'
            $detail = "exemptStorageFromPolicy=true (tag $(Get-Setting 'storagePolicyExemptionTagName')=$(Get-Setting 'storagePolicyExemptionTagValue')); confirm the policy honors that tag. $detail"
        }
        Add-Result -Area 'Policy' -Check $text[0] -Status $status -Detail $detail -Fix $text[2]
    }
}
$signs = @()
if ("$($sub.name) $($sub.tenantDefaultDomain)" -match 'MCAP') { $signs += 'the subscription or tenant name contains MCAP' }
$storage = Invoke-AzCli -Arguments @('storage', 'account', 'list', '--subscription', $SubscriptionId)
if ($storage.Ok) {
    $accounts = @($storage.Json)
    $keyOff = @($accounts | Where-Object { $_.allowSharedKeyAccess -eq $false })
    if ($accounts.Count -ge 2 -and $keyOff.Count -eq $accounts.Count) { $signs += "all $($accounts.Count) existing storage accounts have shared-key access off" }
}
if ($signs.Count -and -not $components.exemptStorage) {
    Add-Result -Area 'Policy' -Check 'Storage policy signs' -Status WARN -Detail ($signs -join '; ') -Fix 'Likely a storage shared-key/public-access deny policy. Ask whether exemptStorageFromPolicy=true is allowed (see DEPLOY-WITH-COPILOT.md step 2.7).'
} elseif ($signs.Count) {
    Add-Result -Area 'Policy' -Check 'Storage policy signs' -Status PASS -Detail "$($signs -join '; '); exemptStorageFromPolicy is already true"
}

# ------------------------------------------------------------------------------------------
# Identity: Microsoft Graph grant, sign-in and Import-model refresh
# ------------------------------------------------------------------------------------------
$graphRoles = @{
    '62e90394-69f5-4237-9190-012177145e10' = 'Global Administrator'
    'e8611ab8-c189-46e8-94e1-60213ab1f814' = 'Privileged Role Administrator'
}
$graphApplies = if ($script:SelectionKnown) { Get-Applies 'graphGrant' } else { 'unknown' }
if ($graphApplies -eq 'no') {
    Add-Skip -Area 'Identity' -Check 'Microsoft Graph grant' -Why 'grantProvisionerGraphPermission is off (or the Fabric plane is not selected)'
} else {
    $rolesUrl = if ($callerType -eq 'user') { 'https://graph.microsoft.com/v1.0/me/memberOf/microsoft.graph.directoryRole' }
    elseif ($callerObjectId) { "https://graph.microsoft.com/v1.0/servicePrincipals/$callerObjectId/memberOf/microsoft.graph.directoryRole" }
    else { $null }
    $held = @()
    $graphError = 'the caller object ID could not be resolved'
    if ($rolesUrl) {
        $dirRoles = Invoke-AzCli -Arguments @('rest', '--method', 'get', '--url', $rolesUrl)
        if ($dirRoles.Ok) {
            $graphError = $null
            $held = @($dirRoles.Json.value | Where-Object { $graphRoles.ContainsKey([string]$_.roleTemplateId) } | ForEach-Object { $graphRoles[[string]$_.roleTemplateId] })
        } else { $graphError = $dirRoles.Error }
    }
    $appRoleOk = $false
    if ($callerType -ne 'user' -and $callerObjectId) {
        $assigned = Invoke-AzCli -Arguments @('rest', '--method', 'get', '--url', "https://graph.microsoft.com/v1.0/servicePrincipals/$callerObjectId/appRoleAssignments")
        # AppRoleAssignment.ReadWrite.All (application permission) lets a service principal grant app roles.
        if ($assigned.Ok) { $appRoleOk = @($assigned.Json.value | Where-Object { $_.appRoleId -eq '06b708a9-e830-4db3-a914-8e69da51d44f' }).Count -gt 0 }
    }
    if ($held.Count -or $appRoleOk) {
        $how = if ($held.Count) { $held -join ', ' } else { 'AppRoleAssignment.ReadWrite.All' }
        Add-Result -Area 'Identity' -Check 'Microsoft Graph grant' -Status PASS -Detail "the caller can grant Application.ReadWrite.OwnedBy ($how)"
    } elseif ($graphError) {
        Add-Result -Area 'Identity' -Check 'Microsoft Graph grant' -Status WARN -Detail "cannot read directory roles: $graphError" -Fix 'Confirm the deployer is an active Global Administrator or Privileged Role Administrator.' -Applies $graphApplies
    } else {
        Add-Result -Area 'Identity' -Check 'Microsoft Graph grant' -Status FAIL -Detail 'grantProvisionerGraphPermission needs an active Global Administrator or Privileged Role Administrator role (PIM-eligible roles must be activated)' -Fix 'Activate the role, have an administrator deploy, or set grantProvisionerGraphPermission=false and supply entraSignInClientId and refreshServicePrincipal* instead.' -Applies $graphApplies
    }
}
if ($script:SelectionKnown -and $components.oneGridApp) {
    $signIn = [bool](Get-Setting 'enableEntraSignIn')
    if ($signIn -and -not (Get-Setting 'entraSignInClientId') -and -not $components.graphGrant) {
        Add-Result -Area 'Identity' -Check 'Sign-in app registration' -Status WARN -Detail 'enableEntraSignIn is on, but neither entraSignInClientId nor the Graph grant is set, so the sign-in app cannot be created automatically' -Fix 'Supply entraSignInClientId (SPA redirect https://<app-host>/auth/callback) or enable grantProvisionerGraphPermission.'
    } elseif ($signIn) {
        Add-Result -Area 'Identity' -Check 'Sign-in app registration' -Status PASS -Detail $(if (Get-Setting 'entraSignInClientId') { 'existing app registration supplied' } else { 'created by the provisioner through the Graph grant' })
    }
    if ([bool](Get-Setting 'deployUnifiedModel')) {
        $refreshId = [string](Get-Setting 'refreshServicePrincipalClientId')
        if (-not $components.graphGrant -and -not $refreshId) {
            Add-Result -Area 'Identity' -Check 'Import model refresh identity' -Status WARN -Detail 'deployUnifiedModel is on without the Graph grant or a refresh service principal; OneGridModelImport is deployed but not refreshed' -Fix 'Supply refreshServicePrincipalClientId/ObjectId/Secret or enable grantProvisionerGraphPermission.'
        } elseif ($refreshId -and -not (Get-Setting 'refreshServicePrincipalObjectId')) {
            Add-Result -Area 'Identity' -Check 'Import model refresh identity' -Status WARN -Detail 'refreshServicePrincipalClientId is set without refreshServicePrincipalObjectId' -Fix 'Add the service principal (enterprise application) object ID; pass the secret at deployment time, not in a committed file.'
        } else {
            Add-Result -Area 'Identity' -Check 'Import model refresh identity' -Status PASS -Detail $(if ($components.graphGrant) { 'created by the provisioner through the Graph grant' } else { 'refresh service principal supplied' })
        }
    }
}

# ------------------------------------------------------------------------------------------
# Summary and evidence
# ------------------------------------------------------------------------------------------
$counts = [ordered]@{}
foreach ($s in 'PASS', 'WARN', 'FAIL', 'SKIP') { $counts[$s] = @($script:Results | Where-Object { $_.Status -eq $s }).Count }
Write-Host ''
$script:Results | Format-Table Area, Status, Check, Detail -AutoSize -Wrap | Out-String -Width 220 | Write-Host
$summaryColor = if ($counts.FAIL) { 'Red' } elseif ($counts.WARN) { 'Yellow' } else { 'Green' }
Write-Host ("PREREQUISITES: {0} pass, {1} warn, {2} fail, {3} skipped" -f $counts.PASS, $counts.WARN, $counts.FAIL, $counts.SKIP) -ForegroundColor $summaryColor

if ($OutputPath) {
    $evidence = [ordered]@{
        schema      = 'onegrid-prerequisites/v1'
        tool        = [ordered]@{ name = 'Test-OneGridPrerequisites.ps1'; version = $ToolVersion; templateSource = $template.Source }
        generatedAt = (Get-Date).ToUniversalTime().ToString('o')
        context     = [ordered]@{
            subscriptionId   = $SubscriptionId
            subscriptionName = $sub.name
            tenantId         = $sub.tenantId
            callerType       = $callerType
            caller           = $callerName
            location         = $Location
            resourceGroup    = $ResourceGroupName
            parameterFile    = $(if ($ParameterFile) { Split-Path -Leaf $ParameterFile } else { $null })
            selection        = $(if ($script:SelectionKnown) { 'parameter-file' } else { 'unknown (advisory)' })
        }
        components  = $components
        summary     = $counts
        results     = $script:Results
    }
    $target = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
    [IO.File]::WriteAllText($target, ($evidence | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
    Write-Host "Evidence written to $target" -ForegroundColor Cyan
}

if ($counts.FAIL) { exit 1 }
exit 0
