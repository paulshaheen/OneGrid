#Requires -Version 7.0
<#
.SYNOPSIS
  Parse-checks and lints the OneGrid deployment PowerShell scripts.

.DESCRIPTION
  1. Parses every script with the PowerShell 7 parser; any parse error fails the run.
  2. Runs PSScriptAnalyzer with the repository's PSScriptAnalyzerSettings.psd1. Error (and
     ParseError) findings fail the run; Warning findings are reported only.

  Inside GitHub Actions the findings are emitted as file/line annotations and a table is added
  to the job summary. Used by the `powershell` job in .github/workflows/validate-infra.yml.

.PARAMETER Path
  Scripts to check. Defaults to planetary-computer-pro-poc/deploy/azure/scripts/*.ps1,
  planetary-computer-pro-poc/deploy/azure/tools/*.ps1 and planetary-computer-pro-poc/infra/deploy.ps1.

.PARAMETER SettingsPath
  PSScriptAnalyzer settings file. Defaults to PSScriptAnalyzerSettings.psd1 at the repository root.

.PARAMETER SkipAnalyzer
  Run only the parse check (for machines without the PSScriptAnalyzer module).

.EXAMPLE
  pwsh ./planetary-computer-pro-poc/deploy/azure/tools/Invoke-InfraScriptAnalysis.ps1

.EXAMPLE
  Install-Module PSScriptAnalyzer -RequiredVersion 1.25.0 -Scope CurrentUser
  pwsh ./planetary-computer-pro-poc/deploy/azure/tools/Invoke-InfraScriptAnalysis.ps1 -Path ./planetary-computer-pro-poc/deploy/azure/scripts/Test-OneGridDeployment.ps1
#>
[CmdletBinding()]
param(
    [string[]] $Path,
    [string] $SettingsPath,
    [switch] $SkipAnalyzer
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..' '..' '..' '..')).Path
$inActions = $env:GITHUB_ACTIONS -eq 'true'
if (-not $SettingsPath) { $SettingsPath = Join-Path $repoRoot 'PSScriptAnalyzerSettings.psd1' }
if (-not $Path) {
    $Path = @(
        Get-ChildItem -Path (Join-Path $repoRoot 'planetary-computer-pro-poc/deploy/azure/scripts') -Filter '*.ps1' -File
        Get-ChildItem -Path (Join-Path $repoRoot 'planetary-computer-pro-poc/deploy/azure/tools') -Filter '*.ps1' -File
        Get-Item -Path (Join-Path $repoRoot 'planetary-computer-pro-poc/infra/deploy.ps1')
    ) | ForEach-Object { $_.FullName }
}

function Get-RelativePath {
    param([string] $FullPath)
    [IO.Path]::GetRelativePath($repoRoot, $FullPath).Replace('\', '/')
}

function Write-Annotation {
    param([string] $Kind, [string] $File, [int] $Line, [int] $Column, [string] $Title, [string] $Message)
    if (-not $inActions) { return }
    $text = $Message.Replace('%', '%25').Replace("`r", '%0D').Replace("`n", '%0A')
    Write-Output "::$($Kind) file=$($File),line=$($Line),col=$($Column),title=$($Title)::$($text)"
}

$findings = [System.Collections.Generic.List[object]]::new()
$failed = $false

foreach ($file in $Path) {
    $full = (Resolve-Path -LiteralPath $file).Path
    $relative = Get-RelativePath $full
    $tokens = $null
    $parseErrors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($full, [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count) {
        $failed = $true
        foreach ($e in $parseErrors) {
            $findings.Add([pscustomobject]@{ File = $relative; Line = $e.Extent.StartLineNumber; Severity = 'ParseError'; Rule = $e.ErrorId; Message = $e.Message })
            Write-Annotation -Kind error -File $relative -Line $e.Extent.StartLineNumber -Column $e.Extent.StartColumnNumber -Title 'PowerShell parse error' -Message $e.Message
        }
        Write-Host "PARSE FAIL  $relative ($($parseErrors.Count) error(s))" -ForegroundColor Red
    } else {
        Write-Host "parse ok    $relative" -ForegroundColor Green
    }
}

if (-not $SkipAnalyzer) {
    $module = Get-Module -ListAvailable -Name PSScriptAnalyzer | Sort-Object Version -Descending | Select-Object -First 1
    if (-not $module) {
        $message = 'PSScriptAnalyzer is not installed (Install-Module PSScriptAnalyzer -Scope CurrentUser); only the parse check ran.'
        if ($inActions) { Write-Output "::error title=PSScriptAnalyzer::$message"; $failed = $true } else { Write-Warning $message }
    } else {
        Import-Module $module.Path -Force
        Write-Host "PSScriptAnalyzer $($module.Version) with $(Get-RelativePath $SettingsPath)" -ForegroundColor Cyan
        foreach ($file in $Path) {
            $full = (Resolve-Path -LiteralPath $file).Path
            $relative = Get-RelativePath $full
            $results = @(Invoke-ScriptAnalyzer -Path $full -Settings $SettingsPath)
            foreach ($r in $results) {
                $severity = [string]$r.Severity
                $findings.Add([pscustomobject]@{ File = $relative; Line = $r.Line; Severity = $severity; Rule = $r.RuleName; Message = $r.Message })
                $kind = if ($severity -in 'Error', 'ParseError') { 'error' } else { 'warning' }
                if ($kind -eq 'error') { $failed = $true }
                Write-Annotation -Kind $kind -File $relative -Line ([int]$r.Line) -Column ([int]$r.Column) -Title $r.RuleName -Message $r.Message
            }
            $errors = @($results | Where-Object { [string]$_.Severity -in 'Error', 'ParseError' }).Count
            $color = if ($errors) { 'Red' } elseif ($results.Count) { 'Yellow' } else { 'Green' }
            Write-Host ('analyze     {0}: {1} error(s), {2} other finding(s)' -f $relative, $errors, ($results.Count - $errors)) -ForegroundColor $color
        }
    }
}

if ($findings.Count) {
    $findings | Sort-Object File, Line | Format-Table Severity, File, Line, Rule, Message -AutoSize -Wrap | Out-String -Width 220 | Write-Host
}
if ($inActions -and $env:GITHUB_STEP_SUMMARY) {
    $summary = [System.Text.StringBuilder]::new()
    [void]$summary.AppendLine('### PowerShell script analysis')
    [void]$summary.AppendLine('')
    [void]$summary.AppendLine("Scripts: $($Path.Count). Errors fail the job; warnings are informational.")
    [void]$summary.AppendLine('')
    if ($findings.Count) {
        [void]$summary.AppendLine('| Severity | File | Line | Rule | Message |')
        [void]$summary.AppendLine('| --- | --- | --- | --- | --- |')
        foreach ($f in ($findings | Sort-Object Severity, File, Line | Select-Object -First 200)) {
            [void]$summary.AppendLine("| $($f.Severity) | $($f.File) | $($f.Line) | $($f.Rule) | $(([string]$f.Message).Replace('|', '\|').Replace("`n", ' ')) |")
        }
    } else {
        [void]$summary.AppendLine('No findings.')
    }
    Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value $summary.ToString()
}

if ($failed) {
    Write-Host 'Script analysis failed (parse errors or Error-severity findings).' -ForegroundColor Red
    exit 1
}
Write-Host 'Script analysis passed.' -ForegroundColor Green
exit 0
