# PSScriptAnalyzer settings for the OneGrid deployment scripts.
# Used by the `powershell` job in .github/workflows/validate-infra.yml through
# planetary-computer-pro-poc/deploy/azure/tools/Invoke-InfraScriptAnalysis.ps1.
#
# CI reports Error and Warning findings as annotations and fails only on Error (and on parse
# errors). Each excluded rule below is noise for these scripts specifically; everything else
# in the default rule set stays on.
@{
    Severity     = @('Error', 'Warning')

    ExcludeRules = @(
        # The scripts are console tools and in-template deploymentScripts. Write-Host is how
        # their progress reaches the deployment-script log and the operator's console; nothing
        # downstream consumes the information stream.
        'PSAvoidUsingWriteHost',

        # deploymentScripts read the $DeploymentScriptOutputs variable after the script ends,
        # so assigning it without reading it is correct; the rule cannot see that contract.
        'PSUseDeclaredVarsMoreThanAssignments',

        # The scripts target PowerShell 7 (pwsh), which reads BOM-less UTF-8 correctly, and
        # main.bicep embeds onegrid-solution-provision.ps1 with loadTextContent(), where a BOM
        # would end up inside the template string.
        'PSUseBOMForUnicodeEncodedFile',

        # Script-local helpers (Log, FGet, FPost, Phase-ChatAgent, ...) are not exported
        # cmdlets, so cmdlet naming guidance (approved verbs, singular nouns) adds noise
        # without improving discoverability.
        'PSUseApprovedVerbs',
        'PSUseSingularNouns',

        # Helpers named New-*/Set-*/Remove-* inside unattended deployment scripts are not
        # user-facing commands; -WhatIf/-Confirm support would never be used.
        'PSUseShouldProcessForStateChangingFunctions'
    )

    Rules        = @{
        # Flag syntax that PowerShell 7 cannot parse. The deploymentScripts image and the
        # local tooling both run pwsh 7.x.
        PSUseCompatibleSyntax = @{
            Enable         = $true
            TargetVersions = @('7.0')
        }
    }
}
