# OneGrid architecture diagrams

These diagrams describe the OneGrid solution and its enterprise, regulated, and recovery
implementations. They use official Azure, Microsoft Entra, and Microsoft Fabric icons.

Open the [sheet gallery](onegrid-reference-gallery.html) to browse all thirteen sheets in light
and dark. GitHub doesn't render HTML pages, so download the gallery with its adjacent images
for local browsing; the SVG and PNG links below work on their own.

## Sheets

The sheets follow the Azure Architecture Center drawing conventions: each service is its
official icon with a short name, services are grouped into stages and platform or network
zones, and numbered steps follow the main flow. The numbers match the Workflow or dataflow
list in the article that embeds the sheet, which is where ports, roles, item names, and
caveats are explained. The drawings stay readable because that detail lives in the text.

The baseline is the logical view: data sources move through ingest, store, process, and
serve stages in Microsoft Fabric and Azure to the OneGrid web app. The other eight sheets
use the same grammar for one concern each. Network sheets draw VNets and subnets as boxes
with their example address ranges, which are design allocations, not live Azure inventory.
Enterprise additions are labeled separately from what the baseline template creates.

The first four sheets form the reference set, in the same order as the
[design guide](../architecture/design-guide.md): where OneGrid sits in an Azure landing zone,
what it does, what the template deploys, and how resources are organized and named.

| Sheet | Light | Dark | Source |
| --- | --- | --- | --- |
| Landing zone (design areas A–H) | [SVG](onegrid-reference-landing-zone.svg) / [PNG](onegrid-reference-landing-zone.png) | [SVG](onegrid-reference-landing-zone-dark.svg) / [PNG](onegrid-reference-landing-zone-dark.png) | [landing_zone.py](sheets/landing_zone.py) |
| Logical view | [SVG](onegrid-reference-baseline.svg) / [PNG](onegrid-reference-baseline.png) | [SVG](onegrid-reference-baseline-dark.svg) / [PNG](onegrid-reference-baseline-dark.png) | [baseline.py](sheets/baseline.py) |
| Deployment | [SVG](onegrid-reference-deployment.svg) / [PNG](onegrid-reference-deployment.png) | [SVG](onegrid-reference-deployment-dark.svg) / [PNG](onegrid-reference-deployment-dark.png) | [deployment.py](sheets/deployment.py) |
| Resource organization and naming | [SVG](onegrid-reference-naming.svg) / [PNG](onegrid-reference-naming.png) | [SVG](onegrid-reference-naming-dark.svg) / [PNG](onegrid-reference-naming-dark.png) | [naming.py](sheets/naming.py) |
| Fabric | [SVG](onegrid-reference-fabric.svg) / [PNG](onegrid-reference-fabric.png) | [SVG](onegrid-reference-fabric-dark.svg) / [PNG](onegrid-reference-fabric-dark.png) | [fabric.py](sheets/fabric.py) |
| Enterprise networking | [SVG](onegrid-reference-enterprise.svg) / [PNG](onegrid-reference-enterprise.png) | [SVG](onegrid-reference-enterprise-dark.svg) / [PNG](onegrid-reference-enterprise-dark.png) | [enterprise.py](sheets/enterprise.py) |
| DNS and private endpoints | [SVG](onegrid-reference-dns.svg) / [PNG](onegrid-reference-dns.png) | [SVG](onegrid-reference-dns-dark.svg) / [PNG](onegrid-reference-dns-dark.png) | [dns.py](sheets/dns.py) |
| Weather orchestration | [SVG](onegrid-reference-weather.svg) / [PNG](onegrid-reference-weather.png) | [SVG](onegrid-reference-weather-dark.svg) / [PNG](onegrid-reference-weather-dark.png) | [weather.py](sheets/weather.py) |
| Identity and authorization | [SVG](onegrid-reference-identity.svg) / [PNG](onegrid-reference-identity.png) | [SVG](onegrid-reference-identity-dark.svg) / [PNG](onegrid-reference-identity-dark.png) | [identity.py](sheets/identity.py) |
| Logging and monitoring | [SVG](onegrid-reference-monitoring.svg) / [PNG](onegrid-reference-monitoring.png) | [SVG](onegrid-reference-monitoring-dark.svg) / [PNG](onegrid-reference-monitoring-dark.png) | [monitoring.py](sheets/monitoring.py) |
| Regulated workload | [SVG](onegrid-reference-regulated.svg) / [PNG](onegrid-reference-regulated.png) | [SVG](onegrid-reference-regulated-dark.svg) / [PNG](onegrid-reference-regulated-dark.png) | [regulated.py](sheets/regulated.py) |
| Multiregion recovery (BCDR, letters A–J) | [SVG](onegrid-reference-multiregion.svg) / [PNG](onegrid-reference-multiregion.png) | [SVG](onegrid-reference-multiregion-dark.svg) / [PNG](onegrid-reference-multiregion-dark.png) | [multiregion.py](sheets/multiregion.py) |
| Failover sequence | [SVG](onegrid-reference-multiregion-failover.svg) / [PNG](onegrid-reference-multiregion-failover.png) | [SVG](onegrid-reference-multiregion-failover-dark.svg) / [PNG](onegrid-reference-multiregion-failover-dark.png) | [multiregion_failover.py](sheets/multiregion_failover.py) |

