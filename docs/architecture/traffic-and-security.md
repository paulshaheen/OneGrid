---
title: OneGrid traffic, identity, security, and monitoring contracts
description: Detailed OneGrid architecture drawings and source-grounded networking, authorization, diagnostics, and recovery requirements.
ms.date: 11/24/2026
ms.topic: conceptual
---

# OneGrid traffic, identity, security, and monitoring

[Solution overview](../../README.md) | [Detailed diagram gallery](../diagrams/onegrid-reference-gallery.html)

The nine technical sheets separate the deployed OneGrid resource/runtime contract from
enterprise network, monitoring, regulated-workload, and recovery additions. They use actual
service boundaries rather than placing SaaS or App Service compute inside customer subnets.
Example addresses are design allocations, not an inventory obtained from an Azure subscription.

## Architecture sheets

| Sheet | Light drawing | Dark drawing | Principal decision |
| --- | --- | --- | --- |
| Baseline | [PNG](../diagrams/onegrid-reference-baseline.png) | [PNG](../diagrams/onegrid-reference-baseline-dark.png) | Complete enabled resource and runtime paths; authenticated public endpoints |
| Fabric | [PNG](../diagrams/onegrid-reference-fabric.png) | [PNG](../diagrams/onegrid-reference-fabric-dark.png) | Ingestion, SQL/Import refresh, KQL/DAX, source connections, and data permissions |
| Enterprise | [PNG](../diagrams/onegrid-reference-enterprise.png) | [PNG](../diagrams/onegrid-reference-enterprise-dark.png) | Actual subnet responsibilities and separate service private endpoints |
| DNS | [PNG](../diagrams/onegrid-reference-dns.png) | [PNG](../diagrams/onegrid-reference-dns-dark.png) | Inbound resolution, linked zones, outbound forwarding, and caller tests |
| Weather | [PNG](../diagrams/onegrid-reference-weather.png) | [PNG](../diagrams/onegrid-reference-weather-dark.png) | Scheduled CPU execution, GPU scoring, Blob channel, and publication |
| Identity | [PNG](../diagrams/onegrid-reference-identity.png) | [PNG](../diagrams/onegrid-reference-identity-dark.png) | User, runtime, refresh, workspace, ingestion, and deployment identities |
| Monitoring | [PNG](../diagrams/onegrid-reference-monitoring.png) | [PNG](../diagrams/onegrid-reference-monitoring-dark.png) | Baseline-wired signals versus diagnostics and alerting to implement |
| Regulated | [PNG](../diagrams/onegrid-reference-regulated.png) | [PNG](../diagrams/onegrid-reference-regulated-dark.png) | OT publication boundary, actual authorization paths, and retained evidence |
| Multiregion | [PNG](../diagrams/onegrid-reference-multiregion.png) | [PNG](../diagrams/onegrid-reference-multiregion-dark.png) | Protected regional origins, dependency-specific recovery, and publisher fencing |

The gallery links SVGs and PNGs for every sheet. Both image formats are exported by the
actual draw.io Desktop engine from the native nine-page
[light](../diagrams/onegrid-reference-architecture.drawio) and
[dark](../diagrams/onegrid-reference-architecture-dark.drawio) documents.
The [builder](../diagrams/build_reference_architecture.py) uses the documented native
`mxfile` / `mxGraphModel` / `mxCell` import format. It does not submit solution content to
a hosted rendering service.

## What the resource template creates

The [Bicep template](../../planetary-computer-pro-poc/deploy/azure/main.bicep) creates selected
Azure resources and invokes the
[Fabric/application provisioner](../../planetary-computer-pro-poc/infra/deploy.ps1).
Component parameters select the enabled planes.

