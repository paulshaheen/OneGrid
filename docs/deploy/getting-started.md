---
title: Get started with a OneGrid deployment
description: Check the Azure, Microsoft Fabric, Microsoft Entra, Aurora, and storage policy prerequisites for OneGrid, validate them with a script, plan components and the network model, and review what each component deploys.
ms.date: 11/24/2026
ms.topic: how-to
---

# Get started with a OneGrid deployment

Part of the [OneGrid landing zone design guide](../architecture/design-guide.md).

[Deploy OneGrid](README.md) | [Deploy from the Azure portal](deploy-portal.md) |
[Deploy from the command line](deploy-cli.md)

Use this page before your first deployment. Work through the prerequisite checklists,
validate them with the prerequisite script, and then make the planning decisions that
determine your parameter values. Some prerequisites live outside Azure Resource Manager, in
Microsoft Fabric administration and Microsoft Entra ID, so they need owners other than the
person who deploys. Start those requests early.

## Prerequisites

Check the items that apply to the components you plan to deploy. The
[component table](#choose-components) shows which components need which prerequisites.

### Azure subscription and roles

- [ ] An Azure subscription in the Microsoft Entra tenant that your Microsoft Fabric tenant
      uses.
- [ ] **Owner**, or **Contributor** plus **User Access Administrator**, on the target
      resource group or subscription for the person or pipeline that deploys. The template
      creates role assignments, including **Owner** on the resource group for the deployment
      identity `pcpro-fabricplane-identity` when the web app is selected, and data-plane roles
      for every managed identity.
- [ ] Rights to create the deployment-script resources. Each deployment script runs in an
      Azure Container Instances container with a storage account. The app-plane and
      Fabric-plane scripts run as `pcpro-fabricplane-identity`, and the forecast image build
      runs as `pcpro-aurora-job-identity`. **Owner** on the resource group covers this,
      including **Managed Identity Operator** on those identities.
- [ ] A plan for who becomes an administrator. The deploying principal is added as an
      **Admin** of the Fabric workspace and gets **Cognitive Services OpenAI User** on the
      Microsoft Foundry account. When a pipeline deploys with a service principal, that
      principal gets these roles instead of a person, so add people afterward.

### Resource providers

- [ ] Register the resource providers for the components you select. Registration can take a
      few minutes.

| Resource provider | Used by |
| --- | --- |
| `Microsoft.Orbital` | GeoCatalog |
| `Microsoft.Storage` | Sample storage, the Azure Machine Learning workspace storage, and deployment-script storage |
| `Microsoft.ManagedIdentity` | Ingestion, deployment, and forecast-job identities |
| `Microsoft.CognitiveServices` | The Microsoft Foundry account and model deployment |
| `Microsoft.Resources` | Deployment scripts |
| `Microsoft.ContainerInstance` | The containers that deployment scripts run in |
| `Microsoft.Web` | The App Service plan and web app |
| `Microsoft.Fabric` | A new Fabric capacity. The deployment scripts also try to register it |
| `Microsoft.MachineLearningServices`, `Microsoft.KeyVault`, `Microsoft.Insights` | The Aurora workspace, its Key Vault, and its Application Insights |
| `Microsoft.App`, `Microsoft.ContainerRegistry`, `Microsoft.OperationalInsights` | The forecast job, its registry, and its Log Analytics workspace |
| `Microsoft.Quota` | The quota preflight script, which registers it for you |

Register a provider with either tool:

```bash
az provider register --namespace Microsoft.Orbital
```

```powershell
Register-AzResourceProvider -ProviderNamespace Microsoft.Orbital
```

### Region

- [ ] Choose one of the regions that the template accepts: `eastus`, `northcentralus`,
      `westeurope`, `canadacentral`, or `uksouth`.

The list follows Planetary Computer Pro GeoCatalog availability during its preview. The
`location` parameter's `@allowed` list applies to every resource, so it constrains the
region even when you don't deploy GeoCatalog. The portal form also filters its region list to
regions that offer `Microsoft.Orbital/geoCatalogs`.

- [ ] Confirm that the region has the capacity your selection needs. Everything deploys to
      the one `location`, so create the resource group in the same region.
  - Fabric capacity units for the capacity SKU, when the template creates a capacity.
  - App Service quota for the plan SKU. Validation reports
    `InternalSubscriptionIsOverQuotaForSku` when there's none.
  - Dedicated `Standard_NC24ads_A100_v4` cores for Aurora: 24 per instance. The quota
    preflight script also allows for the 20 percent that managed online endpoints reserve.
  - Azure Container Instances, which the deployment scripts need.

### Microsoft Fabric

- [ ] A Fabric administrator has enabled the tenant setting **Service principals can create
      workspaces, connections, and deployment pipelines** for `pcpro-fabricplane-identity`
      or for a security group that it's added to. Without it, the Fabric-plane script can't
      create the workspace.
- [ ] If the deployment creates the storage connection (`createFabricConnection`), your
      Fabric tenant settings also allow workspace identities, which that option uses to
      connect to the storage account without a secret.
- [ ] A capacity plan. Choose one:
  - **New capacity.** Set `createFabricCapacity` to `true`. The template creates an F-SKU
    capacity (`F2` by default) and makes `pcpro-fabricplane-identity` an administrator. Add a
    person with `fabricCapacityAdmin` so you can manage it in the Fabric portal. An F-SKU is
    billed hourly until you pause or delete it, and Azure Resource Manager can't create a
    free trial capacity.
  - **Existing capacity.** Supply `fabricCapacityId`, the resource ID or GUID of an F-SKU or
    trial capacity. `pcpro-fabricplane-identity` needs **Contributor** or **Admin** rights on
    it. The identity exists only after the first deployment, so add it as a capacity
    administrator then and redeploy.
- [ ] Fabric capacity-unit quota in the region for a new capacity. You request it on the
      Azure portal **Quotas** page; it can't be requested through Azure Resource Manager.

### Microsoft Entra ID and Microsoft Graph

The web app's sign-in and the Import semantic model's refresh each need an app
registration. Choose one path for both:

- [ ] **Let the deployment create them.** Set `grantProvisionerGraphPermission` to `true`.
      The template grants `pcpro-fabricplane-identity` the Microsoft Graph application
      permission `Application.ReadWrite.OwnedBy`, and the scripts create the registrations.
      The person who deploys must be a **Privileged Role Administrator** or **Global
      Administrator**.
- [ ] **Bring your own.** Create a single-page application (SPA) registration for sign-in
      and pass its client ID as `entraSignInClientId`. After the deployment, add
      `https://<app-host>/auth/callback` as a SPA redirect URI; the provisioner doesn't add
      it to a registration you supply. Create a refresh service principal and pass
      `refreshServicePrincipalClientId`, `refreshServicePrincipalObjectId`, and
      `refreshServicePrincipalSecret`. The
      [Copilot runbook](../../DEPLOY-WITH-COPILOT.md#step-2--check-prerequisites) lists the
      commands, step 2.6.
- [ ] Without either, the deployment still succeeds. Sign-in stays unconfigured, and the
      Import model is deployed but not refreshed, so dashboards and chat have no model data.

Store the refresh service principal's secret in Azure Key Vault, and pass it to the
deployment from there. The
[brownfield parameter files](../../planetary-computer-pro-poc/deploy/azure/parameters/README.md)
show a Key Vault reference in JSON and `az.getSecret()` in Bicep.

### Aurora weather model and forecast job

Skip this section unless you deploy the Aurora weather model.

- [ ] Dedicated `Standard_NC24ads_A100_v4` quota in the region, not zero. The Azure Machine
      Learning studio option to use shared quota for a temporary endpoint is studio-only;
      template deployments can't use it.
- [ ] Accepted Azure Marketplace terms for the Aurora model.
- [ ] A model choice. `createAuroraModelDeployment` deploys the published asset
      `azureml://registries/azureml/models/Aurora/versions/4`, or you supply
      `auroraModelAssetId`. With neither, only the workspace and the endpoint deploy, and you
      deploy the model from the studio later.
- [ ] For the forecast job, sample storage and the Aurora model in the same deployment. The
      job reads public NOAA GFS initial conditions; its image is built at deployment time
      from the repository.

### Storage policy

- [ ] Find out whether Azure Policy in your subscription disables shared-key access or
      public network access on new storage accounts. Microsoft internal MCAPS subscriptions
      do. Such a policy makes the deployment scripts fail with
      `KeyBasedAuthenticationNotPermitted` and stops the web app from reading its package.
- [ ] If it does, and your organization approves an exemption, set `exemptStorageFromPolicy`
      to `true` and set `storagePolicyExemptionTagName` and
      `storagePolicyExemptionTagValue` to the tag your policy honors. The defaults are
      `SecurityControl` and `Ignore`. The template then tags its storage accounts and runs
      the deployment scripts on a dedicated tagged account.
- [ ] Otherwise, keep `exemptStorageFromPolicy` set to `false`, as the
      [design principles](../architecture/design-guide.md#design-principles) recommend, and
      agree an approach with your platform team before you deploy.

Management-group policies often aren't visible from the subscription. The
[Copilot runbook](../../DEPLOY-WITH-COPILOT.md#step-2--check-prerequisites), step 2.7, lists
signs to look for.

### Outbound access for the deployment scripts

- [ ] Allow the deployment-script containers to reach the internet. The scripts install the
      Azure CLI and Git when they're missing, clone `oneGridRepoUrl` from GitHub (or
      download its source archive from `codeload.github.com`), and download the application
      package from `oneGridAppPackageUrl` before they re-host it in the sample storage
      account.
- [ ] When you seed historical data, allow the Fabric workspace to reach GitHub. A Fabric
      notebook, `_seed_data`, downloads the `onegrid-data.zip` release asset into OneLake.

### Tools

- [ ] The Azure CLI 2.62 or later, or the Az PowerShell module, signed in to the target
      tenant.
- [ ] PowerShell 7 (`pwsh`) to run the scripts in the template's `scripts` folder.
- [ ] The Bicep CLI (`az bicep install`) only if you deploy `main.bicep` or a `.bicepparam`
      file instead of `azuredeploy.json`.

## Validate prerequisites

Run the prerequisite validation script from the repository root, in PowerShell 7, before you
deploy. Sign in first with `az login`. **Reader** on the subscription is enough to run it.

1. Check your subscription, region, and resource group. Pass the parameter file you plan to
   deploy, JSON or `.bicepparam`, so only the checks for your selected components apply, and
   save the results as evidence:

   ```powershell
   ./planetary-computer-pro-poc/deploy/azure/scripts/Test-OneGridPrerequisites.ps1 `
     -SubscriptionId <subscription-id> `
     -Location westeurope `
     -ResourceGroupName onegrid-rg `
     -ParameterFile ./planetary-computer-pro-poc/deploy/azure/parameters/baseline-required.parameters.json `
     -OutputPath ./onegrid-prerequisites.json
   ```

   `-ParameterFile` and `-OutputPath` are optional. Without a parameter file, the script runs
   every check and reports a problem that matters only for an optional component as a warning.

2. Read the results. Each check reports `PASS`, `WARN`, `FAIL`, or `SKIP`, and a failed check
   prints the command or portal step that fixes it. The script exits with code 1 when any check
   fails, so you can use it as a pipeline gate. It's read-only: it doesn't register providers,
   request quota, or create anything. Keep the output file with the deployment record.

3. Confirm the items the script can't read, which it reports as reminders: the Fabric tenant
   settings and the Aurora Marketplace terms. Checks that need directory read access report a
   warning without it.

4. Optionally, use the quota preflight script to submit an A100 quota request. It registers
   the `Microsoft.Fabric` and `Microsoft.Quota` providers if needed, checks Fabric
   capacity-unit and A100 quota, and, with `-RequestGpuQuota`, submits a request to raise the
   A100 family quota. Requests for specialized GPU sizes can route to manual review.

   ```powershell
   ./planetary-computer-pro-poc/deploy/azure/scripts/preflight-quota.ps1 -SubscriptionId <subscription-id> -Location <region>
   ```

[`Test-OneGridPrerequisites.ps1`](../../planetary-computer-pro-poc/deploy/azure/scripts/Test-OneGridPrerequisites.ps1)
and [`preflight-quota.ps1`](../../planetary-computer-pro-poc/deploy/azure/scripts/preflight-quota.ps1)
are in the template's `scripts` folder.

## Plan the deployment

Make these decisions before you choose a parameter file or fill in the portal form.

### Choose components

| Component | Parameter | Selected by default in the portal | Requires | Prerequisites |
| --- | --- | --- | --- | --- |
| Planetary Computer Pro GeoCatalog | `deployGeoCatalog` | Yes | | Region |
| Sample storage and ingestion identity | `deploySampleStorage` | Yes | | Storage policy |
| AI agent (Microsoft Foundry model) | `deployAiAgent` | Yes | | Region |
| OneGrid Fabric plane | `deployFabricPlane` | Yes | Sample storage | Fabric, Microsoft Entra |
| OneGrid web app | `deployOneGridApp` | Yes | Fabric plane | Microsoft Entra, storage policy |
| Historical data seed | `deployOneGridData` | Yes | Fabric plane | Outbound access |
| Aurora weather model | `deployAuroraModel` | No | | Aurora |
| Aurora forecast job | `deployAuroraSchedule` | No | Aurora model, sample storage | Aurora |

The template skips a component whose dependency is off instead of failing. The web app's
Copilot chat module also needs the AI agent component. When you deploy the web app without
the AI agent, the provisioner's `foundry` phase creates its own Microsoft Foundry account,
`pcpro-foundry`, with a `gpt-4o` deployment.

The template defaults and the portal defaults differ: from the command line, the Fabric
plane, web app, and data seed are off unless you turn them on. The
[parameter reference](reference/parameters.md#portal-defaults-that-differ-from-the-template)
lists the differences, and the `baseline-required` parameter file reproduces the portal
defaults.

### Choose greenfield or brownfield

In a greenfield deployment, you deploy into a new, empty resource group, and the template
creates what OneGrid needs. In a brownfield deployment, you connect OneGrid to assets that
already exist.

| Decision | Greenfield | Brownfield |
| --- | --- | --- |
| Fabric capacity | `createFabricCapacity` = `true`, sized with `fabricCapacitySku` | `fabricCapacityId` of an existing F-SKU or trial capacity |
| Sign-in registration | Created by the provisioner (`grantProvisionerGraphPermission` = `true`) | `entraSignInClientId` of an existing SPA registration |
| Import refresh identity | Created by the provisioner with the same Graph permission | `refreshServicePrincipalClientId`, `refreshServicePrincipalObjectId`, and `refreshServicePrincipalSecret` |
| Fabric storage connection | Created with the workspace identity (`createFabricConnection` = `true`) | `fabricConnectionId` of an existing Fabric cloud connection to the storage account |
| Forecast pipeline image | Built into the template's registry at deployment time | `auroraJobImage`, with pull access for the job identity on your registry |
| Parameter file | `baseline-full`, or `baseline-required` with `grantProvisionerGraphPermission` added | `brownfield-existing-capacity` |

`baseline-required` matches the portal defaults, which leave the Graph permission off. Without
it, sign-in stays unconfigured unless you supply `entraSignInClientId`, and the Import model
isn't refreshed unless you supply a refresh service principal.

Deploy each stamp into its own resource group. Resource names derive from the resource
group ID, so a redeployment into the same group reuses the same resources.

### Choose the network model

The baseline template uses authenticated public service endpoints. It doesn't create virtual
networks, private endpoints, an application gateway, or a firewall. Use it for evaluation, or
in an Online landing zone when your security review accepts public endpoints.

For an enterprise landing zone, plan the network integration before you deploy, and apply it
through your own reviewed infrastructure as code:

- Approve the [traffic-flow matrix](../architecture/enterprise-landing-zone.md#traffic-flow-matrix)
  before you restrict any endpoint.
- Prepare the gateway, private endpoint, and App Service integration subnets, connected
  deployment runners, private DNS, and the bootstrap and runtime network rules that the
  matrix requires.
- Use tenant-level Fabric Private Link for the OneGrid workspace, and keep the Eventstream
  artifact's `ProcessedIngestion` mode.
- Create the forecast job's Container Apps environment with a VNet-integrated workload
  profile when you need controlled egress. Plan this at creation time.
- Use a Premium container registry, not the Basic registry the template creates, for a
  private image path.
- Validate private paths, package bootstrap, queries, source access, and image delivery
  before you disable the matching public paths. Record the results with the
  [network acceptance procedure](../operations-runbook.md#validate-network-and-traffic-flows).

[OneGrid in an enterprise landing zone](../architecture/enterprise-landing-zone.md) describes
the full design.

### Size and pin the deployment

| Decision | Parameter | Template default | Consider |
| --- | --- | --- | --- |
| Fabric capacity size | `fabricCapacitySku` | `F2` | Data volume, refresh schedules, and concurrent DAX and KQL users |
| Web app plan | `chatAgentAppServiceSku` | `B1` | Premium v3 for production CPU, memory, autoscale, and cold start |
| Model throughput | `openAiCapacity` | `10` (thousands of tokens per minute) | Chat users and agent tool calls |
| Model deployment type | `openAiSkuName` | `GlobalStandard` | Your processing-geography requirements |
| GPU size | `auroraInstanceType` | `Standard_NC24ads_A100_v4` | Aurora requires an A100-class size |
| Forecast cadence | `auroraJobCron` | `0 1,7,13,19 * * *` (UTC) | About one hour after each 00, 06, 12, and 18 UTC cycle |
| Provisioner source | `oneGridRepoUrl`, `oneGridRef` | The public repository, `main` | Pin a release tag; a commit SHA doesn't work with the scripts' `git clone --branch` |
| Application package | `oneGridAppPackageUrl` | The `app-latest` release asset | Pin a versioned package |

The [cost estimate](cost-estimate.md) explains how each choice affects cost, and the
[known issues](known-issues.md#mutable-source-defaults) explain the source defaults.

## What gets deployed

<a href="../diagrams/onegrid-reference-deployment.svg"><picture><source media="(prefers-color-scheme: dark)" srcset="../diagrams/onegrid-reference-deployment-dark.png"><img alt="OneGrid deployment architecture. The GitHub deployment source (app package, provisioner, and Bicep template) deploys into one resource group in the OneGrid workload subscription, grouped as Weather, Web, Security, Sample storage, AI, Geospatial, Data, Deployment, Monitoring, and Capacity. A dashed OneGrid stamp spans the resource group and the Microsoft-managed OneGrid workspace in Microsoft Fabric. Microsoft Entra ID holds the deployer, OneGrid users, and optional Graph, sign-in, and refresh principals. Five numbered steps run from the ARM deployment to user sign-in, with a governance strip along the bottom." src="../diagrams/onegrid-reference-deployment.png"></picture></a>

[Download SVG](../diagrams/onegrid-reference-deployment.svg) |
[Deployment steps 1 to 5](../architecture/design-guide.md#deployment-view) |
[Resource organization and naming diagram](../diagrams/onegrid-reference-naming.png)
([dark](../diagrams/onegrid-reference-naming-dark.png))

The deployment view shows one stamp: the resource group and the Fabric workspace. The
[resource organization and naming](../architecture/design-guide.md#resource-organization-and-naming)
section explains the name patterns. In the following tables, `<unique>` is
`uniqueString(resourceGroup().id)`, `<suffix>` is its first 8 characters, and `<run>`
changes on every deployment.

### Azure resources by component

| Component | Resources and names | Notes |
| --- | --- | --- |
| GeoCatalog | GeoCatalog `geoCatalogName`, or `pcpro<unique>` when blank | `Basic` tier. Associated with `pcpro-ingest-identity` when sample storage is deployed |
| Sample storage | Storage account `pcpro<unique>` with the `sample-assets` and `model-outputs` containers; managed identity `pcpro-ingest-identity` | StorageV2, Standard LRS, TLS 1.2, no public blob access. The identity has **Storage Blob Data Reader** on the account |
| AI agent | Microsoft Foundry account `pcpro-oai-<unique>` (`S0`) with the model deployment `openAiDeploymentName` | `gpt-5-mini` version `2025-08-07`, `GlobalStandard`, 10,000 tokens per minute, no automatic version upgrade |
| Fabric plane | Managed identity `pcpro-fabricplane-identity`; deployment script `pcpro-onegrid-provision-fabric`; optional Fabric capacity `pcpro<unique>fab` | The script runs for up to 3 hours. The capacity is created only with `createFabricCapacity` |
| Web app | App Service plan `pcpro-onegrid-app-<unique>-plan` (Linux) and web app `pcpro-onegrid-app-<unique>`; deployment script `pcpro-onegrid-provision-app`; container `onegrid-app-package` | Node 22 LTS, HTTPS only, TLS 1.2, Always On, WebSockets, FTPS off. The script runs for up to 2 hours |
| Aurora weather model | Azure Machine Learning workspace `pcpro-aml-<suffix>` with storage `pcproaml<unique>`, Key Vault `pcpro-kv-<run>`, Application Insights `pcpro-ai-<suffix>`; online endpoint `aurora-<suffix>` | The `aurora` deployment, one instance of `auroraInstanceType`, deploys only with a model asset. The storage name uses the first 12 characters of `<unique>` |
| Forecast job | Container Apps job `pcpro-aurora-job-<suffix>` in environment `pcpro-cae-<suffix>`; Log Analytics `pcpro-logs-<suffix>`; identity `pcpro-aurora-job-identity`; registry `pcproacr<suffix>`; deployment script `pcpro-aurora-image-build`; container `aurora-channel` | 2 vCPU and 4 GiB per run, one-hour timeout, one retry. Basic registry; no registry or image build when you supply `auroraJobImage`. Log Analytics keeps 30 days |
| Deployment-script storage | Storage account `pcpro<unique>scr` | Only with `exemptStorageFromPolicy`, when a deployment script runs. Otherwise the deployment-scripts service creates and removes its own storage |

### Role assignments

| Identity | Role | Scope | Created when |
| --- | --- | --- | --- |
| `pcpro-ingest-identity` | Storage Blob Data Reader | Sample storage account | Sample storage |
| `pcpro-fabricplane-identity` | Storage Blob Data Reader | Sample storage account | Fabric plane |
| `pcpro-fabricplane-identity` | User Access Administrator | Sample storage account | `createFabricConnection` without `fabricConnectionId` |
| `pcpro-fabricplane-identity` | Storage Blob Data Contributor, and Owner | Sample storage account, and the resource group | Web app |
| `pcpro-fabricplane-identity` | Microsoft Graph `Application.ReadWrite.OwnedBy` | Tenant | `grantProvisionerGraphPermission` |
| Web app identity | Storage Blob Data Contributor | Sample storage account | Web app |
| Web app identity | GeoCatalog Administrator | GeoCatalog | Web app and GeoCatalog |
| Web app identity | Container Apps Jobs Operator | The forecast job only | Web app and forecast job |
| `pcpro-aurora-job-identity` | AcrPull and Contributor; Storage Blob Data Contributor; AzureML Data Scientist | Registry; sample storage account; Aurora workspace | Forecast job |
| Deploying principal | Cognitive Services OpenAI User | Microsoft Foundry account | AI agent |

The provisioner adds more grants at run time: **Cognitive Services User** and **Reader** on
the Microsoft Foundry account for the web app identity, and the Eventhouse, workspace, and
semantic model permissions in Fabric.

### Microsoft Fabric items

The Fabric-plane script creates the workspace `fabricWorkspaceName` on the capacity, with the
Lakehouse `lh_poc`, the Eventhouse `pi-realtime-eventhouse` and KQL database
`pi-realtime-db`, the notebooks, `Prediction_Pipeline`, the semantic models including
`OneGridModelImport`, the `OneGridOntology` item, and the data agent. With a storage
connection, it adds the OneLake shortcut `pcp_model_outputs` to the `model-outputs` container.

It doesn't create the Eventstream for live ingestion; see the
[known gap](../architecture/design-guide.md#known-gap-live-ingestion-eventstream).

### Microsoft Entra objects

With `grantProvisionerGraphPermission`, the provisioner creates a sign-in registration named
`<app-name>-signin` and a refresh service principal. They're directory objects, so deleting
the resource group doesn't delete them.

## After you deploy

Validate the deployment with the deployment validation script, the automated version of the
[acceptance checks](../deployment-and-data-guide.md#acceptance-checks). Pass the resource
group and the deployment name, and save the results as acceptance evidence:

```powershell
./planetary-computer-pro-poc/deploy/azure/scripts/Test-OneGridDeployment.ps1 `
  -ResourceGroupName onegrid-rg `
  -DeploymentName onegrid `
  -OutputPath ./onegrid-evidence.json
```

[`Test-OneGridDeployment.ps1`](../../planetary-computer-pro-poc/deploy/azure/scripts/Test-OneGridDeployment.ps1)
is in the template's `scripts` folder. It's read-only, tags each result with the acceptance
row it supports, and records components you didn't deploy as `N/A`, never as passed. Without
`-OutputPath`, it writes `onegrid-acceptance-<timestamp>.json` to the current folder. Checks
that need a person, such as a signed-in user journey or a grounded chat answer, are recorded
as `MANUAL`; complete them yourself.

## Next steps

- [Deploy from the Azure portal](deploy-portal.md)
- [Deploy from the command line](deploy-cli.md)
- [Estimate the cost](cost-estimate.md)
