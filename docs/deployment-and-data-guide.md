---
title: Deploy and configure OneGrid
description: Deploy OneGrid Azure resources and Fabric items, configure identities and models, load assets and imagery, and verify operational and weather intelligence.
ms.date: 11/23/2026
ms.topic: how-to
---

# Deploy and configure OneGrid

Part of the [OneGrid landing zone design guide](architecture/design-guide.md).

[Solution overview](../README.md) | [Implementation reference](implementations.md)

Deploy OneGrid into the selected subscription and Fabric tenant, then configure its sources,
models, sign-in, and operational schedules. The deployment has two parts: ARM creates the
Azure resources; deployment scripts run the Fabric/application provisioner.

## Prerequisites

| Area | Requirement |
| --- | --- |
| Azure | Subscription/resource group access to create the selected resources and role assignments |
| Region | One of `eastus`, `northcentralus`, `westeurope`, `canadacentral`, `uksouth`; validate every selected service/SKU and quota |
| Providers | Register the providers used by selected components, including Orbital, Storage, ManagedIdentity, Web, CognitiveServices, Resources, ContainerInstance, and Fabric |
| Fabric | Approved tenant settings for provisioning identities; rights to use the capacity and administer the workspace |
| Sign-in | Existing SPA app registration with `https://<app-host>/auth/callback`, or approved directory permission for creation |
| Import refresh | Existing refresh service principal and secret, or approved Graph permission for creation |
| Aurora | Model asset, accepted model terms, A100 quota, Azure ML/Key Vault/Insights providers |
| Forecast job | Aurora and storage, Container Apps/registry/log providers, permitted source and image access |
| Enterprise environment | Approved network, DNS, policy, identity, diagnostics, cost, and recovery configuration |

Fabric/Entra permissions are separate from Azure RBAC. Establish them before starting the
cross-plane deployment. The guided [Copilot runbook](../DEPLOY-WITH-COPILOT.md) provides
permission, provider, quota, approval, and progress-check commands.

## Choose components

The compiled ARM defaults and a full-solution selection differ. Set component choices
explicitly for command-line deployments.

| Parameter | ARM default | Full-solution use |
| --- | --- | --- |
| `deploySampleStorage` | `true` | Asset, package, output, and transfer containers |
| `deployFabricPlane` | `false` | Set `true` for the Fabric workspace/data plane |
| `deployOneGridApp` | `false` | Set `true` for the unified application |
| `deployAiAgent` | `true` | Declare the Microsoft Foundry account and model deployment that the app reuses |
| `deployGeoCatalog` | `true` | Include STAC, imagery, and catalog-backed asset workflows |
| `createFabricCapacity` | `false` | Set `true` to create capacity, otherwise supply `fabricCapacityId` |
| `fabricCapacitySku` | `F2` | Size a new capacity for expected load |
| `createFabricConnection` | `false` | Set `true` for workspace-identity connection/shortcut creation, or supply `fabricConnectionId` |
| `deployOneGridData` | `false` | Seed the historical data bundle when required |
| `deployUnifiedModel` | `true` | Generate shared `og.*` tables and bind/refresh `OneGridModelImport` |
| `deployAuroraModel` | `false` | Include Azure ML workspace and online endpoint |
| `createAuroraModelDeployment` | `false` | Deploy the published model, or supply `auroraModelAssetId` |
| `deployAuroraSchedule` | `false` | Include forecast orchestration and scheduled publication |
| `enableEntraSignIn` | `true` | Configure sign-in using an existing or newly created registration |

The full app requires the Fabric plane and sample storage. The forecast job requires Aurora
and sample storage. The model deployment also requires quota and accepted terms. Review
outputs and provisioning results for the selected combination.

Use `oneGridModules` to select `exec`, `weather`, `twin`, `infra`, `sap`, `esu`, `onerig`,
and `copilot`. An empty list keeps core pages only.

## Configure identity and environment

1. Select the target subscription, region, resource group, workspace, and capacity.
2. Configure `entraSignInClientId` for a pre-created sign-in registration, or approve
   creation through the provisioner.