| Area | Source-grounded baseline | Additional enterprise implementation |
| --- | --- | --- |
| Application | Linux App Service, Node 22, HTTPS-only, TLS 1.2 minimum, WebSocket, system-assigned identity | WAF, private origin, custom host/certificate, outbound integration, DNS, access tests |
| Storage | Standard LRS, HTTPS-only, TLS 1.2, anonymous Blob access disabled; private containers | Network rules, private endpoints, private DNS, source-service access, protection/recovery |
| OpenAI | Account/model deployment; explicit public network access enabled in baseline Bicep | Approved processing geography/model; private endpoint, identity policy, public denial |
| Aurora | Workspace/backing storage/Key Vault/Application Insights; AADToken online endpoint; conditional GPU deployment | Quota/model readiness, inbound workspace PE, managed outbound network and backing-resource grants |
| Forecast job | CPU job, own identity, schedule, registry access, Blob/ML grants, environment Log Analytics | Dedicated VNet-integrated workload profiles environment, source egress, private registry/scoring/channel access |
| Fabric | Capacity/workspace/items, semantic refresh and configured identity/item grants | Tenant Private Link/public block, supported source connections, retention and monitoring |
| Enterprise network | Not declared by the baseline resource template | VNets, subnet delegations, peering, WAF, firewall, UDRs, NSGs, resolver endpoints and private endpoints |
| Recovery/monitoring | Selected resource wiring and execution logs | Recovery automation, protected copies, connected runners, diagnostic settings, alerts and acceptance evidence |

Changing the picture does not deploy these additions. Promote the enterprise resource
definitions and settings through IaC. In particular, do not rely on a portal-only change to
public access that a subsequent baseline deployment can replace.

## Network and name-resolution design

The enterprise and DNS sheets use this illustrative, non-overlapping address plan:

| Boundary | Example range | Responsibility |
| --- | --- | --- |
| Primary hub | `10.10.0.0/16` | Platform connectivity |
| AzureFirewallSubnet | `10.10.0.0/26` | Approved public egress; example next hop `10.10.0.4` |
| Resolver inbound | `10.10.1.0/28` | Dedicated `Microsoft.Network/dnsResolvers` subnet; example static VIP `10.10.1.4` |
| Resolver outbound | `10.10.1.16/28` | Separate dedicated resolver subnet; no client-facing inbound VIP |
| Primary workload | `10.20.0.0/16` | OneGrid network integration |
| Gateway subnet | `10.20.0.0/24` | Dedicated Application Gateway subnet |
| Private endpoint subnet | `10.20.1.0/24` | Separate NICs/connections for app and supported dependency services |
| App integration subnet | `10.20.2.0/26` | Delegated to `Microsoft.Web/serverFarms`; outbound only |
| Job environment subnet | `10.20.4.0/23` | Dedicated workload profiles environment, delegated to `Microsoft.App/environments` |
| Recovery hub / workload | `10.30.0.0/16` / `10.40.0.0/16` | Independently configured recovery DNS, routes, endpoints and source access |

These are complete design allocations, not subnet-size minimum recommendations for every
deployment. Select sizes from actual scaling/platform requirements.

1. A user resolves the published host and connects to the gateway over HTTPS/WSS 443.
   The gateway opens a separate HTTPS connection to the app private endpoint, preserving
   the approved host, backend TLS/SNI, and custom health-probe host.
2. The app private endpoint is **inbound only**. App dependency requests use the separate
   integration subnet. Set `outboundVnetRouting.allTraffic=true` when application and
   configuration/bootstrap traffic must follow the VNet route.
3. Configure and test the job environment's own network at creation. Its image pulls,
   NOAA/static/feed downloads, ML scoring, and Blob access do not inherit app integration.
4. Private endpoint requests normally use the more-specific private route. A default
   `0.0.0.0/0` firewall route alone does not force PE traffic through inspection. Inspection
   requires the intended network policies, specific routes, and verified return path.
5. Custom DNS clients reach the resolver inbound VIP over UDP/TCP 53. Linked private zones
   answer private service queries. Outbound forwarding applies only to configured customer
   namespaces; avoid forwarding them back into the same resolver.
6. A forwarding-ruleset VNet link is not peering, and peering is not implicitly transitive.
   Direct inbound DNS and service traffic must have actual network reachability.

### Endpoint and protocol matrix

Keep original service hostnames in SDKs and let DNS resolve the private addresses.
Do not replace an HTTPS endpoint with a private IP literal.

