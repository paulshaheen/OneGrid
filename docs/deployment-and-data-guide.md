---
title: Deploy and configure OneGrid
description: Configure a deployed OneGrid environment, load asset registers, imagery, telemetry, history, and weather, and verify the result with the acceptance checks.
ms.date: 11/24/2026
ms.topic: how-to
---

# Deploy and configure OneGrid

Part of the [OneGrid landing zone design guide](architecture/design-guide.md).

[Solution overview](../README.md) | [Deploy OneGrid](deploy/README.md) |
[Implementation reference](implementations.md)

Deploy OneGrid into the selected subscription and Fabric tenant, then configure its sources,
models, sign-in, and operational schedules. The deployment has two parts: ARM creates the
Azure resources; deployment scripts run the Fabric/application provisioner.

The deployment procedure is in [Deploy OneGrid](deploy/README.md). This article covers what
follows it: configuring governance, loading and connecting data, and accepting the
environment.

## Prerequisites

The [getting started checklists](deploy/getting-started.md#prerequisites) list the Azure,
region, resource provider, Microsoft Fabric, Microsoft Entra, Aurora, and storage policy
requirements. Fabric and Entra permissions are separate from Azure RBAC, so establish them
before you start the cross-plane deployment, and
[validate the prerequisites](deploy/getting-started.md#validate-prerequisites) with
`Test-OneGridPrerequisites.ps1`.

## Choose components

[Choose components](deploy/getting-started.md#choose-components) lists each component, its
parameter, and its dependencies. The compiled ARM defaults and the portal's default selection
differ, so set component choices explicitly for command-line deployments; the
[parameter reference](deploy/reference/parameters.md#portal-defaults-that-differ-from-the-template)
lists the differences, and the
[parameter files](../planetary-computer-pro-poc/deploy/azure/parameters/README.md) set every
switch.

## Configure identity and environment

Plan the sign-in registration, the Import refresh identity, the storage policy exemption, and
the network model with [Get started](deploy/getting-started.md#plan-the-deployment). Keep
secret-bearing parameter and configuration files outside source control, pass the refresh
secret from Azure Key Vault, and avoid printing resolved parameter values. Select a package
version and `oneGridRef` appropriate for the release; see
[mutable source defaults](deploy/known-issues.md#mutable-source-defaults).

For customer governance, configure the provisioner's `governance` block separately: group
IDs, inventory/demo mode, role creation choices, and app permissions. The ARM wrapper
initializes governance disabled.

### Establish enterprise network prerequisites

The enterprise network prerequisites are in
[Choose the network model](deploy/getting-started.md#choose-the-network-model). Approve the
[traffic-flow matrix](architecture/enterprise-landing-zone.md#traffic-flow-matrix) before
restricting endpoints, apply the changes through reviewed platform and workload IaC, and
record the results with the
[network acceptance procedure](operations-runbook.md#validate-network-and-traffic-flows).

## Deploy resources and provision the solution

Deploy with the [Azure portal](deploy/deploy-portal.md), the
[Azure CLI or Azure PowerShell](deploy/deploy-cli.md), the
[Copilot runbook](../DEPLOY-WITH-COPILOT.md), or the
[deploy wizard](../planetary-computer-pro-poc/infra/deploy-ui/README.md).
[Deploy OneGrid](deploy/README.md#deployment-options) compares them. The command-line guide
covers validation, what-if, monitoring, the deployment-script logs, outputs, redeployment,
and teardown; [Troubleshooting](deploy/troubleshooting.md) lists the failures by phase.

The template's app and Fabric scripts invoke selected provisioner phases in the defined
phase order. The wrapper composes configuration from the deployed resources, including
storage, model endpoint, catalog URI, workspace/capacity, and refresh identity.

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

[`Test-OneGridDeployment.ps1`](../planetary-computer-pro-poc/deploy/azure/scripts/Test-OneGridDeployment.ps1)
automates this table. Run it with the resource group and deployment name, and keep its JSON
evidence file:

```powershell
./planetary-computer-pro-poc/deploy/azure/scripts/Test-OneGridDeployment.ps1 -ResourceGroupName <rg> -DeploymentName <name> -OutputPath ./onegrid-evidence.json
```

The script tags each result with the row it supports, records disabled components as `N/A`,
and records the parts of a row that need a person, such as an authorized user journey or a
grounded chat answer, as `MANUAL`. Complete those checks yourself.

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
Resource-group deletion and Fabric/directory cleanup are separate lifecycle operations;
[Tear down](deploy/deploy-cli.md#tear-down) lists the objects that remain after the resource
group is deleted.
Confirm retention and shared-resource ownership before removing data, capacities, identities,
connections, or registrations.