3. Configure `refreshServicePrincipalClientId`, `refreshServicePrincipalObjectId`, and
   secure `refreshServicePrincipalSecret`, or approve
   `grantProvisionerGraphPermission` for identity creation.
4. Keep secret-bearing parameter/configuration files outside source control. Use the
   approved secret-provider integration and avoid printing resolved parameter values.
5. Keep `exemptStorageFromPolicy=false` unless the platform owner has approved a scoped,
   documented policy exception. Validate deployment-script storage access against policy.
6. Select a package/version and `oneGridRef` appropriate for the release.

For customer governance, configure the provisioner's `governance` block separately: group
IDs, inventory/demo mode, role creation choices, and app permissions. The ARM wrapper
initializes governance disabled.

### Establish enterprise network prerequisites

For an enterprise environment, approve the
[traffic-flow matrix](architecture/enterprise-landing-zone.md#traffic-flow-matrix)
before restricting endpoints. Prepare gateway/private-endpoint/integration subnets,
connected deployment runners, private DNS, and the required bootstrap and runtime rules.

Use tenant-level Fabric Private Link for the combined OneGrid workspace and retain the
Eventstream artifact's `ProcessedIngestion` mode. Plan the forecast job's VNet-integrated
workload profiles environment at creation time when controlled egress is required.
Select Premium rather than the auto-created Basic registry for a private registry path.

Apply these enterprise changes through reviewed platform/workload IaC. Validate private
paths, package bootstrap, queries, source access, and image delivery before disabling
the corresponding public paths. Record results with the
[network acceptance procedure](operations-runbook.md#validate-network-and-traffic-flows).

## Deploy resources and provision the solution

Use the portal button in the [solution overview](../README.md#deploy-this-solution), or
prepare a complete ARM parameter file outside the repository. Include selected components,
capacity, sign-in, refresh identity, and any weather choices. The design guide compares all
[deployment options](architecture/design-guide.md#deployment-options), including the GitHub
Copilot runbook and the deploy wizard.

The following PowerShell sequence validates and deploys a prepared parameter file:

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

Approve resource and cost changes before running the deployment. Ensure `$location` matches
the parameter file. The full deployment commonly takes 30-90 minutes; data seeding,
Fabric readiness, and optional model/image work can extend the duration.

The template's app and Fabric scripts invoke selected provisioner phases in the defined
phase order. The wrapper composes configuration from the deployed resources, including
storage, model endpoint, catalog URI, workspace/capacity, and refresh identity.

### Monitor provisioning

```powershell
az deployment group show --resource-group $resourceGroup --name onegrid --query properties.provisioningState -o tsv
az deployment-scripts show-log --resource-group $resourceGroup --name pcpro-onegrid-provision-app
az deployment-scripts show-log --resource-group $resourceGroup --name pcpro-onegrid-provision-fabric
az deployment group show --resource-group $resourceGroup --name onegrid --query properties.outputs -o json
```

Restrict deployment-log access and redact sensitive material before sharing. Investigate
app and Fabric results independently. Record skipped components, phase errors, IDs, and
connection/refresh outcomes.

### Application delivery

The release workflow builds `onegrid-app.zip` with report BFF, React SSR, Node agent, and
runtime dependencies. Provisioning rehosts the verified package in
`onegrid-app-package/onegrid-app.zip`; App Service mounts it through
`WEBSITE_RUN_FROM_PACKAGE` and managed identity. The startup command is
`node report-app/server/index.js`, and the host uses port 8080.

Deploy this unified package rather than publishing only the web UI. Record the package
source/version and actual runtime settings as part of acceptance.

## Load and connect data

### Asset register

Use CSV for points and GeoJSON for points/lines/polygons. Coordinates use WGS 84
(EPSG:4326); GeoJSON arrays use `[longitude, latitude]`.

| Field | Purpose |
| --- | --- |
| `id`, `name`, `type` | Stable asset identity, display name, supported category |
| `latitude`, `longitude` | Point coordinates |
| `geometry` | GeoJSON geometry for line/polygon assets |
| `operator`, `region`, `business_unit` | Ownership and organizational context |
| `operating_status`, `criticality` | Current posture and risk-weighting context |
| `metadata` | Additional equipment attributes supported by the workflow |

Start with the [sample CSV](../planetary-computer-pro-poc/samples/sample-assets.csv) or
[sample GeoJSON](../planetary-computer-pro-poc/samples/sample-assets.geojson).

```csv
id,name,type,latitude,longitude,operator,region,operating_status,criticality
PLT-D7,Platform Delta-7,offshore_platform,27.62,-90.35,Meridian Energy,Central Gulf,producing,business_critical
```

Use Asset Management with catalog/storage integration configured. Verify accepted/rejected
rows, coordinates, duplicates, and resulting counts. Asset-register ingestion is distinct
from the conformed Fabric generation/loading path; validate how customer assets enter the
intended analytical products.

### Imagery and rasters

1. Upload Cloud-Optimized GeoTIFF assets to `sample-assets` or an approved source.
2. Register the source with the catalog-associated ingestion managed identity.
3. Submit STAC Items with spatial/temporal metadata and source references.
4. Verify ingestion status, STAC search, render/mosaic configuration, and tiles.

Public sample imagery can be read from its source with temporary source credentials.
It is a separate path from customer imagery and from weather outputs.

### Telemetry and business history

The deployment creates the Eventhouse and KQL database and, when historical seeding is
selected, loads `PiEvents` from the bundled data; it doesn't create an Eventstream. For live
telemetry, publish or rebind the supplied
[`pi-events-stream` definition](../planetary-computer-pro-poc/infra/fabric/eventstream/pi-events-stream/)
in the target workspace yourself; see the
[known gap](architecture/design-guide.md#known-gap-live-ingestion-eventstream). Connect its
destination to the intended Eventhouse database and `PiEventsRaw` mapping, then confirm the
`PIForwarderEndpoint` source connection before starting producers.

Use the [operational connectors](../planetary-computer-pro-poc/infra/bolt-ons/data-plane/)
for PI/relational source ingestion. Validate canonical event fields, source quality,
durable buffering, watermark/acknowledgment behavior, and heartbeat monitoring.

Load maintenance, asset, and historical data through the approved ingestion workflow.
Run preparation/scoring, validate conformed keys and counts, synchronize the SQL endpoint,
then refresh the Import model. Keep generated and observed data distinguishable.

### Weather

Enable the Aurora model and forecast job, confirm GPU inference, and verify model-output
publication. The scheduled job uses NOAA GFS inputs, 20 rollout steps, and the default
UTC schedule `0 1,7,13,19 * * *`. Check both successful processing with storms and a valid
empty event result when none are detected.

## Acceptance checks

| Check | Expected evidence |
| --- | --- |
| Provisioning | ARM state and app/Fabric phase results; selected resource IDs |
| App | `/api/health`, `/api/status`, and `/webapp/app` respond appropriately |
| Sign-in | Authorized user journey succeeds; protected-data requests without permission are denied |
| Fabric target | Correct workspace, `OneGridModelImport`, KQL endpoint/database, and runtime identity |
| Semantic model | Bound SQL connection, completed refresh, expected counts and source timestamps |
| Telemetry | Expected `PiEvents`/outage rows, latest event time, and source heartbeat |
| Asset context | Site/asset joins, watchlist, twin, and weather exposure use intended data |
| Geospatial | Authorized upload/ingestion, STAC search, and tile retrieval |
| AI | Configured model responds with grounded data/tool results and authorized manual context |
| Weather | Successful inference/job, valid output schema, input cycle, publication time, and map events |
| Governance | Positive/negative data access through actual API, DAX/KQL, chat, SQL, and export paths |
| Operations | Alerts, refresh/job schedules, identity ownership, costs, and recovery responsibilities |

Record disabled components as not applicable rather than passed. Preserve results with
deployment ID, source/package/model versions, data mode, and time.

## Manage and remove an environment

Use the [operations guide](operations.md) for maintenance and
[runbook](operations-runbook.md) for incident, rollback, restore, and decommissioning.
Resource-group deletion and Fabric/directory cleanup are separate lifecycle operations.
Confirm retention and shared-resource ownership before removing data, capacities, identities,
connections, or registrations.
