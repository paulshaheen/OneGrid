---
title: OneGrid implementation and deployment reference
description: Map OneGrid logical architecture to ARM resource symbols, Fabric provisioning phases, application settings, and release artifacts.
ms.date: 11/23/2026
ms.topic: reference
---

# OneGrid implementation reference

Part of the [OneGrid landing zone design guide](architecture/design-guide.md).

[Solution overview](../README.md) | [Deploy OneGrid](deploy/README.md) |
[Deploy and configure OneGrid](deployment-and-data-guide.md)

The implementation has three coordinated layers: Azure resources declared in ARM/Bicep,
Fabric items and connections created through the provisioner, and the packaged application.
This reference maps the logical diagram to those artifacts.

## Repository entry points

| Artifact | Responsibility |
| --- | --- |
| [OneGrid landing zone design guide](architecture/design-guide.md) | Landing zone placement, design areas, reference implementation, deployment options, and naming |
| [Logical architecture](diagrams/onegrid-reference-baseline.png) | End-to-end data, geospatial, weather, AI, application, and control planes |
| [Editable diagrams (draw.io)](diagrams/onegrid-architecture.drawio) | Every architecture sheet as an editable page for customer adaptations |
| [Bicep source](../planetary-computer-pro-poc/deploy/azure/main.bicep) | Azure resource definitions, conditions, role assignments, outputs |
| [Compiled ARM](../planetary-computer-pro-poc/deploy/azure/azuredeploy.json) | Deployment payload |
| [Portal form](../planetary-computer-pro-poc/deploy/azure/createUiDefinition.json) | Component, model, app, capacity, and module choices |
| [Parameter files](../planetary-computer-pro-poc/deploy/azure/parameters/README.md) | Baseline, full, brownfield, and weather scenarios as ARM JSON and `.bicepparam` files |
| [Deploy OneGrid](deploy/README.md) | Deployment reading path, options, scenarios, prerequisites, portal and command-line procedures, troubleshooting, known issues, and cost |
| [Parameter reference](deploy/reference/parameters.md) and [generator](deploy/build_reference.py) | Every template parameter with its default, allowed values, and portal step, generated from `main.bicep` and the portal form; `--check` fails when the page is stale, and [`test_reference.py`](deploy/test_reference.py) validates the parameter files |
| [In-template wrapper](../planetary-computer-pro-poc/deploy/azure/scripts/onegrid-solution-provision.ps1) | Compose provisioner config from deployed resources and run selected phases |
| [Provisioner](../planetary-computer-pro-poc/infra/deploy.ps1) | Fabric items, data/model binding, identity/configuration, app wiring |
| [Configuration shape](../planetary-computer-pro-poc/infra/config.sample.json) | Environment and governance settings |
| [Fabric artifacts](../planetary-computer-pro-poc/infra/fabric/) | Eventstream definition (published separately), schemas, notebooks, pipeline, models, dashboards, ontology |
| [Application source](../OGE-OneGrid/) | BFF, SSR web app, Node AI agent |
| [Weather pipeline](../planetary-computer-pro-poc/aurora/) | Inputs, inference client, tracking, normalization, publication |
| [Operational connectors](../planetary-computer-pro-poc/infra/bolt-ons/data-plane/) | Durable source ingestion into Eventstream |
| [Manuals search extension](../planetary-computer-pro-poc/infra/bolt-ons/foundry-iq-manuals/) | Indexed equipment-manual grounding |
| [App release workflow](../.github/workflows/release-onegrid-app.yml) | Build and publish the unified app package |

## ARM resource inventory

The symbols below are the resource identifiers in the compiled ARM and Bicep sources.
Conditions select resources according to the chosen components and dependencies.

| Architecture area | Resource symbols | Purpose |
| --- | --- | --- |
| Geospatial | `geoCatalog` | Planetary Computer Pro STAC/tiles service |
| Ingestion identity | `ingestIdentity`, `blobReaderAssignment` | Container read access and catalog-associated identity |
| Shared workload storage | `sampleStorage`, `sampleBlobService` | Asset, application-package, and forecast containers |
| Storage containers | `sampleContainer`, `onegridAppPackageContainer`, `modelOutputsContainer`, `auroraChannelContainer` | `sample-assets`, `onegrid-app-package`, `model-outputs`, `aurora-channel` |
| Deployment helper storage | `scriptStorage` | Dedicated deployment-script storage when the configured policy-exception path is used |
| Fabric deployment identity | `fabricPlaneIdentity`, `fabricPlaneRgOwner` | Provisioning identity and resource-group deployment/role-assignment scope |
| Storage provisioning grants | `fabricPlaneBlobReaderRole`, `fabricPlaneStorageUaaRole`, `fabricPlaneBlobContributorRole` | Read storage, create workspace-identity grants, upload the app package |
| Directory permissions | `graphServicePrincipal`, `provisionerGraphRole` | Optional Graph application permission for identity creation |
| Fabric capacity | `fabricCapacity` | New F-SKU capacity when selected |
| Application host | `chatAgentPlan`, `chatAgentSite` | Linux App Service plan/site and system-assigned identity |
| App data-plane grants | `chatAgentStorageContributor`, `chatAgentGeoCatalogAdmin`, `chatAgentAuroraJobOperator` | Storage/catalog operations and job-scoped forecast start/stop |
| Provisioning | `appProvisionScript`, `fabricPlaneScript` | Independent app and Fabric configuration paths |
| AI inference | `openAi`, `openAiDeployment`, `openAiDeployerRole` | Microsoft Foundry account/model and interactive deployer access |
| Aurora support | `amlStorage`, `amlKeyVault`, `amlApplicationInsights` | Workspace backing storage, secrets infrastructure, telemetry |
| Aurora compute | `amlWorkspace`, `auroraEndpoint`, `auroraDeployment` | Managed workspace, Entra-token endpoint, optional GPU model deployment |
| Job telemetry/runtime | `logAnalytics`, `containerAppsEnv`, `auroraJobIdentity` | Log destination, job environment, user-assigned identity |
| Pipeline image | `auroraAcr`, `auroraJobAcrPull`, `auroraJobAcrContributor`, `auroraImageBuild` | Registry, pull/build access, deployment-time image build |
| Job data/model grants | `auroraJobBlobRole`, `auroraJobMlRole` | Output/channel writes and Azure ML inference |
| Forecast trigger | `auroraJob` | Scheduled client, UTC cron, container resources, retry/timeout, environment |

