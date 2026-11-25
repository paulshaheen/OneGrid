# OneGrid asset and weather intelligence accelerator

OneGrid brings operational telemetry, asset and maintenance records, geospatial information,
weather forecasts, and AI into one asset-intelligence application for energy and oil and gas
teams. Operations, engineering, and executive users work from the same asset context to
investigate equipment health, prioritize maintenance, assess storm exposure, and coordinate
response. This accelerator deploys the solution into your Azure subscription and Microsoft
Fabric tenant: Microsoft Fabric for real-time and historical analytics, Microsoft Planetary
Computer Pro for geospatial services, Microsoft Foundry for AI-assisted analysis, Aurora on
Azure Machine Learning for weather inference, and a unified web app on Azure App Service.

> [!TIP]
> Planning an enterprise deployment? Start with the
> [OneGrid landing zone design guide](docs/architecture/design-guide.md). It places OneGrid
> in an Azure landing zone, lists the design areas and principles, and walks through the
> reference implementation.

## Architecture

<a href="docs/diagrams/onegrid-reference-baseline.svg"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/onegrid-reference-baseline-dark.png"><img alt="OneGrid logical architecture. Data sources flow through ingest, store, process, and serve stages in Microsoft Fabric (Eventhouse, Lakehouse, notebooks, ontology, semantic model, data agent) and Azure (Blob Storage, Aurora on Azure Machine Learning, GeoCatalog) to the OneGrid web app, whose AI agent calls Microsoft Foundry. Dashed outlines mark optional add-ons: Eventstream live ingestion, Azure AI Search for equipment manuals, and Teams through Azure Bot. Numbered steps 1 to 8 follow the workflow, with a platform row below." src="docs/diagrams/onegrid-reference-baseline.png"></picture></a>

[Download SVG](docs/diagrams/onegrid-reference-baseline.svg) |
[Download the draw.io file](docs/diagrams/onegrid-architecture.drawio) |
[All 12 sheets, light and dark](docs/diagrams/onegrid-reference-gallery.html) |
[Diagram guide](docs/diagrams/README.md) |
[Routing, identity, security, and monitoring](docs/architecture/traffic-and-security.md)