| Initiator | Destination / protocol | Authorization / network requirement |
| --- | --- | --- |
| Browser | App host, HTTPS/WSS 443 | Approved ingress, valid user session, application authorization |
| Gateway | App Service origin, HTTPS 443 | Private DNS, origin host/certificate/SNI/probe; deny public bypass |
| App | KQL / DAX / Data Agent, HTTPS 443 | Actual item IDs, separate data permissions, tenant Fabric private access |
| App | OpenAI account, HTTPS 443 | Configured Entra or API-key path, approved model; private account endpoint |
| App | Blob package/assets/output, HTTPS 443 | App storage grant plus tested startup and runtime network access |
| App | GeoCatalog API, HTTPS 443 | Catalog role and explicit approved API egress |
| App | ARM start/status API, HTTPS 443 | Token for management API; Jobs Operator scoped to the job |
| Connector | Eventstream custom endpoint, AMQP over WSS 443 | Actual broker/source namespace, Entra/certificate producer identity, published destination/mapping |
| Connector, optional mode | Same source, native AMQP/TLS 5671 | Explicit transport choice plus HTTPS/token dependencies |
| Refresh identity / SQL client | Lakehouse SQL, encrypted TDS 1433 | SQL/table permissions; firewall handles MSSQL/TDS, not HTTPS |
| Job | Aurora scoring, HTTPS 443 | Job ML token and workspace permission; workspace PE for private inbound |
| Job / model deployment | Blob channel, HTTPS 443 | Short-lived delegation SAS plus reachable network path from **both** callers |
| Job | Registry / image data, HTTPS 443 | AcrPull, registry/data DNS; private ACR requires Premium rather than baseline Basic |
| Job | NOAA GFS / NHC / HuggingFace and download hosts, HTTPS 443 | Explicit runtime public-source egress; not customer imagery |
| GeoCatalog ingestion | Source Blob container, HTTPS 443 | Associated ingestion identity + Blob Reader; service-to-source networking separately validated |
| Fabric shortcut | Blob or compatible ADLS Gen2 source, HTTPS 443 | Real connection ID and source credentials/network path; not just a provisioner grant |
| Browser | Azure Maps / Esri / glyphs, HTTPS 443 | Browser network policy; does not traverse App Service integration |

### Private DNS and public-access settings

| Service | DNS / access boundary |
| --- | --- |
| App Service | `privatelink.azurewebsites.net`; include SCM if used; public access must be explicitly tested/disabled |
| Blob | `privatelink.blob.core.windows.net`; private container authorization is not private networking |
| ADLS source, when selected | `privatelink.dfs.core.windows.net` and required Blob path; confirm compatible source configuration |
| OpenAI | `privatelink.openai.azure.com` for the deployed account host |
| ACR | `privatelink.azurecr.io`, including registry and service-generated image-data records |
| ML | Workspace-supplied records under `privatelink.api.azureml.ms`; notebook zone only when used; resolve actual scoring hostname |
| Fabric | Use the tenant PE's generated DNS configuration for actual KQL, Power BI and Fabric API targets |
| Monitoring | AMPLS and supported Azure Monitor endpoints/DNS when private monitoring is required |

The combined workspace contains `OneGridModelImport`. Workspace-level Private Link cannot
replace tenant-level connectivity for this workspace while semantic models remain excluded
from workspace-level support. Preserve Eventstream `ProcessedIngestion`; do not switch to
direct ingestion while applying private-network controls.

Client Private Link into Fabric does not establish Fabric-to-source access. Similarly,
a Blob PE in the customer VNet does not establish GeoCatalog-to-source access. Select and
prove the source-service mechanism before disabling a required public source path.

## Identity and authorization

The identity sheet records separate principals, credentials, scopes, and access tests.

- **User:** Entra sign-in establishes a session. It does not automatically apply that user's
  row permissions to every shared-identity DAX, KQL, agent, or Blob request.
- **App identity:** baseline account-level Blob Data Contributor, catalog-level GeoCatalog
  Administrator, and job-scoped Jobs Operator; provisioner-applied Fabric/model grants are
  separate. Test actual scope and every application data/tool path.
- **Job identity:** workspace-level AzureML Data Scientist, sample-account Blob Data
  Contributor, and registry pull rights. Channel SAS authorization does not bypass firewalls.
- **Ingestion identity:** associated with GeoCatalog; sample-account Blob Data Reader.
- **Refresh service principal:** Fabric connection credential and SQL read permission; not
  the app or the signed-in user. Rotate and test its credential and model binding.
