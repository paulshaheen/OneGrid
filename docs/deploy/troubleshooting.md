---
title: Troubleshoot a OneGrid deployment
description: Match OneGrid deployment and runtime symptoms to their causes and fixes, grouped by phase from preflight through the ARM deployment, the deployment scripts, the app, data refresh, and the forecast job.
ms.date: 11/24/2026
ms.topic: troubleshooting
---

# Troubleshoot a OneGrid deployment

Part of the [OneGrid landing zone design guide](../architecture/design-guide.md).

[Deploy OneGrid](README.md) | [Known issues](known-issues.md) |
[Operational runbook](../operations-runbook.md)

This guide lists the problems that the repository's code and documentation describe, grouped
by the phase where they appear. Each row names its source, so you can read the code path or
the original guidance. For current limitations that have no fix yet, see
[Known issues](known-issues.md). For incidents in a running environment, use the
[operational runbook](../operations-runbook.md#common-incident-procedures).

## Collect evidence first

Before you change anything, collect the state of the deployment. These commands only read:

```powershell
az deployment group show -g <rg> -n onegrid --query properties.provisioningState -o tsv
az deployment operation group list -g <rg> -n onegrid --query "[?properties.provisioningState!='Succeeded'].{resource:properties.targetResource.resourceName, state:properties.provisioningState}" -o table
az deployment-scripts show-log -g <rg> --name pcpro-onegrid-provision-app
az deployment-scripts show-log -g <rg> --name pcpro-onegrid-provision-fabric
az deployment group show -g <rg> -n onegrid --query properties.outputs -o json
```

- Find the failed operation's `properties.statusMessage`. It names the resource and the error.
- In a script log, the provisioner writes one `PHASE <name>` line when each phase starts, and a
  summary at the end. `DEPLOY FINISHED WITH <n> ISSUE(S)` lists each failed phase.
- Capture the logs promptly. The deployment script resources are kept for one day after they
  finish.
- If a step fails, stop and fix the cause before you retry. Redeploying the same template into
  the same resource group is safe, and the deployment scripts run again each time.

## Preflight

| Symptom | Cause | Fix | Source |
| --- | --- | --- | --- |
| `Test-OneGridPrerequisites.ps1` reports `FAIL` and exits with code 1 | A prerequisite for a selected component isn't met | Run the command or portal step that the failed check prints, then run the script again | [`Test-OneGridPrerequisites.ps1`][prereq] |
| `location ... is not part of the allowed value(s)` | The region isn't one of the GeoCatalog preview regions that the template allows | Use `eastus`, `northcentralus`, `westeurope`, `canadacentral`, or `uksouth` | [Copilot runbook][copilot]; [`main.bicep`][bicep] (`location`) |
| `MissingSubscriptionRegistration`, or `Microsoft.Orbital` not registered | A resource provider isn't registered | [Register the providers](getting-started.md#resource-providers) for your components, wait until they're `Registered`, and retry | [Copilot runbook][copilot] |
| The quota script reports that Fabric `CapacityQuota` usage wasn't returned | `Microsoft.Fabric` was only just registered | Wait a few minutes and run the script again | [`preflight-quota.ps1`][preflight] |
| The quota script reports `FAIL Fabric` | The region doesn't have enough Fabric capacity units for the SKU | Request more on the Azure portal **Quotas** page; it can't be requested through Azure Resource Manager. Or check another allowed region, choose a smaller SKU, or use an existing capacity | [`preflight-quota.ps1`][preflight]; [Copilot runbook][copilot-prereq] |
| The quota script reports `FAIL GPU` | Fewer A100 cores are available than the deployment needs, including the 20 percent that managed online endpoints reserve | Request quota on the **Quotas** page or with `-RequestGpuQuota`, or deploy without the Aurora model | [`preflight-quota.ps1`][preflight] |
| The quota script reports that the GPU family wasn't found in the region | The region might not offer the A100 family, or the family name differs | Check another allowed region, or pass the right family with `-GpuVmFamily` | [`preflight-quota.ps1`][preflight] |

## ARM deployment

| Symptom | Cause | Fix | Source |
| --- | --- | --- | --- |
| Validation fails with `InternalSubscriptionIsOverQuotaForSku` on `Microsoft.Web/serverFarms` | The region has no App Service quota for the plan size, often for every size | Validate in the other allowed regions and pick one that passes, or request App Service quota on the **Quotas** page | [Copilot runbook][copilot] |
| Creating the Fabric capacity fails on quota | The region has no Fabric capacity-unit quota for the SKU | Request quota on the **Quotas** page, or use an existing capacity | [Copilot runbook][copilot] |
| Creating the Fabric capacity fails with a regional quota of 0 | `Microsoft.Fabric` was never registered in the subscription, so it has no default quota | Register `Microsoft.Fabric`, or run the quota script, which registers it, and redeploy | [`onegrid-solution-provision.ps1`][wrapper]; [`preflight-quota.ps1`][preflight] |
| `AuthorizationFailed` on role assignments | The deploying identity isn't **Owner** | Deploy with an **Owner** account, or have an Owner run the deployment | [Copilot runbook][copilot] |
| `provisionerGraphRole` fails with `Authorization_RequestDenied` | The deployer can't grant Microsoft Graph application permissions | Set `grantProvisionerGraphPermission` to `false`, and supply your own sign-in registration and refresh service principal | [Copilot runbook][copilot] |
| A deployment script fails with `KeyBasedAuthenticationNotPermitted` | A storage policy turned off shared-key access on the script's storage account | Redeploy with `exemptStorageFromPolicy` set to `true`, if your organization approves the exemption | [Copilot runbook][copilot]; [`main.bicep`][bicep] (`scriptStorage`) |
| The Key Vault fails with `ConflictError: A vault with the same name already exists in deleted state` | The name collides with a soft-deleted vault from an earlier deployment. The template avoids this by including `deploymentToken` in the name | Don't set `deploymentToken`; let it default to `utcNow()`. Or purge the deleted vault | [`main.bicep`][bicep] (`deploymentToken`) |
| The `aurora` model deployment fails with a capacity error | The subscription has no dedicated `Standard_NC24ads_A100_v4` quota. The studio's shared-quota temporary endpoint isn't available to templates | Redeploy with `createAuroraModelDeployment` cleared and no `auroraModelAssetId`, then deploy the model from the studio | [Portal form][ui] (Aurora section) |
| A selected component shows `not-deployed` in the outputs | Its dependency was off: the web app needs the Fabric plane, the Fabric plane needs sample storage, and the forecast job needs the Aurora model and sample storage. The template skips the component silently | Turn on the dependency and redeploy | [Copilot runbook][copilot-choices]; [`main.bicep`][bicep] (`deployFabricPlaneEffective`, `deployOneGridAppEffective`, `deployAuroraJob`) |

## App-plane script

These problems appear in the log of `pcpro-onegrid-provision-app`, which runs the provisioner's
`foundry` and `chatagent` phases.

| Symptom | Cause | Fix | Source |
| --- | --- | --- | --- |
| `az CLI is required but could not be installed in the deployment container` | The container couldn't reach the Azure CLI installer | Allow outbound internet access from the deployment-script containers, and redeploy | [`onegrid-solution-provision.ps1`][wrapper] |
| `clone did not produce deploy.ps1`, or the source zip download fails | `oneGridRepoUrl` or `oneGridRef` is wrong, or `oneGridRef` is a commit SHA. The clone uses `--branch`, which accepts a branch or tag, and the zip fallback resolves branches only | Set `oneGridRef` to a branch or tag, and check the repository URL | [`onegrid-solution-provision.ps1`][wrapper] |
| The script fails with `deploy.ps1 finished with issues (exit <n>)` | One or more provisioner phases recorded an error | Read `DEPLOY FINISHED WITH <n> ISSUE(S)` at the end of the log, fix each phase's cause, and redeploy | [`onegrid-solution-provision.ps1`][wrapper]; [`deploy.ps1`][deploy] |
| `WARNING: no Foundry endpoint` in the app-plane log | The `foundry` phase didn't produce an endpoint, so the web app was deployed without AI wiring | Fix the Microsoft Foundry error earlier in the log, then redeploy | [`deploy.ps1`][deploy] (`Phase-ChatAgent`) |
| `Foundry account create failed` or `subdomain unavailable` | A soft-deleted Microsoft Foundry account holds the name. This happens only when the provisioner creates its own account, because the AI agent component is off | The provisioner purges and retries, then falls back to a new name. If it still fails, purge the soft-deleted account and redeploy | [`deploy.ps1`][deploy] (`Phase-Foundry`) |
| `sign-in: could not auto-create the app registration`, or `sign-in NOT wired` | The deployment identity doesn't have Microsoft Graph `Application.ReadWrite.OwnedBy` | Set `grantProvisionerGraphPermission`, or supply `entraSignInClientId`, and redeploy | [`deploy.ps1`][deploy] (`Phase-ChatAgent`); [Copilot runbook][copilot] |
| `chat agent FAILED to provision in all attempted regions` | The phase couldn't configure the web app | Read the errors above it, fix the cause, and redeploy | [`deploy.ps1`][deploy] (`Phase-ChatAgent`) |
| `no Fabric plane in this run - omitting KUSTO_*/PBI_*/DATA_AGENT_*` | Expected. The app plane doesn't build Fabric items | None. The Fabric-plane script writes these settings afterward | [`deploy.ps1`][deploy] (`Phase-ChatAgent`) |
| `PHASE unified: need workspace + lakehouse - run 'core' first` | Expected. The wrapper adds `unified` to the app plane's phases, but the workspace doesn't exist yet | None. The phase runs again in the Fabric plane | [`onegrid-solution-provision.ps1`][wrapper]; [`deploy.ps1`][deploy] (`Phase-Unified`) |
| `show-log` returns nothing or an error | The container hasn't started, the command used `-n` instead of `--name`, or the one-day retention passed | Wait and retry with `--name`. After retention, redeploy to get a new log | [Copilot runbook][copilot-monitor]; [`main.bicep`][bicep] (`retentionInterval`) |

## Fabric-plane script

These problems appear in the log of `pcpro-onegrid-provision-fabric`, which builds the Fabric
workspace and items and then rewires the app's Fabric settings.

| Symptom | Cause | Fix | Source |
| --- | --- | --- | --- |
| 401 or 403 when the script creates the workspace | The Fabric tenant setting for service principals isn't enabled for `pcpro-fabricplane-identity` | Have a Fabric administrator enable **Service principals can create workspaces, connections, and deployment pipelines**, and redeploy | [Copilot runbook][copilot] |
| `capacity assign:` with an error, or `capacity '<id>' not found in Fabric capacities list (is the identity a capacity admin?)` | `pcpro-fabricplane-identity` has no rights on the existing capacity | Add the identity as a capacity **Contributor** or **Admin** in the Fabric admin portal, and redeploy | [`deploy.ps1`][deploy] (`Phase-Workspace`); [Copilot runbook][copilot] |
| The Fabric-plane script didn't run, but the app plane did | The Fabric capacity resource failed. Only the Fabric-plane script depends on it, so the app's GeoCatalog, Microsoft Foundry, and storage wiring still completes | Fix the capacity problem, such as quota or registration, and redeploy | [`main.bicep`][bicep] (`fabricPlaneScript`) |
| `could not add workspace admin <id> - add yourself in the Fabric portal (Manage access)` | The role assignment for the deploying user failed | Add yourself under **Manage access** in the workspace | [`deploy.ps1`][deploy] (`Phase-Workspace`) |
| `eventhouse schema FAILED after 8 attempts`, then `skipping Eventhouse ingest - schema was not applied` | The new KQL database wasn't ready to run the schema script | Redeploy. The phase skips a schema that's already applied | [`deploy.ps1`][deploy] (`Phase-Core`, `Phase-Data`) |
| `NOTE (expected, harmless): demo outages not pre-seeded` | The new KQL table is still warming up | None. The demo outages populate when you select **Launch Demo** | [`deploy.ps1`][deploy] (`Phase-Core`) |
| `hazard-geo KQL FAILED after 6 attempts` | The KQL database wasn't ready for the hazard join script | Redeploy | [`deploy.ps1`][deploy] (`Phase-FabricPlane`) |
| `could not create app registration (insufficient AAD permission?) - supply config.fixedIdentity manually` | No refresh identity: the Graph permission isn't granted, and no refresh service principal was supplied | Set `grantProvisionerGraphPermission`, or supply the `refreshServicePrincipal*` parameters, and redeploy | [`deploy.ps1`][deploy] (`Ensure-DeploySP`) |
| `cloud-seed did not complete cleanly - Delta load may find no files` | The `_seed_data` notebook, which downloads the data bundle into OneLake, didn't finish | Check the notebook's run in the workspace, including its access to GitHub, and redeploy | [`deploy.ps1`][deploy] (`Phase-Data`) |
| `semantic-main-import not found - run the 'semantic' phase first. Skipping.` | The semantic phase failed earlier, so the data agent has no model | Fix the semantic-phase error, and redeploy | [`deploy.ps1`][deploy] (`Phase-DataAgent`) |
| `WARNING: no Foundry endpoint` in the Fabric-plane log | Expected. The Fabric plane doesn't run the `foundry` phase. App settings merge, so the app keeps the AI settings that the app plane wrote | None | [`deploy.ps1`][deploy] (`Phase-ChatAgent`); [`main.bicep`][bicep] (`fabricPlaneScript`) |

## App runtime

| Symptom | Cause | Fix | Source |
| --- | --- | --- | --- |
| The app returns 403 or 404, or a blank page, after deployment | The app can't read its package blob, often because a policy turned off public network access on storage | Redeploy with `exemptStorageFromPolicy` if the policy allows an opt-out tag. Otherwise allow the web app to reach the `onegrid-app-package` container, and restart the app | [Copilot runbook][copilot] |
| The first request takes about a minute | The app is starting | Wait, then request `/api/health`, which returns HTTP 200 | [Copilot runbook][copilot-verify] |
| The sign-in tile shows **not configured** | The deployment identity couldn't create the sign-in registration | Grant the Graph permission, or supply `entraSignInClientId` for a SPA registration with redirect URI `https://<app>/auth/callback`, and redeploy | [Copilot runbook][copilot] |
| Sign-in fails with a redirect URI error after you supplied `entraSignInClientId` | The provisioner adds the redirect URI only to a registration it creates | Add `https://<app-host>/auth/callback` as a SPA redirect URI on your registration | [`deploy.ps1`][deploy] (`Phase-ChatAgent`) |
| Chat replies `API error (404) DeploymentNotFound` | The app's `AI_DEFAULT_MODEL` doesn't match the model deployment name | Align `AI_DEFAULT_MODEL` with the deployment, for example by redeploying with the intended `openAiDeploymentName` | [Copilot runbook][copilot-verify]; [runbook][runbook] |
| Copilot chat can't answer | The `copilot` module is enabled without the AI agent component | Select the AI agent component and redeploy | [Portal form][ui] (App modules) |
| The Explorer shows the sample Hurricane Gabrielle data instead of your catalog | `GEOCATALOG_URI` isn't set, because GeoCatalog wasn't deployed or the app plane didn't wire it | Deploy GeoCatalog, check the app-plane log, and redeploy | [`deploy.ps1`][deploy] (`Phase-ChatAgent`) |
| Catalog requests return 403 | The app identity has no GeoCatalog data-plane role | Check the **GeoCatalog Administrator** assignment that the template creates for the web app | [`deploy.ps1`][deploy] (`Phase-ChatAgent`); [`main.bicep`][bicep] (`chatAgentGeoCatalogAdmin`) |
| Asset uploads return 403 | The app identity can't write to `sample-assets` | Check the **Storage Blob Data Contributor** assignment that the template creates for the web app | [`main.bicep`][bicep] (`chatAgentStorageContributor`) |
| Assets and weather stay empty although uploads and forecasts succeed | `REPORT_API_URL` doesn't match the app's port, so the app's calls to itself fail | Confirm `REPORT_API_URL` is `http://127.0.0.1:8080` and `REPORT_PORT` is `8080` | [`deploy.ps1`][deploy] (`Phase-ChatAgent`) |
| A setting you changed by hand is gone after a redeployment | Azure Resource Manager replaces the web app's settings on every deployment, and the scripts reapply only the computed ones | Set the value through a parameter, such as `oneGridModules`, instead | [`main.bicep`][bicep] (`appProvisionScript`) |
| The Aurora card shows **Unreachable** | The Aurora endpoint never came up, for example because of GPU quota or a Key Vault conflict | Check the `auroraEndpoint` deployment and its model in Azure Machine Learning studio | [`main.bicep`][bicep] (`PCP_AURORA_ENDPOINT`) |
| **Ask Fabric Data Agent** isn't available in chat | No published data agent was found | Check the `dataagent` phase in the Fabric-plane log, and redeploy | [`deploy.ps1`][deploy] (`Phase-ChatAgent`) |
| DAX queries fail | Capacity state, `PBI_WORKSPACE`, `PBI_DATASET`, runtime grants, or the model binding | Correct the target and access, refresh if needed, and verify the expected business rows | [Runbook][runbook] |
| KQL is empty or fails | `KUSTO_CLUSTER`, `KUSTO_DATABASE`, the viewer grant, ingestion, or the source heartbeat | Repair the failing stage, replay safely, and verify the latest event | [Runbook][runbook] |

## Data and refresh

| Symptom | Cause | Fix | Source |
| --- | --- | --- | --- |
| The semantic model refresh failed, or chat says the watchlist is empty | No refresh service principal, or the refresh hit a data error | Check the model's refresh history in the workspace. Supply a refresh service principal and redeploy | [Copilot runbook][copilot] |
| `WARNING: no Import model found - chat agent DAX will not work until PBI_DATASET is set` | The semantic phase didn't produce an Import model | Fix the semantic-phase error and redeploy | [`deploy.ps1`][deploy] (`Phase-ChatAgent`) |
| Model data is stale | Source processing, SQL metadata, the connection credential, or the refresh schedule | Repair the processing or binding, refresh, and compare counts and timestamps | [Runbook][runbook] |
| Refresh fails after you recreate a workspace with the same name | The tenant-level connection `<workspace name> - sql` survives a workspace delete and still points at the deleted SQL endpoint | Delete that connection under **Manage connections and gateways**, and redeploy | [`deploy.ps1`][deploy] (`Phase-Teardown`) |
| No live telemetry arrives, and the data-plane settings contain `REPLACE-ME` | No deployment path creates the `pi-events-stream` Eventstream | Publish the Eventstream yourself, then run the data-plane add-on | [Known gap][gap] |
| The `pcp_model_outputs` shortcut is missing | No storage connection was supplied or created. `fabricPlaneCommand` says so | Redeploy with `createFabricConnection` or `fabricConnectionId` | [`main.bicep`][bicep] (`fabricPlaneCommand`) |
| SQL queries don't apply OneLake roles per user | The Lakehouse SQL analytics endpoint isn't in user-identity mode | Switch the endpoint to user-identity mode in the workspace settings | [`deploy.ps1`][deploy] (`Phase-Governance`) |

## Forecast job

| Symptom | Cause | Fix | Source |
| --- | --- | --- | --- |
| Creating the job fails with `MANIFEST_UNKNOWN` | The image didn't exist in the registry when Container Apps validated it | With the template's registry, check the `pcpro-aurora-image-build` log, fix the build, and redeploy. With `auroraJobImage`, push the image first | [`main.bicep`][bicep] (`auroraImageBuild`) |
| `pcpro-aurora-image-build` fails to clone | `oneGridRef` is a commit SHA, or the repository is unreachable | Use a branch or tag, and allow outbound access to GitHub | [`main.bicep`][bicep] (`auroraImageBuild`) |
| The job can't pull an image from your own registry | The job identity has no pull access there | Grant **AcrPull** to the `auroraJobIdentityPrincipalId` output on that registry | [`main.bicep`][bicep] (`auroraJobIdentityPrincipalId`) |
| The job runs, but scoring fails | The endpoint has no model deployment: `auroraModelDeployed` is `false` | Deploy the model to the `auroraEndpoint` endpoint, or redeploy with a model asset and quota | [`main.bicep`][bicep] (`auroraModelDeployed`) |
| **Run Aurora forecast now** in the app fails | The app identity's **Container Apps Jobs Operator** role exists only when the job and the web app deploy together | Deploy both in the same deployment | [`main.bicep`][bicep] (`chatAgentAuroraJobOperator`) |
| Weather is stale or absent | Input retrieval, the image, GPU readiness, the transfer channel, or publication | Repair the failing stage; check the output's age and provenance before you mark it current | [Runbook][runbook] |
| The job succeeds but publishes no storms | A valid result when no storms are detected | Confirm the run completed and its inputs and output are current; don't alert on a zero count alone | [Runbook][runbook-monitor] |

## Next steps

- [Known issues](known-issues.md)
- [Operational runbook](../operations-runbook.md)
- [Parameter reference](reference/parameters.md)

[copilot]: ../../DEPLOY-WITH-COPILOT.md#troubleshooting
[copilot-prereq]: ../../DEPLOY-WITH-COPILOT.md#step-2--check-prerequisites
[copilot-choices]: ../../DEPLOY-WITH-COPILOT.md#step-1--collect-the-deployment-choices
[copilot-monitor]: ../../DEPLOY-WITH-COPILOT.md#step-6--monitor
[copilot-verify]: ../../DEPLOY-WITH-COPILOT.md#step-7--verify
[bicep]: ../../planetary-computer-pro-poc/deploy/azure/main.bicep
[ui]: ../../planetary-computer-pro-poc/deploy/azure/createUiDefinition.json
[preflight]: ../../planetary-computer-pro-poc/deploy/azure/scripts/preflight-quota.ps1
[prereq]: ../../planetary-computer-pro-poc/deploy/azure/scripts/Test-OneGridPrerequisites.ps1
[wrapper]: ../../planetary-computer-pro-poc/deploy/azure/scripts/onegrid-solution-provision.ps1
[deploy]: ../../planetary-computer-pro-poc/infra/deploy.ps1
[runbook]: ../operations-runbook.md#common-incident-procedures
[runbook-monitor]: ../operations-runbook.md#monitor-user-journeys-and-dependencies
[gap]: ../architecture/design-guide.md#known-gap-live-ingestion-eventstream
