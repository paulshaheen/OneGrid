---
title: Deploy OneGrid from the command line
description: Validate, preview, and deploy the OneGrid template with the Azure CLI or Azure PowerShell and a shipped parameter file, read outputs and deployment-script logs, redeploy, and tear down.
ms.date: 11/24/2026
ms.topic: how-to
---

# Deploy OneGrid from the command line

Part of the [OneGrid landing zone design guide](../architecture/design-guide.md).

[Deploy OneGrid](README.md) | [Get started](getting-started.md) |
[Parameter reference](reference/parameters.md) | [Troubleshooting](troubleshooting.md)

Use the Azure CLI or Azure PowerShell for repeatable deployments and pipelines. Both deploy
the same template as the portal, with a parameter file instead of the form. The commands
validate the template, preview the changes with what-if, and then deploy.

The template's defaults differ from the portal form's: from the command line, the Fabric
plane, web app, and data seed are off unless you turn them on. Start from a shipped parameter
file so the component switches are explicit.

## Before you begin

- Complete the [prerequisites](getting-started.md#prerequisites) and run the
  [validation scripts](getting-started.md#validate-prerequisites).
- Install the Azure CLI 2.62 or later, or the Az PowerShell module. To deploy `main.bicep` or
  a `.bicepparam` file, also install the Bicep CLI: `az bicep install` for the Azure CLI, or
  the standalone Bicep CLI on your `PATH` for Azure PowerShell.
- Run the commands from the repository root.

## Choose a parameter file

The [parameter files](../../planetary-computer-pro-poc/deploy/azure/parameters/README.md) are
in `planetary-computer-pro-poc/deploy/azure/parameters`. Each has a JSON version for
`azuredeploy.json` and a `.bicepparam` version for `main.bicep`.

| File | Scenario | Replace before you deploy |
| --- | --- | --- |
| `baseline-required` | The portal's default components, on a new F2 Fabric capacity | Nothing; review `location` |
| `baseline-full` | Every component, including the Aurora GPU deployment and the forecast job | `fabricCapacityAdmin` |
| `brownfield-existing-capacity` | The baseline components on an existing capacity, with an existing sign-in registration and refresh service principal | The capacity ID, the client and object IDs, and the Key Vault reference for the secret |
| `weather-aurora` | The Aurora endpoint, GPU deployment, forecast job, and storage only | Nothing; review `location` |

Values in the form `<your-...>` are placeholders. A deployment fails until you replace them.

### Prepare your copy

Copy the file you need to a folder outside the repository, and edit the copy. Keep
environment-specific values, and especially secrets, out of source control.

```powershell
New-Item -ItemType Directory -Force -Path C:\deployment | Out-Null
Copy-Item .\planetary-computer-pro-poc\deploy\azure\parameters\baseline-required.parameters.json C:\deployment\onegrid.parameters.json
```

A `.bicepparam` file refers to the template with `using '../main.bicep'`. If you move a copy,
update that path so it still points at `planetary-computer-pro-poc/deploy/azure/main.bicep`.

The brownfield file passes `refreshServicePrincipalSecret` as an Azure Key Vault reference.
The vault must allow template deployment (`enabledForTemplateDeployment`), and the identity
that deploys needs the `Microsoft.KeyVault/vaults/deploy/action` permission on it. Never put a
secret value in a parameter file.

### Override a value

To change one or two values without editing the file, add them after the file. With the
Azure CLI, a later `--parameters` value wins:

```bash
az deployment group create --resource-group onegrid-rg --name onegrid --template-file planetary-computer-pro-poc/deploy/azure/azuredeploy.json --parameters @planetary-computer-pro-poc/deploy/azure/parameters/baseline-full.parameters.json --parameters fabricCapacityAdmin=user@contoso.com
```

## Deploy with the Azure CLI

### Sign in

```bash
az login
az account set --subscription <subscription-id>
```

Use `az login --use-device-code` when no browser is available.

### Validate, preview, and deploy

This PowerShell sequence creates the resource group, validates the template, previews the
changes, and deploys a prepared parameter file:

```powershell
$resourceGroup = 'onegrid-rg'
$location = 'westeurope'
$parametersFile = 'C:\deployment\onegrid.parameters.json'
$templateFile = '.\planetary-computer-pro-poc\deploy\azure\azuredeploy.json'

az group create --name $resourceGroup --location $location
az deployment group validate --resource-group $resourceGroup --template-file $templateFile --parameters "@$parametersFile"
az deployment group what-if --resource-group $resourceGroup --template-file $templateFile --parameters "@$parametersFile"
az deployment group create --resource-group $resourceGroup --name onegrid --template-file $templateFile --parameters "@$parametersFile"
```

In PowerShell, quote `"@$parametersFile"`, because `@` starts a splat. In bash, the same
commands take `--parameters @/path/to/onegrid.parameters.json`.

1. **Create the resource group** in the same region as `location` in the parameter file.
   Deploy into a new, empty resource group.
2. **Validate.** `az deployment group validate` checks the template and parameters, and some
   quota, such as App Service plan quota (`InternalSubscriptionIsOverQuotaForSku`). Fix any
   error before you continue; see the [ARM deployment table](troubleshooting.md#arm-deployment).
3. **Preview.** `az deployment group what-if` lists what the deployment would create or
   change. Review it, and approve the resource and cost changes.
4. **Deploy.** `az deployment group create` runs the deployment as `onegrid`. A full
   deployment commonly takes 30 to 90 minutes. Add `--no-wait` to return immediately and
   monitor the deployment instead.

Approve the resource and cost changes before you run the deployment, and make sure
`$location` matches the parameter file. Data seeding, Fabric readiness, and the optional
model and image work can extend the duration.

### Deploy the published template

To deploy exactly what the portal button deploys, use the template from the repository's
`main` branch instead of your checkout:

```bash
az deployment group validate -g <rg> --template-uri https://raw.githubusercontent.com/paulshaheen/OneGrid/main/planetary-computer-pro-poc/deploy/azure/azuredeploy.json --parameters @<path-to>/onegrid.parameters.json -o none
az deployment group create -g <rg> -n onegrid --template-uri https://raw.githubusercontent.com/paulshaheen/OneGrid/main/planetary-computer-pro-poc/deploy/azure/azuredeploy.json --parameters @<path-to>/onegrid.parameters.json --no-wait
```

### Deploy from Bicep

With a `.bicepparam` file, the Azure CLI reads the template from its `using` statement, so you
omit `--template-file`:

```bash
az deployment group what-if --resource-group onegrid-rg --parameters planetary-computer-pro-poc/deploy/azure/parameters/baseline-required.bicepparam
az deployment group create --resource-group onegrid-rg --name onegrid --parameters planetary-computer-pro-poc/deploy/azure/parameters/baseline-required.bicepparam
```

`main.bicep` uses the Microsoft Graph Bicep extension, which
[`bicepconfig.json`](../../planetary-computer-pro-poc/deploy/azure/bicepconfig.json) enables as
an experimental feature. The Bicep CLI restores it from `mcr.microsoft.com` on first use.
`azuredeploy.json` is the compiled form and needs no Bicep tooling.

You can also pass `main.bicep` with inline values. From the `planetary-computer-pro-poc`
folder:

```bash
az group create -n onegrid-rg -l eastus

az deployment group create -g onegrid-rg -f deploy/azure/main.bicep \
  -p deployFabricPlane=true deployOneGridApp=true createFabricCapacity=true \
     fabricCapacityAdmin=<your-upn>
```

### Monitor the deployment

```powershell
az deployment group show --resource-group $resourceGroup --name onegrid --query properties.provisioningState -o tsv
az deployment operation group list -g $resourceGroup -n onegrid --query "[?properties.provisioningState!='Succeeded'].{resource:properties.targetResource.resourceName, state:properties.provisioningState}" -o table
```

The first command returns `Running`, `Succeeded`, or `Failed`. The second lists the resources
that are still running or that failed. For a failed operation, read its
`properties.statusMessage`.

### Read the deployment-script logs

The provisioner runs in deployment scripts. Read their logs to follow its phases:

```powershell
az deployment-scripts show-log --resource-group $resourceGroup --name pcpro-onegrid-provision-app
az deployment-scripts show-log --resource-group $resourceGroup --name pcpro-onegrid-provision-fabric
```

These commands need the long `--name` option; `-n` isn't accepted. The app plane runs first,
then the Fabric plane. When the forecast job builds its image, the build script is
`pcpro-aurora-image-build`. A log is available only after its container starts, and the
script resources are kept for one day after they finish.

Each phase writes lines that start with a `[hh:mm:ss]` timestamp. The end of each log lists
any phase issues; a script fails with `deploy.ps1 finished with issues` when there are any.
Restrict access to the logs and redact them before you share them.

### Read the outputs

```powershell
az deployment group show --resource-group $resourceGroup --name onegrid --query properties.outputs -o json
```

To read only the main values:

```bash
az deployment group show -g <rg> -n onegrid --query "properties.outputs.{app:oneGridAppUrl.value, geoCatalog:geoCatalogUri.value, fabric:fabricPlaneEnabled.value, phases:oneGridPhases.value}" -o json
```

| Output | Meaning |
| --- | --- |
| `oneGridAppUrl` | The web app's URL, or `not-deployed` |
| `geoCatalogUri`, `geoCatalogResourceId` | The GeoCatalog's URI and resource ID |
| `fabricPlaneEnabled`, `oneGridPhases` | Whether the Fabric plane ran, and the provisioner phases the scripts ran |
| `appPlaneProvisionResult`, `fabricPlaneProvisionResult` | Each script's result: `phases`, `deployExit`, and the IDs it produced, such as `workspaceId` and `appUrl` |
| `fabricPlaneCommand` | Whether the OneLake shortcut was included |
| `auroraModelDeployed`, `auroraEndpoint`, `auroraScheduleDeployed`, `auroraJobName` | Whether the GPU model and the forecast job deployed, and their names |
| `auroraImageBuildCommand` | The `az acr build` command to rebuild the pipeline image yourself |

The [parameter reference](reference/parameters.md) lists every input. The template declares
the full output list at the end of
[`main.bicep`](../../planetary-computer-pro-poc/deploy/azure/main.bicep).

## Deploy with Azure PowerShell

### Sign in

```powershell
Connect-AzAccount
Set-AzContext -Subscription <subscription-id>
```

### Validate, preview, and deploy

```powershell
$resourceGroup = 'onegrid-rg'
$location = 'westeurope'
$parametersFile = 'C:\deployment\onegrid.parameters.json'
$templateFile = '.\planetary-computer-pro-poc\deploy\azure\azuredeploy.json'

New-AzResourceGroup -Name $resourceGroup -Location $location
Test-AzResourceGroupDeployment -ResourceGroupName $resourceGroup -TemplateFile $templateFile -TemplateParameterFile $parametersFile
New-AzResourceGroupDeployment -Name onegrid -ResourceGroupName $resourceGroup -TemplateFile $templateFile -TemplateParameterFile $parametersFile -WhatIf
New-AzResourceGroupDeployment -Name onegrid -ResourceGroupName $resourceGroup -TemplateFile $templateFile -TemplateParameterFile $parametersFile
```

`Test-AzResourceGroupDeployment` validates and returns nothing when the template is valid.
`-WhatIf` prints the preview without deploying. Add `-AsJob` to the last command to run the
deployment in the background.

To deploy from Bicep, pass `main.bicep` and a `.bicepparam` file. Azure PowerShell needs the
Bicep CLI on your `PATH`:

```powershell
New-AzResourceGroupDeployment -Name onegrid -ResourceGroupName $resourceGroup -TemplateFile .\planetary-computer-pro-poc\deploy\azure\main.bicep -TemplateParameterFile .\planetary-computer-pro-poc\deploy\azure\parameters\baseline-required.bicepparam
```

### Monitor, read logs, and read outputs

```powershell
Get-AzResourceGroupDeployment -ResourceGroupName $resourceGroup -Name onegrid | Select-Object ProvisioningState, Timestamp
Get-AzResourceGroupDeploymentOperation -ResourceGroupName $resourceGroup -DeploymentName onegrid | Where-Object ProvisioningState -ne 'Succeeded'
Get-AzDeploymentScriptLog -ResourceGroupName $resourceGroup -Name pcpro-onegrid-provision-app
Get-AzDeploymentScriptLog -ResourceGroupName $resourceGroup -Name pcpro-onegrid-provision-fabric
(Get-AzResourceGroupDeployment -ResourceGroupName $resourceGroup -Name onegrid).Outputs
```

## Validate the deployment

Run the deployment validation script, the automated version of the
[acceptance checks](../deployment-and-data-guide.md#acceptance-checks):

```powershell
./planetary-computer-pro-poc/deploy/azure/scripts/Test-OneGridDeployment.ps1 -ResourceGroupName $resourceGroup -DeploymentName onegrid -OutputPath ./onegrid-evidence.json
```

The script,
[`Test-OneGridDeployment.ps1`](../../planetary-computer-pro-poc/deploy/azure/scripts/Test-OneGridDeployment.ps1),
is read-only. It records components you didn't deploy as `N/A`, records checks that need a
signed-in person as `MANUAL`, and exits with code 1 when any check fails. Without
`-OutputPath`, it writes `onegrid-acceptance-<timestamp>.json` to the current folder. Add
`-SkipFabric` when you have no access to the Fabric workspace, or `-SkipWeather` to skip the
weather checks.

The Fabric, Power BI, and Kusto checks need access to the workspace, and reading app settings
needs **Website Contributor** or **Contributor** on the resource group.

Then finish the [post-deployment steps](deploy-portal.md#complete-the-post-deployment-steps),
which apply to every option: sign-in redirect URI, catalog access, Fabric workspace access,
the shortcut, and the Aurora model.

## Redeploy

Redeploying the same template into the same resource group is safe. Run the same `create`
command with the same deployment name after you fix a prerequisite, such as capacity rights
or a Fabric tenant setting, or to change a selection. Preview it with what-if first.

- **The deployment scripts run again.** Their `forceUpdateTag` is `deploymentToken`, which
  changes on every deployment.
- **App settings are reset, then reapplied.** Azure Resource Manager replaces the web app's
  settings with the template's values, and the scripts reapply the rest. A setting you change
  by hand lasts only until the next deployment. To change modules, change `oneGridModules`.
- **The Aurora Key Vault gets a new name.** Its name includes `deploymentToken`, so each
  deployment with Aurora declares a new vault for the existing workspace. Check the what-if
  output, and remove vaults you no longer need. Don't set `deploymentToken` yourself.
- **Nothing is deleted.** Deployments run in incremental mode, so turning a component off
  leaves its resources in place.

To change the app modules between deployments, you can set the app setting directly. The
next deployment replaces it with `oneGridModules`:

```bash
az webapp config appsettings set -g <rg> -n <app-name> --settings ONEGRID_MODULES=exec,weather,infra
az webapp restart -g <rg> -n <app-name>
```

The web app's name starts with `pcpro-onegrid-app-`. Use `none` for core pages only.

## Tear down

Deleting the resource group removes everything the template created in it, including a
Fabric capacity that the template created. Deleting it can't be undone.

```bash
./planetary-computer-pro-poc/deploy/azure/teardown.sh <resource-group-name>
```

The script asks you to type the resource group name to confirm. The equivalent commands are:

```bash
az group delete -n <rg> --yes
```

```powershell
Remove-AzResourceGroup -Name $resourceGroup -Force
```

Some objects live outside the resource group. Remove the ones you own when you no longer need
them:

| Object | Where it lives | How to remove it |
| --- | --- | --- |
| The OneGrid Fabric workspace and its items | Your Fabric tenant | Delete the workspace in the Fabric portal |
| The Fabric SQL connection `<workspace name> - sql` | Your Fabric tenant, outside the workspace | Delete it under **Manage connections and gateways** before you redeploy with the same workspace name |
| An existing Fabric capacity you supplied | Its own resource group | Left in place |
| Sign-in and refresh registrations the provisioner created | Microsoft Entra ID | Delete them in the Microsoft Entra admin center |
| The Aurora Key Vaults | Soft-deleted for 90 days | `az keyvault list-deleted`, then `az keyvault purge --name <vault>` to free the name |
| The Microsoft Foundry account | Soft-deleted, holding its name for 48 hours | `az cognitiveservices account list-deleted`, then `az cognitiveservices account purge --location <region> --resource-group <rg> --name <account>` |

Purging is permanent. Confirm retention requirements before you purge, and see
[decommissioning](../operations-runbook.md#backup-restore-and-decommissioning) for the full
procedure.

## Next steps

- [Troubleshooting](troubleshooting.md)
- [Known issues](known-issues.md)
- [Load and connect data](../deployment-and-data-guide.md#load-and-connect-data)