- **Optional workspace identity:** shortcut connection source access; separate from the
  Azure Fabric-plane deployment identity. A supplied Blob connection is another supported
  configured path.
- **Provisioner:** baseline includes resource-group Owner and storage User Access
  Administrator, with optional Graph permission. Treat this as privileged deployment
  access rather than a runtime entitlement.

The regulated design requires implementation and permitted/denied evidence for each call
path. The baseline wrapper disables optional governance configuration; a governance-intent
record or UI inventory is not blanket enforcement.

## Logging and monitoring

| Signal | Current wiring / required implementation | Acceptance |
| --- | --- | --- |
| Forecast execution | Container Apps environment is wired to Log Analytics; Python logs execution stages and failures | Trigger a run; locate its output/error logs and correlate the cycle and timestamps |
| ML | Workspace references Application Insights; select endpoint/deployment diagnostics, metrics and inference collection explicitly | Real scoring call, failures, latency and healthy model deployment |
| App / gateway | Implement supported logs, diagnostic settings and actual app instrumentation | UI/API/WebSocket/tool failure correlates with the correct caller and dependency |
| Fabric | Use Fabric monitoring/run/refresh history and actual source/query checks; implement central export separately | Source/raw/curated/SQL/Import freshness, failed runs, capacity and query success |
| Azure resources / Activity Log / Entra | Configure each supported resource/subscription/tenant diagnostic path independently | Role/public-access changes, denied calls, retention, access controls and incident ownership |
| Data and recovery readiness | Implement scheduled real-caller checks and alerts | Analysis/generation age, latest event, last refresh, model readiness and one active publisher |

Platform metrics and Activity Log are generated automatically, but resource-log collection
requires diagnostic settings. A destination existing does not mean every service is sending
the desired evidence. Private monitoring requires a deliberate AMPLS design; networks
sharing DNS should not independently override the same Azure Monitor zones with conflicting
scopes. Select supported collection paths and test ingestion/query access.

Avoid secrets/tokens and unapproved sensitive payloads in logs. Specify retention, RBAC,
archive/immutability where required, alert routing, named ownership and a tested runbook.
Do not insert monitoring as an inline hop in the user or inference path.

## Forecast interpretation

The [forecast implementation](../../planetary-computer-pro-poc/aurora/aurora_pipeline/run.py)
selects the prior six-hour cycle for availability, combines two starting states, detects
and filters storm seeds, invokes Aurora, tracks the rollout and publishes normalized data.
Twenty steps mean 120 hours **from analysis time**, not from the job's start time.

Gust (`wind * 1.25`), cone (`25 + 1.5 * leadHours` miles) and track-length confidence are
application estimates, not calibrated ensemble probabilities. An empty storm result can
skip inference; failure before publication can leave the prior file. Both analysis and
generation timestamps matter. Customer asset consequence/failure logic is a separate
business calculation, not automatically supplied by atmospheric forecasts.

## Regional recovery

The recovery sheet chooses Front Door Premium managed Private Link origins. These
connections belong to Front Door's managed path, not to an invented customer gateway
subnet. Approve both regional origins and verify public-origin denial.

Prepare regional dependencies and use this release sequence:

1. Fence the primary ingestion/forecast publishers.
2. Recover data by each item's supported mechanism; retain/replay source checkpoints.
3. Restore permissions/connections and apply actual regional item IDs and endpoints.
4. Refresh Import and test KQL/DAX, inference, GeoCatalog, Blob, authorization and freshness.
5. Enable the accepted recovery origin and confirm exactly one forecast publisher.

Baseline sample storage is LRS, not automatic cross-region protection. Copies, retained
versions/backups, Fabric recovery and catalog reconstruction require explicit implementation.
For a public-origin alternative, combine `AzureFrontDoor.Backend` with the matching
profile's `X-Azure-FDID`; the shared tag alone is insufficient.

## Source review and drawing method

Reviewed on November 24, 2026. This is source/design verification, not evidence that an Azure
deployment or network acceptance test ran.

The drawing approach was checked against the builders supplied in the request:

