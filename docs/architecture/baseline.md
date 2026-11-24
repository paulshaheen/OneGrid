---
title: Baseline architecture for OneGrid asset and weather intelligence
description: Design and deploy OneGrid with Microsoft Fabric, geospatial services, Aurora weather inference, Azure OpenAI, and Azure App Service.
ms.date: 11/23/2026
ms.topic: conceptual
---

# Baseline architecture for OneGrid

[Solution overview](../../README.md)

The OneGrid baseline connects real-time operations, historical asset analytics, geospatial
data, weather forecasts, and AI in one regional workload. The application presents equipment
health and weather exposure using a common asset model, so maintenance and storm-response
decisions refer to the same sites, units, equipment, and sensors.

## Architecture

[![OneGrid end-to-end logical architecture showing the Fabric, geospatial, weather, AI, application, and deployment planes.](../onegrid-logical-architecture.png)](../onegrid-logical-architecture.png)

### Workflow

The solution has three processing paths that meet in the application:

1. **Real-time path:** operational source -> connector -> Eventstream custom endpoint ->
   `PiEventsRaw` -> update policy -> `PiEvents` -> KQL -> application.
2. **Historical and predictive path:** asset/maintenance/history -> OneLake/Lakehouse ->
   preparation and scoring notebooks -> reliability/weather tables -> Import semantic
   model -> DAX -> application.
3. **Geospatial and forecast path:** imagery -> GeoCatalog -> map layers; NOAA GFS ->
   scheduled job -> Aurora endpoint -> normalized events in Blob Storage -> weather adapter
   -> application. A OneLake shortcut connects model-output storage to Fabric when configured.

User authentication is separate from these data paths. A user signs in with Entra ID, and
the application uses its workload identities to query its configured dependencies.

### Components

| Plane | Component | Role |
| --- | --- | --- |
| Data | Fabric capacity/workspace | Compute allocation and item/permission boundary |
| Data | Eventstream | Custom endpoint `PIForwarderEndpoint` for canonical source events |
| Data | Eventhouse/KQL database | Streaming landing/curation, operational queries, outages, spatial hazard functions |
| Data | OneLake/Lakehouse | Curated source data, conformed `og.*` Delta tables, and model inputs |
| Analytics | Fabric notebooks | Source preparation, features, anomaly detection, stop risk, survival, scoring, narrative |
| Analytics | `Prediction_Pipeline` | Orchestrates the supplied prediction workflow |
| Business model | `OneGridModelImport` | Materializes the unified Lakehouse tables for application DAX queries |
| Context | `OneGridOntology` Digital Twin Builder item | Plants, units, assets, sensors, work, advisories, outages, predictions |
| AI access | Fabric Data Agent | Natural-language access to configured business/operational data |
| Geospatial | GeoCatalog and ingestion identity | STAC ingestion/search, tiles, and spatial layers |
| Weather | Container Apps Job and registry | Forecast trigger, orchestration, and pipeline image |
| Weather | Azure ML workspace/online endpoint | Managed Aurora GPU inference |
| AI | Azure OpenAI model deployment | Reasoning and tool-assisted answer generation |
| Application | App Service, report-app, React SSR, Node AI agent | Unified UI, REST/WebSocket, dependency orchestration |
| Identity | Entra ID and managed identities | User sign-in and scoped workload access |
| Management | ARM, deployment scripts, PowerShell, GitHub package | Resource/item provisioning and application distribution |

#### Fabric data and analytics

The supplied source-processing notebooks cover PI, AIMM, iCare, GADS, and intake data.
Feature selection and engineering feed predictive modeling and batch scoring. SmartSignal
notebooks provide anomaly workflows; Cox and survival notebooks support long-term
reliability. Daily narrative and real-time report notebooks expose results for operators.

The unified notebook creates the shared hierarchy:

```text
dim_site
  -> dim_unit
     -> dim_asset
        -> dim_tag
```

Reliability tables include `aakr_health`, `watchlist`, `anomaly_advisories`, `root_cause`,
`predictions_shortterm`, and `predictions_longterm`. Work and weather attach through
`fact_work_requests`, `dim_weather_event`, `WeatherForecast`, `fact_asset_exposure`, and
`fact_posture`. Preserve the exact `WeatherForecast` case in SQL/model source navigation.

`OneGridModelImport` reads the Lakehouse SQL analytics endpoint. A dedicated service
principal binds and refreshes the Import connection. The app identity queries the refreshed
model and independently queries Eventhouse. Plan refresh after source updates.

#### Geospatial plane

The sample storage account contains `sample-assets`. The ingestion identity has
Storage Blob Data Reader on the source storage account and is associated with GeoCatalog. The app
identity has the catalog and blob permissions needed for browsing, ingestion orchestration,
and asset uploads.

Keep raster/STAC ingestion distinct from an asset register. CSV/GeoJSON describes customer
infrastructure; COG/STAC describes imagery. GeoCatalog serves map imagery, while the
conformed asset hierarchy supplies the business joins.

#### Weather and Aurora plane