## Fabric provisioning phases

| Phase | Main result |
| --- | --- |
| `workspace` | Resolve/create workspace, assign capacity, apply workspace administration |
| `core` | Lakehouse/SQL endpoint, Eventhouse/KQL database, schema and seed operations |
| `fabricplane` | Model-output storage connection/shortcut and hazard spatial KQL |
| `artifacts` | Deploy/rebind notebooks, prediction pipeline, KQL dashboards |
| `data` | Load selected historical data and prepare seeded/generated content |
| `semantic` | Base Import semantic model/report and connection setup |
| `oge` | Additional semantic model and `OneGridOntology` Digital Twin Builder item |
| `unified` | HURDAT reference, `og.*` generator, SQL metadata sync, `OneGridModelImport` binding/refresh |
| `governance` | Configured OneLake data roles and access-review manifest |
| `foundry` | Reuse the template's Microsoft Foundry deployment or provision the configured model account |
| `dataagent` | Configure/publish the Fabric Data Agent |
| `chatagent` | Package mounting, runtime settings, sign-in, dependency configuration |
| `permissions` | App Eventhouse and Power BI permissions |
| `dataplane` | Connector integration/configuration, selected separately; resolves the endpoint of an existing `pi-events-stream` Eventstream, which no phase creates |

The phase runner preserves its declared order even when a subset is selected. The ARM wrapper
adds `unified` when requested. It initializes governance disabled; approved governance
settings are applied through provisioner configuration.

## Application configuration contract

| Settings | Connects |
| --- | --- |
| `PBI_WORKSPACE`, `PBI_DATASET` | Workspace and Import model used by DAX queries |
| `KUSTO_CLUSTER`, `KUSTO_DATABASE` | Eventhouse query service and KQL database |
| `AZURE_AI_ENDPOINT`, `AI_DEFAULT_MODEL` | Node AI agent's configured model endpoint/deployment |
| `FOUNDRY_ENDPOINT`, `FOUNDRY_DEPLOYMENT` | Web application model integration |
| `DATA_AGENT_WORKSPACE`, `DATA_AGENT_ID` | Published Fabric Data Agent |
| `GEOCATALOG_URI` | GeoCatalog STAC and tile integration |
| `ENTRA_CLIENT_ID`, `ENTRA_TENANT_ID` | Application sign-in |
| `WEBSITE_RUN_FROM_PACKAGE` | Application package location |
| `REPORT_PORT`, `WEBSITES_PORT` | App Service port configuration, both 8080 |
| `REPORT_API_URL` | SSR-to-BFF loopback, `http://127.0.0.1:8080` |
| `ONEGRID_MODULES` | Enabled application modules |

Resolve values from the actual deployment, not another environment's IDs. Verify the unified
model remains the app target after data/model updates.

## Storage and weather contracts

| Artifact/configuration | Producer | Consumer |
| --- | --- | --- |
| `sample-assets` | Asset upload/customer ingestion process | GeoCatalog ingestion and app asset workflows |
| `onegrid-app-package/onegrid-app.zip` | App provisioner | App Service package mount |
| `aurora-channel` | Forecast client and endpoint transfer path | Aurora inference |
| `model-outputs/weather-events.json` | Forecast job | Application weather adapter |
| `pcp_model_outputs` | Fabric storage-connection/shortcut configuration | Lakehouse consumers |
| `INITIAL_CONDITION_SOURCE=gfs` | ARM job configuration | NOAA GFS input adapter |
| `AURORA_NUM_STEPS=20` | ARM job configuration | Aurora rollout |
| `OUTPUT_BLOB_NAME=weather-events.json` | ARM job configuration | Forecast publication |

The scheduled job uses `AZURE_CLIENT_ID`, `AURORA_ENDPOINT`, blob account/container settings,
and output-container configuration supplied by ARM.

## Build, promote, and restore

The release workflow runs on matching `OGE-OneGrid/**` or workflow changes on `main`, or
manual dispatch. It builds the SSR app, includes the BFF/chat/runtime dependencies, excludes
resolved local target files, and publishes `onegrid-app.zip` under `app-latest`.

The provisioner downloads the source package, uploads it to environment storage, verifies
the upload, and configures managed-identity mounting. Record which package and configuration
the host actually uses. Retain immutable known-good artifacts for promotion/rollback;
publishing a source release alone does not establish a running tenant's version.

Keep Bicep, compiled ARM, and portal choices synchronized when changing infrastructure, and
regenerate the [parameter reference](deploy/reference/parameters.md) with
`python docs/deploy/build_reference.py`.
Validate application, schema/model, bindings, permissions, and source compatibility as one
release. Use the [operations procedures](operations-runbook.md) for rollback and recovery.