- [Balunywa DNS architecture builder, pinned revision](https://github.com/Balunywa/dns-crossregion-failover-poc/blob/8a6435fbc7a4c37e8d33d10de525391ee0fbc7e6/docs/diagrams/build_architecture_diagrams.py):
  nested region/service scopes, explicit endpoint details, orthogonal routes and explanatory notes.
- [dmauser reference-architecture builder, pinned revision](https://github.com/dmauser/azure-dnsresolver-failover/blob/e37a41ef3f65be13b3387897ab23f86985281893/docs/diagrams/build_reference_architecture.py):
  native parent-relative `mxCell` containers, subnet responsibility, source/target connectors
  and separated route/zone information.

OneGrid uses original layouts and its own implementation evidence. DNS-lab upstream VMs,
synthetic domains, measured timings and NVA failover assumptions are not imported as
OneGrid facts.

| Microsoft / draw.io guidance | Applied architecture decision |
| --- | --- |
| [Native draw.io file format](https://www.drawio.com/docs/reference/file-format/) and [embed/load interface](https://www.drawio.com/docs/reference/embed-mode/) | Native editable cells, groups, geometry and source/target connectors; local actual-engine image export |
| [App Service private endpoints](https://learn.microsoft.com/azure/app-service/overview-private-endpoint) | Separate inbound PE and outbound integration; explicit public denial |
| [App Service routing](https://learn.microsoft.com/azure/app-service/configure-vnet-integration-routing) | Application and configuration routing, including bootstrap |
| [Application Gateway and App Service](https://learn.microsoft.com/azure/application-gateway/configure-web-app) | Preserve custom host, TLS/SNI, backend DNS and probe |
| [Private endpoint DNS](https://learn.microsoft.com/azure/private-link/private-endpoint-dns) | Original service FQDN and service-specific/generated private records |
| [Resolver endpoints and rulesets](https://learn.microsoft.com/azure/dns/private-resolver-endpoints-rulesets) | Distinct inbound/outbound subnets, linked zones, forwarding and reachability |
| [Container Apps network security](https://learn.microsoft.com/azure/container-apps/firewall-integration) | Independent workload profiles network/UDRs and platform dependencies |
| [ACR private endpoints](https://learn.microsoft.com/azure/container-registry/container-registry-private-endpoints) | Premium SKU, registry/data endpoints and connected build runner |
| [Secure managed online endpoints](https://learn.microsoft.com/azure/machine-learning/how-to-secure-online-endpoint?view=azureml-api-2) | Workspace inbound PE versus managed deployment outbound |
| [Fabric tenant Private Link](https://learn.microsoft.com/fabric/security/security-private-links-overview) and [workspace item compatibility](https://learn.microsoft.com/fabric/security/security-workspace-level-private-links-support) | Tenant boundary for combined semantic-model workspace; source access is independent |
| [Eventstream Entra authentication](https://learn.microsoft.com/fabric/real-time-intelligence/event-streams/custom-endpoint-entra-id-auth) | Actual custom-endpoint namespace, producer principal and credential mode |
| [Fabric SQL connectivity](https://learn.microsoft.com/fabric/data-warehouse/connectivity) | Encrypted TDS 1433 and SQL-aware filtering |
| [GeoCatalog managed-identity ingestion](https://learn.microsoft.com/azure/planetary-computer/set-up-ingestion-credentials-managed-identity) | Associated identity, source container and Blob Reader |
| [Diagnostic settings](https://learn.microsoft.com/azure/azure-monitor/data-collection/diagnostic-settings) | Enable per-resource collection; destination, category and retention checks |
| [Azure Monitor Private Link](https://learn.microsoft.com/azure/azure-monitor/fundamentals/private-link-security) and [network design](https://learn.microsoft.com/azure/azure-monitor/fundamentals/private-link-design) | AMPLS/private DNS is separate from merely creating Log Analytics |
| [Container Apps logs](https://learn.microsoft.com/azure/container-apps/log-monitoring) and [managed-endpoint monitoring](https://learn.microsoft.com/azure/machine-learning/how-to-monitor-online-endpoints?view=azureml-api-2) | Explicit baseline signal wiring versus additional collection/instrumentation |
| [Front Door origin security](https://learn.microsoft.com/azure/frontdoor/origin-security) | Managed private origins, or combined service-tag/profile-ID restrictions |