To show the right theme automatically in Markdown, wrap the PNGs in a `<picture>` element
with a `(prefers-color-scheme: dark)` source, as the [README](../../README.md) does.

### Edit in draw.io

[onegrid-architecture.drawio](onegrid-architecture.drawio) holds every sheet as an editable
page, generated from the same sheet data: containers, official icons with their labels,
connected arrows with the same routes, numbered steps, and text. Open it in
[diagrams.net](https://app.diagrams.net/) or draw.io Desktop to adapt a drawing for a customer
deck or a proposal. The repository's published images stay generated from `sheets/`, so make
lasting changes there and rebuild; the build regenerates the draw.io file too.

The resource organization and naming sheet is read from
[main.bicep](../../planetary-computer-pro-poc/deploy/azure/main.bicep) at build time, so it
always lists what the template actually declares.

## Generate and validate

Python 3.10 or later builds every sheet with the standard library only:

```powershell
python .\docs\diagrams\build_diagrams.py
python .\docs\diagrams\build_diagrams.py --check
python .\docs\diagrams\build_diagrams.py --png
python .\docs\diagrams\build_diagrams.py --only weather fabric --png
python -m unittest discover -s .\docs\diagrams -p "test_*.py"
```

- [diagram_engine.py](diagram_engine.py) draws icon nodes, stage containers, platform and
  network zones, cross-cutting bars, numbered steps, and orthogonal flows as static SVG, in
  a light and a dark theme.
- Each file in [sheets](sheets/) defines one sheet as data: its nodes, containers, flows,
  and steps. Edit the sheet and rebuild; don't hand-edit generated SVG or PNG files.
- Before writing anything, the builder checks official icon hashes and validates every
  sheet: names too wide for their node, overlapping nodes, nodes outside their boundary,
  diagonal segments, flow endpoints off their node, flows crossing unrelated nodes,
  overlapping labels or step markers, and flows drawn on top of each other. A failed check
  stops the build.
- `--check` fails if any committed SVG, the gallery, or the draw.io file is out of date.
- Each learn-style sheet gets a legend strip underneath, listing only the line and box
  types that sheet uses.
- `--png` renders 2,400-pixel-wide PNGs with a local Microsoft Edge or Google Chrome in
  headless mode (`--browser` selects the executable). Use Segoe UI on the publishing machine;
  PNG text rasterization depends on installed fonts, while SVG output is deterministic.

Icons are embedded once per SVG as data URIs, so every SVG is self-contained. Rendering stays
local; no diagram content is submitted to a hosted renderer.

## Read the flows

| Element | Meaning |
| --- | --- |
| Solid arrow | Data movement or a call; the arrow points to the component that receives it, responses omitted |
| Two-headed arrow | Two-way exchange, such as features out and scores back |
| Dashed arrow | Optional, gated, binding, trigger, or evidence path, as the article describes |
| Dotted arrow | Identity, token context, or grant; not an inline network proxy |
| Numbered circle | Step in the article's Workflow or dataflow list |
| Lettered circle | Landing zone design area (A–H) in the design guide |
| Dashed outline around a node | Optional component or add-on |
| Light-blue box with a key icon | Subscription |
| Dashed red box | Scale unit: the deployment stamp you repeat per environment or region |
| Dashed grey box with a blue title | Stage, such as Ingest, Store, Process, or Serve |
| Dotted box with an icon | Platform, tenant, or region, such as Microsoft Fabric or Azure |
| Outlined box | Network or trust boundary, such as a VNet or subnet, with its example range |
| Bottom bar | Shared platform services that apply to every flow |

Customer, OT, and third-party sources use plain line pictograms; Azure, Entra, and Fabric
services use their official icons.

App Service and Fabric remain service-hosted, outside the customer subnets. The multiregion
sheet shows recovery targets and release gates rather than treating two web endpoints as
complete workload failover.

## Flow verification

The solution flows are grounded in the
[Bicep resource and identity definitions](../../planetary-computer-pro-poc/deploy/azure/main.bicep),
[Fabric provisioning phases](../../planetary-computer-pro-poc/infra/deploy.ps1),
[Eventstream artifact](../../planetary-computer-pro-poc/infra/fabric/eventstream/pi-events-stream/),
[Aurora pipeline](../../planetary-computer-pro-poc/aurora/aurora_pipeline/), and
[application job-trigger client](../../OGE-OneGrid/report-app/server/aurora.js).
Browser map dependencies come from the
[basemap adapter](../../OGE-OneGrid/webapp/src/lib/map/basemap.ts) and are shown separately
from App Service outbound networking.

The following service guidance was checked for the routing and recovery design. These are
service contracts used by OneGrid, not substituted reference-solution architectures.

Service guidance reviewed on November 23, 2026. Recheck item compatibility and endpoint
requirements when changing a service feature, network policy, region, or release.

| Boundary | Applied rule | Microsoft Learn service guidance |
| --- | --- | --- |
| App ingress and egress | Private endpoint handles inbound; VNet integration handles outbound; disable the public origin explicitly | [App Service VNet integration](https://learn.microsoft.com/azure/app-service/overview-vnet-integration), [App Service private endpoints](https://learn.microsoft.com/azure/app-service/overview-private-endpoint) |
| Reverse-proxy identity | Preserve the published hostname and validate backend TLS/SNI and probes | [Application Gateway and App Service](https://learn.microsoft.com/azure/application-gateway/configure-web-app), [Host name preservation](https://learn.microsoft.com/azure/architecture/best-practices/host-name-preservation) |
| App bootstrap | Validate application and configuration traffic, including package and token dependencies | [App Service routing](https://learn.microsoft.com/azure/app-service/configure-vnet-integration-routing), [Run from package](https://learn.microsoft.com/azure/app-service/deploy-run-package) |
| Private endpoint routing | A default firewall route doesn't override the endpoint's more-specific route; inspection needs endpoint network policies and specific routes | [Private endpoint network policies](https://learn.microsoft.com/azure/private-link/disable-private-endpoint-network-policy) |
| Fabric SaaS | Use tenant-level private connectivity for the combined Import-model workspace; configure source access independently | [Fabric Private Link](https://learn.microsoft.com/fabric/security/security-private-links-overview), [Workspace-level item compatibility](https://learn.microsoft.com/fabric/security/security-workspace-level-private-links-support) |
| Eventstream | Preserve `ProcessedIngestion`; bind the Eventhouse destination/mapping before producers; default connector transport is AMQP over WebSockets | [Eventhouse destination](https://learn.microsoft.com/fabric/real-time-intelligence/event-streams/add-destination-kql-database), [Event Hubs protocol/ports](https://learn.microsoft.com/azure/event-hubs/event-hubs-faq#what-ports-do-i-need-to-open-on-the-firewall) |
| SQL analytics | SQL clients use encrypted TDS on TCP 1433, not HTTPS; Fabric refresh has its own connection | [Fabric SQL connectivity](https://learn.microsoft.com/fabric/data-warehouse/connectivity) |
| Microsoft Foundry | Resolve the account hostname through its private endpoint and authorize the actual app client | [Microsoft Foundry model networking](https://learn.microsoft.com/azure/foundry-classic/openai/how-to/network?view=foundry-classic) |
| Aurora inference | Workspace private endpoint handles managed-endpoint inbound; managed network handles deployment outbound | [Secure managed online endpoints](https://learn.microsoft.com/azure/machine-learning/how-to-secure-online-endpoint?view=azureml-api-2) |
| GeoCatalog | Associate ingestion identity, grant Blob read access, and configure the container ingestion source | [Managed identity ingestion](https://learn.microsoft.com/azure/planetary-computer/set-up-ingestion-credentials-managed-identity) |
| Forecast job | Job inference uses its own environment network; select VNet-integrated workload profiles at creation for UDR egress and retain platform dependencies | [Container Apps jobs](https://learn.microsoft.com/azure/container-apps/jobs), [Environment networking](https://learn.microsoft.com/azure/container-apps/networking), [Firewall dependencies](https://learn.microsoft.com/azure/container-apps/firewall-integration) |
| Private image delivery | Private endpoints require a Premium registry; verify image-data DNS and build/pull access | [Container Registry private endpoints](https://learn.microsoft.com/azure/container-registry/container-registry-private-endpoints) |
| Regional ingress | Restrict public origins by service tag and profile ID, or validate Premium private origins; gate cutover on workload readiness | [Front Door origin security](https://learn.microsoft.com/azure/frontdoor/origin-security) |
| Fabric recovery | Select recovery mechanisms per item and capacity; recover bindings and operational data | [Fabric reliability](https://learn.microsoft.com/fabric/security/reliability-fabric) |

The article structure separates the solution overview, architecture/workflow/components,
design decisions, Well-Architected considerations, deployment, and operations. Enterprise
decisions cover the eight
[Azure landing zone design areas](https://learn.microsoft.com/azure/cloud-adoption-framework/ready/landing-zone/design-areas).
These conventions organize OneGrid's own implementation; they don't introduce unrelated
services or imply that enterprise controls are created by the baseline template.

Use the [deployment acceptance steps](../deployment-and-data-guide.md) and
[operations runbook](../operations-runbook.md) to validate deployed endpoint reachability,
authorization, data freshness, and recovery behavior.

## Icon sources and terms

The [asset manifest](assets/manifest.json) records the source archive or package, the exact
member path, and the SHA-256 for each unmodified icon. The Fabric archive URL is pinned to a
source commit and the Fabric icon package to an exact version. Only the selected icon files
are included. Customer, OT and third-party sources use plain line pictograms drawn by the
engine, not product icons.

- [Azure architecture icons and terms](https://learn.microsoft.com/azure/architecture/icons/)
- [Microsoft Entra architecture icons and terms](https://learn.microsoft.com/entra/architecture/architecture-icons)
- [Microsoft Fabric icons and terms](https://learn.microsoft.com/fabric/fundamentals/icons)
- [Microsoft Fabric SVG icon package (`@fabric-msft/svg-icons`, MIT)](https://www.npmjs.com/package/@fabric-msft/svg-icons),
  used for the KQL database, KQL queryset and ontology icons

Microsoft permits these icons in architectural diagrams, training materials, and
documentation. You can copy, distribute, and display them only for the permitted use unless
Microsoft grants explicit permission. Microsoft reserves all other rights. Keep product
names near icons; don't crop, flip, rotate, distort, or use them as OneGrid branding.
These icon permissions don't relicense the icons under the repository's code license.