This is the logical view. Sources move through ingest, store, process, and serve stages in
Microsoft Fabric and Azure to the OneGrid web app; numbered steps match the
[Workflow](#workflow). Dashed outlines are optional add-ons. Ports, roles, subnets, and
recovery detail are on the [technical sheets](#architecture-sheets). Enterprise additions
and illustrative IP allocations are labeled separately from the baseline IaC.

### Workflow

1. **Acquire operational and business data.** Historian/PI and SCADA-derived readings feed
   the real-time lane. AIMM, iCare, GADS, CMMS/work orders, asset registers, and GIS data
   provide business and spatial context, and equipment manuals supply maintenance
   knowledge. NOAA GFS analyses, NHC storm positions, and Hugging Face static fields feed
   weather inference; customer COG/STAC imagery feeds the catalog.
2. **Process real-time telemetry.** The deployment creates the Eventhouse and KQL database,
   applies their schema, and, when historical seeding is selected, loads `PiEvents`
   directly from the bundled data. For live telemetry, the
   [data-plane add-on](#add-ons) publishes canonical events to the Eventstream
   `PIForwarderEndpoint` custom endpoint; Eventhouse lands them in `PiEventsRaw`, and an
   update policy produces the curated `PiEvents` table for KQL queries. You publish the
   Eventstream separately; see the
   [known gap](docs/architecture/design-guide.md#known-gap-live-ingestion-eventstream).
3. **Curate history and calculate health.** Fabric notebooks prepare source datasets,
   engineer features, detect anomalies, calculate short-term stop risk and long-term
   survival, and produce scored results and daily narratives.
4. **Unify the asset context.** The conformed hierarchy
   `dim_site -> dim_unit -> dim_asset -> dim_tag` links reliability, maintenance, telemetry,
   weather exposure, and operational posture. Digital Twin Builder adds asset relationships.
5. **Serve business and operational queries.** The Import semantic model serves DAX
   queries, Eventhouse serves KQL, and the Fabric data agent answers grounded questions over
   the semantic model. The application uses them without requiring users to switch
   analytical tools.
6. **Add geospatial context.** Customer raster assets are registered in GeoCatalog using
   managed-identity ingestion. STAC search and rendered tiles add imagery and GIS context
   to the map.
7. **Generate weather intelligence.** The scheduled Container Apps job retrieves NOAA GFS
   initial conditions, invokes Aurora, tracks storms, and publishes normalized
   `WeatherEvent` objects to `model-outputs/weather-events.json`. The app can also start a
   run on demand through Azure Resource Manager.
8. **Present decisions and explanations.** Users sign in with Microsoft Entra ID to view
   asset health, twin context, alerts, forecasts, and exposure. The AI agent uses Microsoft
   Foundry language models and connected data tools to explain findings and answer
   questions. Optional add-ons ground answers in equipment manuals through Azure AI Search
   and bring the assistant into Microsoft Teams through Azure Bot. Map tiles load directly
   in the browser.

### Components

- **Data and analytics.** A Microsoft Fabric workspace holds the schema-enabled Lakehouse
  on OneLake, the Eventhouse and KQL database, notebooks, the prediction pipeline, semantic
  models, KQL dashboards, the `OneGridOntology` Digital Twin Builder item, and the Fabric
  data agent. ARM creates the Fabric capacity or connects an existing one; deployment
  scripts use Fabric APIs to provision the workspace and its items. The Eventstream for
  live ingestion belongs to the data-plane add-on.
- **Geospatial.** Planetary Computer Pro GeoCatalog provides STAC search and tile services.
  The `sample-assets` container stores customer assets for ingestion. A dedicated
  user-assigned managed identity has read access to that storage and is associated with
  the catalog.
- **Weather inference.** An Azure Machine Learning workspace hosts the Aurora managed online
  endpoint and its GPU deployment, with supporting storage, Key Vault, and Application
  Insights. A CPU-based Container Apps job (2 vCPU, 4 GiB) orchestrates the pipeline from
  an image in Container Registry; the GPU endpoint performs inference. The job uses its own
  managed identity for storage, registry, and model access.
- **AI and knowledge.** A Microsoft Foundry account hosts the model deployment
  (`gpt-5-mini` by default in ARM). OneGrid hosts the agent orchestration alongside the
  application. The agent queries DAX and KQL, uses the configured Fabric data agent, and
  retrieves equipment-manual context from a bundled corpus or, with the Foundry IQ manuals
  add-on, an Azure AI Search index.
- **Application.** App Service on Linux (Node 22) runs `node report-app/server/index.js`,
  which serves the report APIs (BFF), coordinates TanStack Start/React SSR and chat, and
  exposes REST and real-time WebSocket updates. The deployment mounts the prebuilt
  `onegrid-app.zip` from Blob Storage using `WEBSITE_RUN_FROM_PACKAGE`. Users sign in with
  Microsoft Entra ID.
- **Deployment and management.** The template creates managed identities and scoped role
  assignments. Separate app-plane and Fabric-plane deployment scripts run the PowerShell
  provisioner, and the app package comes from a GitHub release. Application Insights and
  Log Analytics support the weather and model components; workload operations correlate
  these signals with application, Fabric, and identity health.

### Traffic flows and network boundaries

The browser, application, Fabric services, and forecast job initiate different connections.
Their traffic doesn't share a single network path:

- **User access:** browser -> application ingress -> App Service. In the enterprise
  implementation, Application Gateway WAF reaches the application's private endpoint.
- **Application dependencies:** App Service initiates DAX, KQL, AI, catalog, and Blob
  requests. Its outbound VNet integration is separate from inbound private access.
- **Forecast inference:** the Container Apps job retrieves inputs and calls Aurora through
  its own environment network. App Service starts an on-demand execution through Azure
  Resource Manager; it doesn't proxy the scoring request.
- **Service and browser access:** Fabric refresh, shortcuts, and GeoCatalog ingestion
  have service-originated connections. Basemap tiles and glyphs are fetched by the
  browser. Neither path inherits App Service's outbound routing.

Use the [enterprise traffic-flow matrix](docs/architecture/enterprise-landing-zone.md#traffic-flow-matrix)
to plan protocols, DNS, private connectivity, and egress. Validate the actual callers with
the [network acceptance procedure](docs/operations-runbook.md#validate-network-and-traffic-flows).

## Application experiences

| Experience | Information brought together |
| --- | --- |
| Fleet and executive views | Availability, watchlist, actions, reliability trends, and business scorecards |
| Asset explorer and maintenance | Equipment hierarchy, telemetry, advisories, work requests, and manual context |
| Digital twin and simulation | Asset relationships, component health, telemetry, and failure scenarios |
| Weather intelligence | Storm tracks, forecast timelines, exposure, corridor weather, and response posture |
| Oil and gas | Platforms, pipelines, wells, processing/storage facilities, and weather exposure |
| Governance and administration | Data-access inventory, ontology, thresholds, deployment connections, IT/OT context |
| Copilot | Natural-language questions grounded in configured operational and business data |

`oneGridModules` selects `exec`, `weather`, `twin`, `infra`, `sap`, `esu`, `onerig`, and
`copilot`. Core pages remain available independently of those module choices.

## Data model

Reliability and weather share the same asset spine rather than maintaining separate
registries for the map, digital twin, and maintenance views.

| Data group | Tables or artifacts | Purpose |
| --- | --- | --- |
| Asset hierarchy | `dim_site`, `dim_unit`, `dim_asset`, `dim_tag` | Stable identity, site location, equipment, and signal context |
| Reliability | `aakr_health`, `watchlist`, `anomaly_advisories`, `root_cause`, `predictions_shortterm`, `predictions_longterm` | Health assessment, prioritization, explanations, and risk |
| Maintenance | `fact_work_requests`, `daily_narrative` | Work context and operational summaries |
| Weather | `dim_weather_event`, `WeatherForecast`, `fact_asset_exposure`, `fact_posture` | Events, forecast values, asset exposure, and site response posture |
| Real-time operations | `PiEventsRaw`, `PiEvents`, `PCIOutages` | Streaming observations and outage/derate context |
| Relationships | `OneGridOntology` | Plants, units, assets, sensors, work, advisories, outages, and predictions |

The unified deployment generates the `og.*` Delta tables and deploys
`OneGridModelImport` over the Lakehouse SQL analytics endpoint. The dedicated refresh
identity materializes the model; the app's runtime identity queries it. Refresh the
Import model after its source data changes.

## What's in this accelerator

| Asset | What it provides | Location |
| --- | --- | --- |
| Infrastructure template | Azure resources, identities, role assignments, and the app-plane and Fabric-plane deployment scripts; the portal form selects components | [Bicep source](planetary-computer-pro-poc/deploy/azure/main.bicep), [compiled ARM](planetary-computer-pro-poc/deploy/azure/azuredeploy.json), [portal form](planetary-computer-pro-poc/deploy/azure/createUiDefinition.json) |
| Provisioner | Fabric workspace and items, data and model binding, ontology, governance, permissions, and application wiring | [deploy.ps1](planetary-computer-pro-poc/infra/deploy.ps1), [configuration sample](planetary-computer-pro-poc/infra/config.sample.json) |
| Deploy wizard | Localhost web UI over the provisioner, with prerequisite checks, live progress, and teardown | [deploy-ui](planetary-computer-pro-poc/infra/deploy-ui/README.md) |
| Web app | Report BFF, SSR web app, AI agent, and operational experiences; the release workflow builds and publishes the unified `onegrid-app.zip` package | [Application source](OGE-OneGrid/), [release workflow](.github/workflows/release-onegrid-app.yml) |
| Fabric content | Eventhouse schema, Eventstream definition, notebooks, pipeline, semantic models, KQL dashboards, report, and ontology | [Fabric artifacts](planetary-computer-pro-poc/infra/fabric/) |
| Weather pipeline | Weather input preparation, Aurora inference, storm tracking, normalization, and publication | [Aurora pipeline](planetary-computer-pro-poc/aurora/) |
| Data | Historical data bundle (`onegrid-data.zip` release asset) seeded into OneLake, and sample asset registers in CSV and GeoJSON | [Samples](planetary-computer-pro-poc/samples/) |
| Add-ons | Live data plane, Foundry IQ equipment manuals, and Microsoft Teams | [Add-ons](#add-ons) |
| Diagrams | 12 architecture sheets in light and dark SVG and PNG, an HTML gallery, a draw.io file, and the generator | [Diagram guide](docs/diagrams/README.md) |

The [implementation reference](docs/implementations.md) maps the logical architecture to
resource symbols, provisioning phases, application settings, and repository locations.

## Deployment scenarios

Every scenario starts from the same workload template and provisioner. Apply
environment-specific networking, enterprise controls, and recovery configuration through
the platform and workload delivery pipelines. The
[design guide](docs/architecture/design-guide.md#deployment-scenarios) explains how the
scenarios relate to the landing zone.

| Scenario | Design focus | Guidance |
| --- | --- | --- |
| **Baseline** | Single-region application, data, geospatial, weather, and AI flows on authenticated public endpoints | [Baseline architecture](docs/architecture/baseline.md)<br>[Light](docs/diagrams/onegrid-reference-baseline.png) / [Dark](docs/diagrams/onegrid-reference-baseline-dark.png) |
| **Enterprise landing zone** | Integration with existing identity, security, networking, governance, and management | [Enterprise implementation](docs/architecture/enterprise-landing-zone.md)<br>[Light](docs/diagrams/onegrid-reference-enterprise.png) / [Dark](docs/diagrams/onegrid-reference-enterprise-dark.png) |
| **Regulated workload** | Data boundaries, controlled administration, audit evidence, AI oversight, and operational approvals | [Regulated architecture](docs/architecture/regulated-workload.md)<br>[Light](docs/diagrams/onegrid-reference-regulated.png) / [Dark](docs/diagrams/onegrid-reference-regulated-dark.png) |
| **Multiregion recovery** | Application recovery, Fabric item and data recovery, inference capacity, and controlled failover | [Multiregion architecture](docs/architecture/multiregion.md)<br>[Light](docs/diagrams/onegrid-reference-multiregion.png) / [Dark](docs/diagrams/onegrid-reference-multiregion-dark.png) |

## Deploy this solution

### Prerequisites

- Azure rights to create the selected resources and role assignments in the subscription
  and resource group.
- Fabric tenant and capacity permissions, separate from Azure RBAC.
- Microsoft Entra sign-in registration and Import refresh identities, or approved
  directory permission to create them.
- For Aurora: the model asset and accepted terms, plus A100 GPU quota.

The [deployment guide](docs/deployment-and-data-guide.md#prerequisites) lists the regions,
resource providers, and every requirement.

### Deployment options

| Option | Use it for |
| --- | --- |
| **Deploy to Azure** (portal) | Select components in the portal form and deploy the ARM template; the steps follow |
| Azure CLI or PowerShell | Validate, preview, and deploy the ARM template with a parameter file; see [Deploy and configure OneGrid](docs/deployment-and-data-guide.md#deploy-resources-and-provision-the-solution) |
| GitHub Copilot | Let an agent deploy the same template from the command line with the [Copilot deployment runbook](DEPLOY-WITH-COPILOT.md) |
| Deploy wizard | Run the provisioner from a localhost web UI against an existing Fabric capacity; it doesn't create GeoCatalog, Aurora, or the forecast job. See [deploy-ui](planetary-computer-pro-poc/infra/deploy-ui/README.md) |

[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Fpaulshaheen%2FOneGrid%2Fmain%2Fplanetary-computer-pro-poc%2Fdeploy%2Fazure%2Fazuredeploy.json/createUIDefinitionUri/https%3A%2F%2Fraw.githubusercontent.com%2Fpaulshaheen%2FOneGrid%2Fmain%2Fplanetary-computer-pro-poc%2Fdeploy%2Fazure%2FcreateUiDefinition.json)

1. Select the subscription, resource group, and region. Establish Azure role-assignment
   rights, Fabric tenant/capacity permissions, and Entra registration/refresh identities.
2. Select the Fabric plane, app, sample storage, AI model, and required modules. Create a
   Fabric capacity or supply an approved existing one.
3. Enable historical seeding, GeoCatalog, and Aurora components according to the scenario.
   Aurora model deployment requires the model asset/terms and A100 quota; forecasting also
   requires storage and the scheduled job.
4. Validate and deploy the ARM template. Monitor the app and Fabric provisioning scripts.
5. Verify the app, sign-in, DAX/KQL, semantic refresh, enabled modules, imagery, chat, and
   weather outputs. Confirm whether each dataset is seeded, generated, or connected to an
   operational source.

The deployment accepts `eastus`, `northcentralus`, `westeurope`, `canadacentral`, and `uksouth`.
Check selected-service availability and quota in the chosen region. The portal selects
solution components; command-line deployments must set the component parameters explicitly.

For the complete procedure, parameters, identity setup, data formats, and verification,
see [Deploy and configure OneGrid](docs/deployment-and-data-guide.md). The
[Copilot deployment runbook](DEPLOY-WITH-COPILOT.md) provides the guided execution workflow.

## Add-ons

Add-ons run on top of a deployed OneGrid environment and are off by default.

| Add-on | What it adds | Guidance |
| --- | --- | --- |
| Data plane | PI and relational (SQL Server, Oracle) forwarders with a durable outbox that stream your operational data into the Eventstream `PIForwarderEndpoint` custom endpoint, replacing the bundled seed | [Data plane](planetary-computer-pro-poc/infra/bolt-ons/data-plane/README.md) |
| Foundry IQ manuals | An Azure AI Search vector and semantic index over an equipment-manual corpus, used by the assistant's manuals tool and the work-order manual lookup | [Foundry IQ manuals](planetary-computer-pro-poc/infra/bolt-ons/foundry-iq-manuals/README.md) |
| Teams demo | An Azure Bot that brings the OneGrid assistant and the Fabric data agent into Microsoft Teams chat | [Teams demo](planetary-computer-pro-poc/infra/bolt-ons/teams-demo/README.md) |

The data plane needs the `pi-events-stream` Eventstream in the workspace, which the core
deployment doesn't create; see the
[known gap](docs/architecture/design-guide.md#known-gap-live-ingestion-eventstream).

## Considerations

These considerations apply the Azure Well-Architected Framework pillars to the whole
solution. Each architecture article adds scenario-specific guidance.

| Pillar | Guidance |
| --- | --- |
| Reliability | Measure availability across the complete journey: sign-in, application, DAX/KQL, source freshness, model inference, and published forecasts. Keep forecast timestamps and dataset refresh times visible. Size App Service and Fabric for peak demand, define recovery objectives per dependency, and protect source data, item definitions, model bindings, and application packages so the environment can be restored. |
| Security | Separate user authentication, deployment privileges, app runtime permissions, refresh credentials, ingestion identity, and forecast-job identity. Use Entra ID and managed identity for supported runtime calls, apply minimum Azure and Fabric permissions, protect the refresh service-principal credential, and validate data access through the backend's actual query identity. Enterprise ingress, DNS, egress, and private endpoints must preserve package loading, Fabric access, inference, and operational administration. |
| Cost Optimization | Track Fabric capacity, App Service, GPU uptime, Microsoft Foundry tokens, storage, registry, diagnostics, and data transfer separately. Use the component selections to match the scenario, schedule refresh and analytics deliberately, and monitor capacity contention before increasing SKUs. |
| Operational Excellence | Record the source commit, application package, model version, configuration, Fabric item IDs, and identity ownership for each environment. Validate changes in nonproduction, retain known-good packages, rehearse rollback and restore, and alert on broken data flows as well as application errors. |
| Performance Efficiency | Use KQL for streaming operations and DAX for the governed business model. Measure latency, concurrency, capacity utilization, refresh duration, model throttling, and forecast cycle time with representative asset and telemetry volumes. The forecast job orchestrates with 2 vCPU and 4 GiB; Aurora computation runs on the GPU endpoint. |

## Operate the solution

Use the [Day 2 operations guide](docs/operations.md) and
[operational procedures](docs/operations-runbook.md) to monitor:

- Application/API health, sign-in, WebSocket connections, and deployed package identity.
- Live ingestion when the data-plane add-on is enabled, latest telemetry, KQL queries, and
  Fabric capacity.
- Lakehouse updates, semantic-model binding, refresh completion, and DAX results.
- Microsoft Foundry deployment health, grounded answers, token use, and tool access.
- Aurora inference, job execution, input cycles, and `weather-events.json` freshness.
- Identity changes, credential expiry, governance decisions, and recovery readiness.

## Documentation

| Document | Use it to |
| --- | --- |
| [OneGrid landing zone design guide](docs/architecture/design-guide.md) | Place OneGrid in an Azure landing zone and understand the reference implementation |
| [Baseline architecture](docs/architecture/baseline.md) | Review flow contracts, components, model selection, and design decisions |
| [Enterprise landing zone](docs/architecture/enterprise-landing-zone.md) | Integrate with platform identity, networking, DNS, policy, and monitoring |
| [Fabric data and analytics](docs/architecture/fabric.md) | Configure ingestion, the asset model, semantic queries, and data governance |
| [Regulated workload](docs/architecture/regulated-workload.md) | Apply data boundaries, model oversight, and audit evidence |
| [Multiregion architecture](docs/architecture/multiregion.md) | Design coordinated regional recovery |
| [Traffic, identity, security, and monitoring](docs/architecture/traffic-and-security.md) | Read the technical sheets' ports, roles, signals, and weather run |
| [Diagram guide](docs/diagrams/README.md), [gallery](docs/diagrams/onegrid-reference-gallery.html), and [draw.io file](docs/diagrams/onegrid-architecture.drawio) | Browse, rebuild, or adapt the architecture sheets |
| [Deploy and configure OneGrid](docs/deployment-and-data-guide.md) | Deploy, load data, and run acceptance checks |
| [Implementation reference](docs/implementations.md) | Map the architecture to resources, phases, and settings |
| [Day 2 operations](docs/operations.md) and [runbook](docs/operations-runbook.md) | Monitor, release, recover, and decommission |

### Architecture sheets

The scenario sheets are in [Deployment scenarios](#deployment-scenarios). Use the direct
image links on GitHub; the [HTML gallery](docs/diagrams/onegrid-reference-gallery.html) is
for local browsing.

| Sheet | Design focus | OneGrid guidance |
| --- | --- | --- |
| **Landing zone** | OneGrid subscriptions under the organization's management groups beside the platform subscriptions, with design areas A–H | [Design areas](docs/architecture/design-guide.md#design-areas)<br>[Light](docs/diagrams/onegrid-reference-landing-zone.png) / [Dark](docs/diagrams/onegrid-reference-landing-zone-dark.png) |
| **Deployment** | What the template deploys into one resource group, what the provisioner creates in Fabric, and the stamp you repeat | [Deployment view](docs/architecture/design-guide.md#deployment-view)<br>[Light](docs/diagrams/onegrid-reference-deployment.png) / [Dark](docs/diagrams/onegrid-reference-deployment-dark.png) |
| **Resource organization and naming** | Name patterns resolved from `main.bicep` and a recommended resource group split | [Resource organization and naming](docs/architecture/design-guide.md#resource-organization-and-naming)<br>[Light](docs/diagrams/onegrid-reference-naming.png) / [Dark](docs/diagrams/onegrid-reference-naming-dark.png) |
| **Fabric** | Streaming and historical ingestion, Eventhouse/Lakehouse storage, asset analytics, ontology, and governed DAX/KQL access; Import refresh is separate from runtime queries | [Fabric architecture](docs/architecture/fabric.md)<br>[Light](docs/diagrams/onegrid-reference-fabric.png) / [Dark](docs/diagrams/onegrid-reference-fabric-dark.png) |
| **DNS and private endpoints** | Corporate and workload name resolution through the hub resolver, private DNS zones, and forwarding rules for customer domains | [Name resolution flow](docs/architecture/enterprise-landing-zone.md#name-resolution-flow)<br>[Light](docs/diagrams/onegrid-reference-dns.png) / [Dark](docs/diagrams/onegrid-reference-dns-dark.png) |
| **Weather orchestration** | Scheduled or on-demand CPU job preparation, Aurora GPU inference, Blob payload exchange, and published storm events; weather prediction is separate from asset-health scoring | [Weather run](docs/architecture/traffic-and-security.md#weather-run)<br>[Light](docs/diagrams/onegrid-reference-weather.png) / [Dark](docs/diagrams/onegrid-reference-weather-dark.png) |
| **Identity and authorization** | User sign-in and separate application, ingestion, forecast, refresh, workspace, and deployment credentials; scoped data grants are distinct from network access | [Identity and authorization](docs/architecture/traffic-and-security.md#identity-and-authorization)<br>[Light](docs/diagrams/onegrid-reference-identity.png) / [Dark](docs/diagrams/onegrid-reference-identity-dark.png) |
| **Logging and monitoring** | Baseline telemetry versus enterprise additions, signal collection, log destinations, freshness checks, and actionable alerts; monitoring is out of band | [Logging and monitoring](docs/architecture/traffic-and-security.md#logging-and-monitoring)<br>[Light](docs/diagrams/onegrid-reference-monitoring.png) / [Dark](docs/diagrams/onegrid-reference-monitoring-dark.png) |
