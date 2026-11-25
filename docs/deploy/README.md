---
title: Deploy OneGrid
description: Choose a deployment option and scenario for OneGrid, then follow the reading path from prerequisites through deployment, validation, troubleshooting, and cost planning.
ms.date: 11/24/2026
ms.topic: conceptual
---

# Deploy OneGrid

Part of the [OneGrid landing zone design guide](../architecture/design-guide.md).

[Solution overview](../../README.md) | [Parameter reference](reference/parameters.md) |
[Parameter files](../../planetary-computer-pro-poc/deploy/azure/parameters/README.md)

This section explains how to deploy one OneGrid stamp: the Azure resources in a resource
group and the OneGrid workspace in Microsoft Fabric. Every option deploys the same Bicep
template, [`main.bicep`](../../planetary-computer-pro-poc/deploy/azure/main.bicep), compiled
to [`azuredeploy.json`](../../planetary-computer-pro-poc/deploy/azure/azuredeploy.json),
except the deploy wizard, which runs the provisioner directly.

A deployment has two stages. Azure Resource Manager creates the Azure resources, managed
identities, and role assignments. Then two deployment scripts run the
[provisioner](../../planetary-computer-pro-poc/infra/deploy.ps1): the app-plane script wires
the web app, and the Fabric-plane script builds the Fabric workspace and its items.

## Reading path

Read the pages in this order for a first deployment:

1. **[Get started](getting-started.md).** Work through the prerequisite checklists, run the
   prerequisite validation script, and decide on components, greenfield or brownfield, and
   the network model.
2. **Deploy.** Use the [Azure portal](deploy-portal.md), or the
   [Azure CLI or Azure PowerShell](deploy-cli.md) with a shipped
   [parameter file](../../planetary-computer-pro-poc/deploy/azure/parameters/README.md).
3. **Validate.** Run `Test-OneGridDeployment.ps1`, the automated version of the
   [acceptance checks](../deployment-and-data-guide.md#acceptance-checks), and record the
   results.
4. **Load data.** Connect asset registers, imagery, telemetry, and weather with
   [Deploy and configure OneGrid](../deployment-and-data-guide.md#load-and-connect-data).
5. **Operate.** Hand the environment to [Day 2 operations](../operations.md).

Keep these pages at hand while you plan and deploy:

| Page | Use it to |
| --- | --- |
| [Troubleshooting](troubleshooting.md) | Match a symptom to its cause and fix, by deployment phase |
| [Known issues](known-issues.md) | Check current limitations, their workarounds, and their status |
| [Cost estimate](cost-estimate.md) | Identify the cost drivers of each component and how to scale or pause them |
| [Parameter reference](reference/parameters.md) | Look up every template parameter, its default, and the portal step that sets it |

## Deployment options

| Option | What runs | What it can deploy | Input | Guide |
| --- | --- | --- | --- | --- |
| Azure portal | The **Deploy to Azure** button opens `azuredeploy.json` with its portal form, [`createUiDefinition.json`](../../planetary-computer-pro-poc/deploy/azure/createUiDefinition.json) | Every template component | Portal form | [Deploy from the Azure portal](deploy-portal.md) |
| Azure CLI | `az deployment group validate`, `what-if`, and `create` | Every template component | A JSON or `.bicepparam` parameter file | [Deploy with the Azure CLI](deploy-cli.md#deploy-with-the-azure-cli) |
| Azure PowerShell | `Test-AzResourceGroupDeployment` and `New-AzResourceGroupDeployment`, with `-WhatIf` for a preview | Every template component | A JSON or `.bicepparam` parameter file | [Deploy with Azure PowerShell](deploy-cli.md#deploy-with-azure-powershell) |
| GitHub Copilot runbook | An agent asks the portal form's questions, shows the plan, and runs the Azure CLI after you confirm | Every template component | A conversation; the agent writes a temporary parameter file | [Deploy OneGrid with GitHub Copilot](../../DEPLOY-WITH-COPILOT.md) |
| Deploy wizard | A localhost web UI runs `deploy.ps1` directly, without the ARM template | The Fabric workspace and items, Microsoft Foundry, and the web app, on an existing Fabric capacity. Not GeoCatalog, Aurora, or the forecast job | Wizard steps | [Deploy wizard](../../planetary-computer-pro-poc/infra/deploy-ui/README.md) |

Use the portal for a first evaluation. Use the Azure CLI or Azure PowerShell with a parameter
file under source control for repeatable environments and pipelines.

## Deployment scenarios

The shipped parameter files cover four scenarios. Each one is a component selection of the
same template.

| Scenario | What it deploys | Use it when | Parameter file |
| --- | --- | --- | --- |
| Baseline | The portal form's default selection: GeoCatalog, sample storage, the Microsoft Foundry model, the Fabric plane on a new F2 capacity, the web app, and the historical data seed | You want the same result as the portal with its defaults, from the command line | `baseline-required` |
| Baseline, full | Everything in the baseline, plus the Aurora GPU deployment, the forecast job, and the Microsoft Graph permission that creates the sign-in and refresh identities | You want the complete solution, including weather intelligence, in one deployment | `baseline-full` |
| Brownfield | The baseline components on an existing Fabric capacity, with an existing sign-in app registration and refresh service principal | Your organization already provides the capacity and the Microsoft Entra registrations | `brownfield-existing-capacity` |
| Weather inference | The Aurora endpoint and GPU deployment, the forecast job, and the storage it publishes to | You want to prove GPU quota, model terms, and the forecast pipeline before you add the rest | `weather-aurora` |

Each file has a JSON version (`.parameters.json`) and a Bicep version (`.bicepparam`). See
[Parameter files](../../planetary-computer-pro-poc/deploy/azure/parameters/README.md) for the
values to replace.

These scenarios are about what one stamp contains. The architecture scenarios in the
[design guide](../architecture/design-guide.md#deployment-scenarios), such as the
[enterprise landing zone](../architecture/enterprise-landing-zone.md) and
[multiregion recovery](../architecture/multiregion.md), add platform networking, controls,
and recovery around a stamp through your own infrastructure as code.

## Next steps

- [Get started with a OneGrid deployment](getting-started.md)
- [Deploy from the Azure portal](deploy-portal.md)
- [Deploy from the command line](deploy-cli.md)