The Container Apps Job runs the forecast client with 2 vCPU and 4 GiB. It obtains NOAA GFS
initial conditions, detects cyclone seeds, invokes Aurora through the online endpoint,
tracks the rollout, normalizes events, and writes `weather-events.json`.

The transfer channel uses the `aurora-channel` container for large model payloads.
`model-outputs` holds published forecast artifacts. The job's managed identity acquires
tokens and creates the short-lived delegation credentials needed by the blob channel.

The default UTC cron is `0 1,7,13,19 * * *`. One job replica runs per trigger; its timeout
is 3,600 seconds and its retry limit is one. The app can start the same job on demand through
job-scoped Container Apps Jobs Operator permission.

#### AI and application plane

The application hosts the Node AI agent and its data tools. Azure OpenAI provides model
inference; the configured Fabric Data Agent provides an additional grounded data mode.
Manual retrieval uses the bundled equipment corpus or the configured indexed-manuals
integration.

App Service runs Node 22 on Linux with HTTPS, TLS 1.2 minimum, FTPS disabled, Always On,
and WebSockets. The application binds port 8080. The report BFF, SSR web application,
and AI agent are distributed in one package rather than as independently deployed sites.

### Model and deployment selection

| Selection | Configuration |
| --- | --- |
| Business/operational AI | ARM model default `gpt-5-mini`, version `2025-08-07`, `GlobalStandard`, capacity 10 |
| Aurora inference | `Standard_NC24ads_A100_v4`; model asset supplied explicitly or selected with `createAuroraModelDeployment` |
| Geospatial | GeoCatalog `Basic`; customer-source containers and managed-identity ingestion |
| App plan | `chatAgentAppServiceSku`, default `B1`; select capacity/features for the environment |
| Fabric | Existing capacity ID or `createFabricCapacity`; creation SKU defaults to `F2` |
| Data seeding | `deployOneGridData` selects the historical bundle; `deployUnifiedModel` selects unified tables/model |
| Forecast scheduling | `deployAuroraSchedule`, `auroraJobCron`, image/registry settings |

Creating the Aurora workspace/endpoint and deploying its GPU model are separate steps.
Allocate quota and accept model terms before inference validation. Choose model processing
geography and version according to data requirements.

## Deployment architecture

The [ARM template](../../planetary-computer-pro-poc/deploy/azure/azuredeploy.json) provisions
Azure resources. Two deployment scripts then invoke the
[PowerShell provisioner](../../planetary-computer-pro-poc/infra/deploy.ps1):

- **App plane:** configures model access, package delivery, app settings, geospatial access,
  sign-in, and weather connections.
- **Fabric plane:** provisions workspace/items, applies data definitions, loads selected
  data, binds models, configures the Data Agent, and writes app query targets and permissions.

The scripts share deployed resource settings, but Fabric-specific state is applied by the
Fabric path. Their separate logs make application wiring and data-plane failures observable
independently.

The provisioner's phase order is:

```text
workspace -> core -> fabricplane -> artifacts -> data -> semantic -> oge -> unified
          -> governance -> foundry -> dataagent -> chatagent -> permissions
```

Selection determines which phases execute. Governance configuration controls OneLake role
provisioning. Operational connectors are enabled through the separate `dataplane` phase.

## Considerations

### Reliability

Track application availability separately from data/model freshness. Set targets for
Eventstream delivery, Import refresh, DAX/KQL, AI answers, and forecast publication.
Retain source data, package versions, item definitions, model connections, and ingestion
checkpoints for restoration. Use [multiregion guidance](multiregion.md) when recovery
objectives require a second region.

### Security

Use distinct deployment, application, ingestion, refresh, workspace-connection, and
forecast-job identities. Apply minimum Azure and Fabric permissions, protect the refresh
credential, and verify data filtering through actual query identities. Keep storage containers
nonanonymous; configure network access separately from blob authorization.

### Cost Optimization

Attribute Fabric, App Service, model tokens, GPU, registry, storage, and diagnostics costs
to the workload. Match historical seeding, forecast cadence, and model capacity to the use
case. Measure shared-capacity contention before scaling.

### Operational Excellence

Treat application package, configuration, Fabric schema/model, identities, and model version
as one release record. Validate pipeline results, not just resource creation. Keep known-good
packages and tested restore procedures.

### Performance Efficiency

Use the real-time KQL lane for operational observations and the semantic model for curated
business measures. Test expected concurrency, refresh overlap, query latency, forecast cycle
duration, and token throttling. Scale the orchestrator and GPU independently.

## Deploy this scenario

Follow [Deploy and configure OneGrid](../deployment-and-data-guide.md). Verify the selected
resource outputs, application sign-in, semantic connection/refresh, DAX/KQL, chat, GeoCatalog,
and weather publication. Record which datasets originate from customer feeds versus
seeded/generated data.

## Next steps

- [Integrate with the enterprise landing zone](enterprise-landing-zone.md).
- [Configure Fabric ingestion, models, and governance](fabric.md).
- [Apply regulated workload controls](regulated-workload.md).
- [Establish Day 2 operations](../operations.md).
