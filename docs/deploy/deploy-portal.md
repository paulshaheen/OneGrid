---
title: Deploy OneGrid from the Azure portal
description: Walk through the OneGrid Deploy to Azure form tab by tab, monitor the deployment and its deployment scripts, and complete the post-deployment steps.
ms.date: 11/24/2026
ms.topic: how-to
---

# Deploy OneGrid from the Azure portal

Part of the [OneGrid landing zone design guide](../architecture/design-guide.md).

[Deploy OneGrid](README.md) | [Get started](getting-started.md) |
[Parameter reference](reference/parameters.md) | [Troubleshooting](troubleshooting.md)

The **Deploy to Azure** button opens the compiled template,
[`azuredeploy.json`](../../planetary-computer-pro-poc/deploy/azure/azuredeploy.json), with its
portal form,
[`createUiDefinition.json`](../../planetary-computer-pro-poc/deploy/azure/createUiDefinition.json).
The form has five tabs before **Review + create**: **Basics**, **Components**, **App
modules**, **AI**, and **Fabric plane**. You can move between tabs in any order. Controls
appear only when the components that use them are selected.

This page describes each control, the template parameter it sets, and its default. The
[parameter reference](reference/parameters.md#portal-form-coverage) lists the same mapping,
generated from the form.

## Before you begin

- Complete the [prerequisites](getting-started.md#prerequisites) for the components you plan
  to select, and run the [validation scripts](getting-started.md#validate-prerequisites).
- Decide on a [greenfield or brownfield](getting-started.md#choose-greenfield-or-brownfield)
  deployment, and have any existing capacity ID and client IDs ready.
- Plan to deploy into a new, empty resource group.

## Open the form

Select the button, and sign in to the Azure portal:

[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Fpaulshaheen%2FOneGrid%2Fmain%2Fplanetary-computer-pro-poc%2Fdeploy%2Fazure%2Fazuredeploy.json/createUIDefinitionUri/https%3A%2F%2Fraw.githubusercontent.com%2Fpaulshaheen%2FOneGrid%2Fmain%2Fplanetary-computer-pro-poc%2Fdeploy%2Fazure%2FcreateUiDefinition.json)

The button deploys the template and form from the repository's `main` branch.

## Basics

| Control | Parameter | Default | What it controls |
| --- | --- | --- | --- |
| **Subscription** | (deployment scope) | | The subscription that holds the resource group |
| **Resource group** | (deployment scope) | | The resource group for every resource. Select **Create new** for a new stamp |
| **Region** | `location` | (you choose) | The region for every resource. The list shows only `eastus`, `northcentralus`, `westeurope`, `canadacentral`, and `uksouth`, where GeoCatalog is available during its preview |
| **GeoCatalog name** | `geoCatalogName` | blank | The GeoCatalog's name: 3 to 24 lowercase letters or numbers. Leave it blank to generate `pcpro<unique>`, the same name the sample storage account gets |

## Components

**Components to deploy** is a multi-select list with **Select all**. It sets one switch
parameter per component.

| Option | Parameter | Selected by default | Requires |
| --- | --- | --- | --- |
| **Planetary Computer Pro GeoCatalog** | `deployGeoCatalog` | Yes | |
| **Sample storage + ingestion identity** | `deploySampleStorage` | Yes | |
| **AI agent (Microsoft Foundry)** | `deployAiAgent` | Yes | |
| **Aurora weather model (GPU Foundry endpoint)** | `deployAuroraModel` | No | A100 quota and Marketplace terms |
| **Aurora scheduled forecast job (Container Apps)** | `deployAuroraSchedule` | No | The Aurora weather model and sample storage |
| **OneGrid Fabric plane (OneLake + hazard join)** | `deployFabricPlane` | Yes | Sample storage |
| **OneGrid web app (Microsoft Foundry + chat/report)** | `deployOneGridApp` | Yes | The Fabric plane |
| **OneGrid historical data seed (large)** | `deployOneGridData` | Yes | The Fabric plane |

The template skips a component whose dependency isn't selected. The form warns you, on the
**AI** and **Fabric plane** tabs, when the forecast job or the Fabric plane is missing a
dependency, but not when the web app or data seed is selected without the Fabric plane.
Selecting the web app also sends `enableEntraSignIn` = `true`; the form has no separate
control for it.

The web app runs on App Service from a prebuilt package, and the template builds the forecast
job's pipeline image itself, so neither needs a build step from you.

Below the list, the storage policy controls set the [storage policy exemption](getting-started.md#storage-policy):

| Control | Parameter | Default | What it controls |
| --- | --- | --- | --- |
| **Exempt this deployment's storage from storage policies** | `exemptStorageFromPolicy` | Cleared | Tags the storage accounts with the exemption tag and runs the deployment scripts on a dedicated tagged storage account. Check it only with an approved exemption |
| **Policy exemption tag name** | `storagePolicyExemptionTagName` | `SecurityControl` | The tag name your policy honors. Shown and required when the box is checked |
| **Policy exemption tag value** | `storagePolicyExemptionTagValue` | `Ignore` | The tag value your policy honors. Shown and required when the box is checked |

## App modules

**App modules to enable** sets `oneGridModules`, which the template writes to the web app's
`ONEGRID_MODULES` setting. All eight modules are selected by default. The core pages
(Overview, Asset Explorer, Maintenance, Alerts, Ontology, Thresholds, Governance, Cyber
Readiness, and Deployment) are always included. Clear every module to deploy only the core
pages; the template then sets `ONEGRID_MODULES` to `none`.

| Option | Module ID | Adds |
| --- | --- | --- |
| **Executive Brief** | `exec` | The leadership brief: Dashboard, Actions, Scorecard, and Workbench views |
| **Weather Intelligence** | `weather` | Storm map, forecast timeline, exposure, response posture, and corridor weather |
| **Digital Twin & Simulation** | `twin` | 3D Control Room, failure simulation, and the distribution network view |
| **IT/OT Infrastructure** | `infra` | The admin plane for the servers, data, network, and OT estate |
| **SAP S/4HANA** | `sap` | The SAP plant maintenance view |
| **ESU Planner** | `esu` | The Extended Security Updates cost and modernization planner |
| **OneRig (Oil & Gas)** | `onerig` | The oil and gas solution and the Energy / Oil & Gas switch |
| **Copilot chat** | `copilot` | The assistant dock. Needs the AI agent component |

The tab warns you when the web app isn't selected, because the choices are then ignored, and
when **Copilot chat** is selected without the AI agent.

## AI

The **AI** tab has three sections. Each appears only when its component is selected.

### AI agent

The **AI agent (Microsoft Foundry)** section appears when the AI agent component is
selected.

| Control | Parameter | Default | What it controls |
| --- | --- | --- | --- |
| **Model deployment name** | `openAiDeploymentName` | `gpt-5-mini` | The name of the model deployment in the Microsoft Foundry account: 2 to 64 letters, numbers, dots, dashes, or underscores. The web app uses this name as its default model |

The model, version, deployment type, and capacity aren't on the form. The template deploys
`gpt-5-mini` version `2025-08-07` as `GlobalStandard` with 10,000 tokens per minute. Change
them from the [command line](deploy-cli.md) with `openAiModelName`, `openAiModelVersion`,
`openAiSkuName`, and `openAiCapacity`.

### Aurora weather model

A warning at the top of the **Aurora weather model (GPU)** section explains the quota rules. The workspace and endpoint
always deploy with this component; the GPU model deploys only when you check **Deploy the
Aurora model for me** or supply an asset ID, and you have dedicated quota.

| Control | Parameter | Default | What it controls |
| --- | --- | --- | --- |
| **GPU instance type** | `auroraInstanceType` | `Standard_NC24ads_A100_v4` | The VM size of the Aurora deployment. Aurora requires an A100-class size |
| **Deploy the Aurora model for me (official published asset)** | `createAuroraModelDeployment` | Cleared | Deploys `azureml://registries/azureml/models/Aurora/versions/4` to the endpoint. With zero dedicated A100 quota, this fails with a capacity error |
| **Aurora model asset ID (optional)** | `auroraModelAssetId` | blank | A specific registry model asset to deploy. Shown only when the box above is cleared. Leave it blank to deploy the workspace and endpoint only |

### Aurora forecast job

The **Aurora scheduled forecast job (Container Apps)** section shows a warning when the
Aurora weather model or sample storage isn't selected, because the job doesn't deploy
without them.

| Control | Parameter | Default | What it controls |
| --- | --- | --- | --- |
| **Custom pipeline image (optional override)** | `auroraJobImage` | blank | An image to run instead of the one the deployment builds, such as `myregistry.azurecr.io/aurora-pipeline:latest`. When blank, the template creates a registry and builds the image into it |
| **Schedule (cron, UTC)** | `auroraJobCron` | `0 1,7,13,19 * * *` | The job's cron schedule. The default runs about an hour after each 00, 06, 12, and 18 UTC cycle |

## Fabric plane

The **Fabric plane** tab holds the Fabric settings, and also the web app plan and the
sign-in and refresh identity settings. Most controls appear only when **OneGrid Fabric
plane** is selected; the web app plan and sign-in controls appear when **OneGrid web app**
is selected.

### Capacity and workspace

| Control | Parameter | Default | What it controls |
| --- | --- | --- | --- |
| **Create a new Fabric capacity for me** | `createFabricCapacity` | Cleared | Creates a new F-SKU capacity in the resource group. It's billed hourly until you pause or delete it |
| **New Fabric capacity SKU** | `fabricCapacitySku` | `F2` | The new capacity's size, from `F2` to `F2048`. Shown when the box is checked |
| **Capacity admin (email or object id, optional)** | `fabricCapacityAdmin` | blank | A person to add as a capacity administrator, by user principal name or object ID. Shown when the box is checked |
| **Existing Fabric capacity (resource ID or GUID)** | `fabricCapacityId` | blank | The capacity to deploy onto. Shown and required when the box is cleared |
| **Fabric workspace name** | `fabricWorkspaceName` | `OneGrid` | The Fabric workspace's display name: 1 to 64 letters, numbers, spaces, dashes, or underscores |
| **Build the unified asset model (recommended)** | `deployUnifiedModel` | Checked | Generates the conformed `og.*` tables and the `OneGridModelImport` model that the dashboards and chat use. Shown when the Fabric plane and web app are both selected. Needs a refresh identity |

With the defaults, **Create a new Fabric capacity for me** is cleared, so the form requires
an existing capacity before **Review + create** succeeds.

### Storage connection

| Control | Parameter | Default | What it controls |
| --- | --- | --- | --- |
| **Create the storage connection for me (workspace identity)** | `createFabricConnection` | Checked | Creates the Fabric cloud connection to the sample storage account with the workspace identity, and the `pcp_model_outputs` shortcut |
| **Fabric storage connection ID (optional)** | `fabricConnectionId` | blank | The GUID of an existing connection to use instead. Shown when the box is cleared. Leave it blank to add the shortcut later |

### Web app plan

| Control | Parameter | Default | What it controls |
| --- | --- | --- | --- |
| **OneGrid web app plan (App Service SKU)** | `chatAgentAppServiceSku` | B1 (Basic - low cost) | The App Service plan tier: Basic B1 to B3, Standard S1 to S3, or Premium v3 P0v3 to P3v3 |

### Sign-in and refresh identity

| Control | Parameter | Default | What it controls |
| --- | --- | --- | --- |
| **Create the sign-in (Entra SPA) app registration for me** | (none) | Checked | When checked, the provisioner creates or reuses the sign-in registration. When cleared, the form asks for an existing one |
| **Existing sign-in app registration (client ID)** | `entraSignInClientId` | blank | The client ID of an existing SPA registration. Shown and required when the box above is cleared |
| **Grant the deployment identity permission to create app registrations** | `grantProvisionerGraphPermission` | Cleared | Grants `pcpro-fabricplane-identity` the Microsoft Graph permission `Application.ReadWrite.OwnedBy`, so the scripts can create the sign-in registration and the refresh service principal. You must be a Privileged Role Administrator or Global Administrator |
| **Refresh service principal client ID (optional)** | `refreshServicePrincipalClientId` | blank | An existing service principal that binds and refreshes the Import model. Shown when the Graph box is cleared |
| **Refresh service principal object ID** | `refreshServicePrincipalObjectId` | blank | The service principal's object ID, from **Enterprise applications**, not the app registration. Required when a client ID is entered |
| **Refresh service principal client secret** | `refreshServicePrincipalSecret` | blank | The client secret, sent as a secure parameter. Required when a client ID is entered |

If you check neither the Graph permission nor supply a refresh service principal, the
deployment succeeds, but the Import model isn't refreshed. If the deployment identity can't
create the sign-in registration, the web app still runs with sign-in unconfigured.

## Review and create

1. Select **Review + create**. The portal validates the form and the template. Validation
   catches some quota problems, such as App Service plan quota
   (`InternalSubscriptionIsOverQuotaForSku`). Fabric capacity-unit and GPU quota problems
   appear only when Azure Resource Manager creates those resources, which is why the
   [quota preflight](getting-started.md#validate-prerequisites) matters.
2. Optionally, select **Download a template for automation** to keep the template and the
   parameter values you chose. Adapt them into a
   [parameter file](../../planetary-computer-pro-poc/deploy/azure/parameters/README.md) for
   repeat deployments, and keep secrets out of it.
3. Select **Create**.

If validation fails, read the error on the **Review + create** tab, and use the
[ARM deployment table](troubleshooting.md#arm-deployment) in the troubleshooting guide.

## Monitor the deployment

A full deployment commonly takes 30 to 90 minutes. The Fabric plane and the data seed take
the longest, and the deployment scripts can run for up to 2 hours (app plane) and 3 hours
(Fabric plane).

1. **Watch the resources.** The portal opens the deployment's **Overview** page, which lists
   each resource and its status. To return to it later, open the resource group and select
   **Settings** > **Deployments**. The portal names the deployment
   `Microsoft.Template-<timestamp>`; note the name for validation.
2. **Read the deployment script logs.** In the resource group, open the deployment script
   resources and select **Logs**:
   - `pcpro-onegrid-provision-app`, the app plane, which runs first.
   - `pcpro-onegrid-provision-fabric`, the Fabric plane, which runs after the app plane.
   - `pcpro-aurora-image-build`, when the forecast job builds its image.

   Each provisioner phase logs lines that start with a `[hh:mm:ss]` timestamp and
   `PHASE <name>`. A log is available only after its container starts.
3. **Find a failure.** When the deployment fails, select the failed resource on the
   **Overview** page to see its status message. A deployment script fails when the
   provisioner reports any phase error: `deploy.ps1 finished with issues`. The phase summary
   at the end of the log names each one.

Capture the script logs promptly. The deployment script resources are kept for one day after
they finish, and their containers are removed when they succeed.

## Complete the post-deployment steps

1. **Read the outputs.** On the deployment's **Outputs** page, find `oneGridAppUrl`,
   `geoCatalogUri`, `fabricPlaneEnabled`, `oneGridPhases`, and the script results
   `appPlaneProvisionResult` and `fabricPlaneProvisionResult`. The Fabric result includes the
   `workspaceId` and the provisioner's `deployExit` code.
2. **Open the app.** Browse to `oneGridAppUrl`. The first request after deployment can take
   about a minute while the app starts. `<oneGridAppUrl>/api/health` returns HTTP 200 when
   the app is up.
3. **Finish sign-in.** If you supplied `entraSignInClientId`, add
   `<oneGridAppUrl>/auth/callback` as a **Single-page application** redirect URI on that
   registration, under **Authentication** in the Microsoft Entra admin center.
4. **Grant yourself catalog access.** Data-plane access to GeoCatalog needs a role. On the
   GeoCatalog resource, open **Access control (IAM)**, and assign yourself **GeoCatalog
   Administrator** or **GeoCatalog Reader**. The web app's identity already has
   **GeoCatalog Administrator**.
5. **Open the Fabric workspace.** The deploying user is an **Admin** of the workspace. Find it
   in the Fabric portal by its name, `fabricWorkspaceName`.
6. **Fix existing-capacity rights.** If you used an existing capacity and the Fabric-plane log
   reports a capacity assignment problem, add `pcpro-fabricplane-identity` as a capacity
   administrator in the Fabric admin portal, and redeploy with the same values.
7. **Add the shortcut, if needed.** When `fabricPlaneCommand` reads `provisioned (set
   fabricConnectionId to add the OneLake shortcut)`, create a Fabric cloud connection to the
   sample storage account and redeploy with its ID in `fabricConnectionId`.
8. **Deploy the Aurora model, if needed.** When `auroraModelDeployed` is `false`, deploy the
   model from Azure Machine Learning studio to the endpoint the template created, named in
   the `auroraEndpoint` output. The app's `AURORA_ENDPOINT` setting already points at that
   endpoint's scoring URL. If you use a different endpoint, a redeployment resets the
   setting to the template's endpoint.
9. **Plan live ingestion.** The deployment doesn't create the Eventstream for live
   telemetry. See the
   [known gap](../architecture/design-guide.md#known-gap-live-ingestion-eventstream).
10. **Validate.** Run the deployment validation script with the resource group and the
    deployment name from the **Deployments** page:

    ```powershell
    ./planetary-computer-pro-poc/deploy/azure/scripts/Test-OneGridDeployment.ps1 -ResourceGroupName <rg> -DeploymentName <name> -OutputPath ./onegrid-evidence.json
    ```

    The script automates the
    [acceptance checks](../deployment-and-data-guide.md#acceptance-checks) and writes the
    results to the `-OutputPath` file, or to `onegrid-acceptance-<timestamp>.json` by default.
    It records checks that need a signed-in person as `MANUAL`; complete those yourself.

## Change the deployment later

Redeploy the same template into the same resource group with changed selections. The
deployment scripts run again on every deployment, and Azure Resource Manager resets the web
app's settings to the template's values, which the scripts then reapply. A setting you change
by hand on the web app, such as `ONEGRID_MODULES`, lasts only until the next deployment, so
change modules on the **App modules** tab instead.

Clearing a component in a redeployment doesn't delete its resources; the deployment runs in
incremental mode. To remove an environment, see [Tear down](deploy-cli.md#tear-down).

## Next steps

- [Troubleshooting](troubleshooting.md)
- [Load and connect data](../deployment-and-data-guide.md#load-and-connect-data)
- [Day 2 operations](../operations.md)
