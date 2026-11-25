---
title: Estimate the cost of a OneGrid deployment
description: Identify the cost drivers of each OneGrid component from the template defaults, what makes each one grow, and how to scale down or pause it, then price your selection with the Azure pricing calculator.
ms.date: 11/24/2026
ms.topic: conceptual
---

# Estimate the cost of a OneGrid deployment

Part of the [OneGrid landing zone design guide](../architecture/design-guide.md).

[Deploy OneGrid](README.md) | [Get started](getting-started.md) |
[Parameter reference](reference/parameters.md)

This page lists what you pay for in a OneGrid deployment, based on the SKUs and settings in
the template's defaults. It doesn't quote prices: they vary by region, agreement, and currency,
and some services are in preview. Use the
[Azure pricing calculator](https://azure.microsoft.com/pricing/calculator/) to price your
selection, and confirm actual spend with Microsoft Cost Management.

## How OneGrid is billed

Costs fall into three kinds. Plan for each one separately:

- **Always-on capacity.** The Fabric capacity, the App Service plan, and the Aurora GPU
  deployment bill for every hour they exist, whether or not anyone uses the solution. They're
  usually the largest part of the bill.
- **Usage.** Microsoft Foundry model tokens, forecast-job runs, storage transactions, log
  ingestion, and registry builds bill by consumption.
- **Stored data.** Storage accounts, the registry, Log Analytics retention, and GeoCatalog
  content bill for what they hold.

The template creates every resource in one resource group, so the resource group is the
simplest scope for cost analysis and budgets. The template sets no cost tags; add the tags
your organization uses through your own infrastructure as code.

## Cost drivers by component

| Component | Resource and template default | Billed by | What makes it grow | How to reduce or pause it |
| --- | --- | --- | --- | --- |
| Fabric capacity | `Microsoft.Fabric/capacities`, `F2` (`fabricCapacitySku`), only with `createFabricCapacity` | The hour, for the capacity's SKU, until you pause or delete it | A larger SKU. Refreshes, notebooks, pipelines, KQL, DAX, and data agent queries consume the capacity's units, so contention, not extra charges, is the first symptom | Pause the capacity when idle; resume it before users need it. Choose the smallest SKU that meets demand |
| App Service plan | Linux plan, `B1` (`chatAgentAppServiceSku`), with Always On | The hour, per instance, while the plan exists | A larger tier or more instances | Scale the plan down, or delete it. Stopping the web app doesn't stop the plan's charges |
| Microsoft Foundry model | `gpt-5-mini` as `GlobalStandard`, 10,000 tokens per minute (`openAiCapacity`) | Tokens processed | Chat users, longer conversations, and agent tool calls | Lower `openAiCapacity` to cap throughput, limit the Copilot module, or choose a different model |
| Aurora GPU deployment | One `Standard_NC24ads_A100_v4` instance (`auroraInstanceType`) on the `aurora-<suffix>` endpoint | The hour, for every hour the deployment exists, regardless of traffic | More instances or a larger size | Delete the `aurora` deployment when you don't need forecasts, and redeploy it before the next run. The endpoint without a deployment has no GPU cost |
| Forecast job | Container Apps job, 2 vCPU and 4 GiB per run, four runs a day (`auroraJobCron`), up to one hour each | vCPU and memory seconds while a run executes | A more frequent schedule or longer runs | Run less often by changing `auroraJobCron`, or deploy without the job and start runs on demand |
| Pipeline registry | `Basic` Container Registry, plus the ACR Tasks build that `pcpro-aurora-image-build` runs | The day for the registry, and build time | Image size and rebuilds | Supply your own image with `auroraJobImage` to skip the registry and build |
| Storage | Standard LRS StorageV2 accounts: sample storage, the Azure Machine Learning workspace storage, and deployment-script storage when exempt | Capacity stored and transactions | Seeded data, uploaded imagery, forecast outputs, and the application package | Clear `deployOneGridData` when you don't need the demo dataset. Apply lifecycle rules to old outputs |
| GeoCatalog | Planetary Computer Pro GeoCatalog, `Basic` tier (`geoCatalogTier`) | See Planetary Computer Pro pricing; the service is in preview | Ingested assets and request volume | Deploy without it when you don't need imagery (`deployGeoCatalog`) |
| Log Analytics | `PerGB2018` workspace with 30-day retention, for the forecast job's environment | Data ingested and retained | Job log volume | Keep retention at the default unless you need more |
| Application Insights | One component for the Azure Machine Learning workspace | Data ingested | Endpoint telemetry | Leave sampling and retention at levels you need |
| Key Vault | `standard` vault for the Azure Machine Learning workspace | Operations | Secret operations | Remove vaults that earlier deployments left behind; see [known issues](known-issues.md#the-aurora-key-vault-name-changes-on-every-deployment) |
| Deployment scripts | Azure Container Instances and storage, during each deployment | Container time while a script runs, up to 2 or 3 hours | Long Fabric provisioning and data seeding | Nothing to manage: containers are removed after a successful run |

Two more points affect cost:

- **A second model account.** When you deploy the web app without the AI agent component, the
  provisioner creates its own Microsoft Foundry account, `pcpro-foundry`, with a `gpt-4o`
  deployment of 100,000 tokens per minute. Select the AI agent component so the app reuses
  one account.
- **Existing capacity.** With `fabricCapacityId`, OneGrid shares an existing capacity. It adds
  no capacity charge, but its workload competes with the capacity's other workspaces.

## Cost drivers by scenario

| Scenario | Always-on capacity | Usage | Parameter file |
| --- | --- | --- | --- |
| Baseline | New `F2` Fabric capacity, `B1` App Service plan | Model tokens, storage, data seed | `baseline-required` |
| Baseline, full | New `F2` Fabric capacity, `B1` App Service plan, one A100 GPU instance | Model tokens, four forecast runs a day, registry, storage, logs | `baseline-full` |
| Brownfield | `B1` App Service plan; the existing capacity is already paid for | Model tokens, storage, data seed | `brownfield-existing-capacity` |
| Weather inference | One A100 GPU instance | Four forecast runs a day, registry, storage, logs | `weather-aurora` |

In the full and weather scenarios, the GPU instance is typically the largest single charge,
because it bills continuously. Price it first.

## Pause and scale down

| Resource | Action | Effect while paused or reduced |
| --- | --- | --- |
| Fabric capacity | Pause on the capacity's page in the Azure portal, or `az resource invoke-action --action suspend --ids <capacity-resource-id>`. Resume with `--action resume` | The workspace's items are unavailable: DAX, KQL, refreshes, and the data agent fail until you resume |
| Aurora GPU deployment | Delete the `aurora` deployment from the endpoint in Azure Machine Learning studio | Forecast runs fail until you deploy the model again |
| Forecast job | Change `auroraJobCron` and redeploy | Forecasts update less often |
| App Service plan | Scale to a smaller tier | Less CPU and memory. Basic tiers don't autoscale |
| Microsoft Foundry model | Lower `openAiCapacity` and redeploy | Requests beyond the limit are throttled |

To stop all charges, [tear down](deploy-cli.md#tear-down) the environment. Deleting the
resource group removes a capacity that the template created, but not an existing capacity you
supplied.

## Estimate your deployment

1. List the components you'll deploy and their SKUs from your parameter file. The
   [parameter reference](reference/parameters.md) shows every default.
2. In the [Azure pricing calculator](https://azure.microsoft.com/pricing/calculator/), add
   Microsoft Fabric, App Service, the Microsoft Foundry model you deploy, Azure Machine
   Learning, Azure Container Apps, Container Registry, Storage Accounts, Azure Monitor, and
   Key Vault, in your region.
3. Enter the hours each always-on resource runs. Use the full month unless you plan to pause it.
4. Estimate usage: tokens per month from expected chat users, forecast runs per day from
   `auroraJobCron`, and stored data from the seed, imagery, and outputs.
5. Check Planetary Computer Pro pricing for GeoCatalog separately.
6. After deployment, create a budget on the resource group, and compare actual cost with the
   estimate in Cost Management.

## Related resources

- [Azure pricing calculator](https://azure.microsoft.com/pricing/calculator/)
- [Microsoft Fabric pricing](https://azure.microsoft.com/pricing/details/microsoft-fabric/)
- [Pause and resume your Fabric capacity](https://learn.microsoft.com/fabric/enterprise/pause-resume)
- [Plan and manage costs for Azure Machine Learning](https://learn.microsoft.com/azure/machine-learning/concept-plan-manage-cost)
- [Microsoft Cost Management](https://learn.microsoft.com/azure/cost-management-billing/)
