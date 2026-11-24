---
title: Deploy OneGrid in an enterprise Azure landing zone
description: Integrate OneGrid application, Fabric data products, geospatial services, and AI workloads with enterprise identity, networking, security, and governance.
ms.date: 11/23/2026
ms.topic: conceptual
---

# OneGrid in an enterprise landing zone

[Solution overview](../../README.md) | [Baseline architecture](baseline.md)

An enterprise deployment places OneGrid's workload resources inside an organization's
existing platform foundation. The application and its data, geospatial, weather, and AI
planes retain their functional responsibilities. Platform services supply identity
guardrails, connectivity, DNS, policy, central monitoring, and security operations.

The implementation combines the OneGrid ARM deployment and Fabric provisioner with the
organization's network, governance, and environment-delivery configuration.

## Architecture

[![OneGrid enterprise networking separates Application Gateway ingress, the App Service private endpoint, outbound VNet integration, dependency private endpoints, hub DNS, and firewall egress. Fabric and PaaS compute remain service-hosted.](../diagrams/onegrid-enterprise-landing-zone.png)](../diagrams/onegrid-enterprise-landing-zone.svg)

[Download SVG](../diagrams/onegrid-enterprise-landing-zone.svg) |
[Editable draw.io diagrams](../diagrams/onegrid-architecture.drawio)

This implementation adds Application Gateway WAF, private endpoints, network integration,
DNS, and platform egress configuration to the OneGrid deployment. Each dependency has its
own service connection and access policy; the endpoint group represents separate NICs.

### Workflow

1. The browser resolves the published application host and opens an HTTPS connection to
   Application Gateway. WAF evaluates the request before forwarding it.
2. The gateway resolves the App Service origin to its private endpoint and establishes
   a new HTTPS connection. The backend host, certificate, and probe identify the same app.
3. App Service handles the UI, REST API, and WebSocket session. Entra sign-in establishes
   the user identity; runtime data calls use the separately authorized workload identity.
4. App Service sends dependency requests through its delegated integration subnet.
   Private destinations use their private endpoints; approved public destinations use
   the platform egress path.
5. Fabric executes KQL, DAX, and configured Data Agent requests. Refresh, notebooks, and
   shortcuts use their own source connections rather than the application's subnet.
6. The forecast job uses its own Container Apps environment to retrieve NOAA inputs,
   invoke Aurora, exchange Blob payloads, and publish weather output. An app-initiated
   run starts through Azure Resource Manager, not the scoring endpoint.
7. Browser basemap and glyph requests leave the user's network directly. Central
   diagnostics collect out-of-band signals from the enabled services.

### Components and ownership

| Area | Platform responsibility | OneGrid responsibility |
| --- | --- | --- |
| Organization | Subscription vending, management group placement, policies | Workload resource groups, naming, tags, inventory |
| Identity | Entra groups, Conditional Access, privileged elevation, directory consent | App registration, managed identities, refresh identity, scoped data permissions |
| Connectivity | Shared hub/vWAN, hybrid links, DNS, firewall/egress standards | App integration, supported service endpoints, dependency rules, runner connectivity |
| Security operations | Central destinations, threat response, retention standards | Workload signals, redaction, alert ownership, remediation |
| Data governance | Fabric tenant/capacity standards, classification and sharing policy | Workspace/items, model permissions, source contracts, lineage and access tests |
| Delivery | Federated identity standards, deployment approvals | Versioned app/infrastructure/data configuration, migration, rollback |
| Continuity and cost | Shared-service commitments, budgets, recovery constraints | Workload sizing, dependency recovery, cost allocation, exercises |

## Landing zone design decisions

Resolve the eight platform design areas for the OneGrid environment before deployment.
The output is an integration contract, not a second platform foundation.

| Design area | OneGrid decision | Required outcome |
| --- | --- | --- |
| Billing and Microsoft Entra tenant | Select the Azure subscription, Fabric tenant/capacity, and accountable cost owner | Approved tenant relationship, billing scope, and budget |
| Identity and access management | Reuse enterprise sign-in groups; separate deployment, runtime, refresh, ingestion, and job identities | Identity inventory, consent, least-privilege grants, and credential owners |
| Resource organization | Place environment subscriptions/resource groups under the existing management hierarchy | Naming, tags, ownership, retention, and shared-resource deletion boundaries |
| Network topology and connectivity | Select ingress, subnet allocations, private endpoints, DNS, hybrid access, and egress | Reviewed traffic matrix and deployment/operator network paths |
| Security | Protect data, model inputs, tools, administrative access, and supply-chain artifacts | Threat model, approved controls, and permitted/denied access evidence |
| Management | Integrate workload telemetry, alerting, source freshness, backups, and incident response | Service objectives, on-call ownership, retention, and tested recovery |
| Governance | Apply Azure Policy and Fabric/data-governance decisions to the correct control planes | Policy assignments, data classifications, access reviews, and owned exceptions |
| Platform automation and DevOps | Promote versioned infrastructure, app, data/model configuration, and network changes | Approved pipelines, connected runners, release record, and rollback evidence |

## Subscription setup

Separate development, test, and production according to the organization's subscription
model. Give each environment its own resource group, Fabric workspace/item targets,
application registration/settings, data connections, and release record.

Before provisioning, collect:

- Approved subscription/resource group, region, SKUs, quota, naming, and tags.
- Platform network/subnet IDs, DNS forwarding, ingress path, and egress policy.
- Fabric capacity ID or approval to create capacity, workspace ownership, and tenant settings.
- Entra group object IDs, sign-in registration, refresh identity, and directory consent.
- Monitoring destinations, retention, data classification, budget, and recovery objectives.

Keep shared network and management resources outside the workload resource group's deletion
boundary. Reuse an existing Fabric capacity only after agreeing on capacity administration,
content isolation, and performance/cost ownership.

## Compute and model configuration

Select the App Service tier and instance configuration for the required networking,
availability, and concurrency. The app package contains the report BFF, React SSR, and Node
AI agent; preserve its startup command, port 8080, WebSocket support, and package access.

Use the configured Azure OpenAI account/deployment consistently across model settings and
application configuration. Record deployment name, catalog model, version, processing
geography, quota, allowed tools, and evaluation results. When the enterprise supplies an
AI gateway, integrate its endpoint, identity, authorization, and routing with the agent.

For Aurora, allocate regional GPU quota and model readiness independently from the CPU
forecast job. Keep image access, blob channel, output publication, and inference permissions
in the same reviewed configuration.

## Networking

### Subnets and private connectivity

Allocate supported App Service integration, private endpoint, ingress, and management/runner
subnets through the platform address plan. Configure supported private service connections
and resource access rules for storage, Azure OpenAI, Azure ML, and Key Vault.

Use the App Service private endpoint for inbound application access. Use a separate,
delegated integration subnet for outbound connections; VNet integration doesn't provide
inbound access or move App Service compute into that subnet. Delegate the integration
subnet to `Microsoft.Web/serverFarms`; keep it separate from the gateway and private
endpoint subnets. Size its address space for scale operations as well as steady-state
instances.

Validate GeoCatalog and Fabric connectivity against the selected service features, region,
and tenant configuration. Fabric access is a SaaS integration; it is not deployed inside
the application subnet.

Fabric Private Link protects client-initiated access to Fabric. Configure Fabric-to-source
access independently, including storage connections and shortcut paths.

For the combined OneGrid workspace, use **tenant-level Fabric Private Link** and validate
the complete item inventory before blocking public access. This choice preserves the
`OneGridModelImport` semantic-model serving path. Workspace-level Private Link has a
different item-compatibility contract; don't substitute it for tenant-level connectivity
in the existing combined workspace. Review a data-only workspace split as a separate
architecture change, including cross-workspace connections and query targets.

Retain the Eventstream artifact's `ProcessedIngestion` destination mode and validate the
rebound Eventhouse mapping. Don't change to direct ingestion as part of network lockdown.
Assess the tenant-wide impact of Fabric settings with the platform and Fabric owners.

For private Aurora inference, the job reaches the managed endpoint through the Azure ML
workspace private endpoint. Azure ML deployment outbound access is controlled through its
managed network. Configure the Container Apps environment's own network and DNS paths for
NOAA downloads, registry pulls, inference, and the Blob transfer channel.

Choose a VNet-integrated **workload profiles environment** for a forecast job that requires
UDRs and firewall-controlled egress. Allocate its dedicated subnet when the environment
is created; an Azure-managed network can't later be changed into a customer VNet.
The app's integration subnet is not a substitute for this environment network.

For a private registry path, select Azure Container Registry **Premium** and validate the
registry and image-data endpoints. The template's automatically created registry uses
Basic; include the SKU/network change in enterprise IaC before restricting image access.
Validate build-time image publication separately from runtime image pulls.

### Ingress

The illustrated entry point is Application Gateway WAF, which reaches the App Service
private endpoint. Select an internal or external frontend, restrict direct origin access,
and register the published host's sign-in callback. Test browser navigation, API
authorization, and WebSocket traffic through the same entry point.

Preserve the published host end to end by binding the custom domain and TLS certificate
to App Service and using that host for the gateway backend and custom probe. Resolve the
backend privately from the gateway network. A private IP alone doesn't provide the
correct HTTP host or TLS server name indication (SNI).

After private access passes, explicitly disable App Service public network access and test
that the direct public origin is denied. Creating a private endpoint doesn't, by itself,
remove the public access path. App Service access restrictions aren't evaluated for traffic
arriving through a private endpoint; apply the intended private-path controls at the
network and application boundaries.

### DNS and egress

Use centrally owned private DNS zones, links, and forwarding. Test name resolution from
App Service, deployment runners, operator workstations, and hybrid networks.

Maintain an endpoint matrix for:

- Entra, Azure control plane, Fabric/Power BI APIs, KQL, and SQL analytics.
- Blob package mounting, assets, forecast output, and Aurora transfer channels.
- Azure OpenAI and Azure ML scoring.
- NOAA GFS, approved weather/static-data sources, and imagery ingestion sources.
- Container image pulls, source/package distribution, and diagnostic ingestion.
- Browser-loaded basemap tiles and glyphs: the configured Azure Maps path, selected Esri
  layers, and `demotiles.maplibre.org`.

Separate bootstrap, build-time, and runtime access. Change public endpoint access only after
the corresponding private/runtime/deployment paths have been validated.

Test browser-originated map requests from the user's network. These requests don't traverse
App Service VNet integration. The current basemap adapter selects Azure Maps for the dark
basemap when `VITE_AZURE_MAPS_KEY` is present at build time; satellite and bathymetry layers
use Esri, and the default dark basemap also uses Esri when that setting isn't supplied.

For App Service, review application and configuration routing together. When policy requires
all outbound traffic through the VNet, configure `outboundVnetRouting.allTraffic` and validate
package mounting, token acquisition, diagnostics, and dependency access through that route.
An authenticated, nonanonymous Blob container is an authorization boundary; private network
access additionally requires the corresponding endpoint, DNS, and routing configuration.

Keep the original service hostname in requests and let private DNS resolve it to the
approved endpoint. Don't replace SDK endpoints with private IP addresses.

| DNS boundary | Configuration | Validation point |
| --- | --- | --- |
| App Service origin | Link `privatelink.azurewebsites.net` and register the app record; add the SCM record when used | Gateway backend, probe, and connected deployment runner |
| Blob Storage | Link `privatelink.blob.core.windows.net`; add other storage subresources only when used | App package bootstrap, imagery access, job channel/output, and each service-source connection |
| Azure OpenAI | Link `privatelink.openai.azure.com` for the deployed account endpoint | Actual App Service model client |
| Azure ML workspace/scoring | Use the workspace private endpoint's supplied DNS records, including inference resolution | Container Apps job network and model administration path |
| Fabric | Use the tenant private endpoint's DNS configuration and actual KQL, Power BI, and API connection targets | App runtime, connected operators/runners, and the selected Fabric experiences |
| Hybrid clients | Forward relevant private zones through the platform resolver; preserve public resolution for approved external sources | Corporate browser, connector host, and administrative network |

A `0.0.0.0/0` route to Azure Firewall controls default egress; it doesn't override a
private endpoint's more-specific route. The diagram therefore separates direct private
endpoint access from inspected public egress. If policy requires private endpoint traffic
inspection, configure the endpoint subnet's network policies and specific routes, then
validate the actual next hop and return path.

### Traffic-flow matrix

Use this matrix as the workload input to firewall and DNS policy. Resolve service-generated
hostnames from the deployed resources and connection definitions. Platform dependencies,
service tags, and regional endpoints also need the service-specific rules recorded in the
[routing evidence](../diagrams/README.md#flow-verification).

| Initiator | Destination | Protocol / port | Enterprise path | Acceptance evidence |
| --- | --- | --- | --- | --- |
| User browser | Published application host | HTTPS and WSS / TCP 443 | Approved user network -> Application Gateway WAF | Sign-in, API authorization, and WebSocket reconnect |
| Application Gateway | App Service origin | HTTPS / TCP 443 | Gateway subnet -> app private endpoint | Private DNS result, valid host/SNI, healthy custom probe |
| App Service | Fabric DAX, KQL, and Data Agent endpoints | HTTPS / TCP 443 | App integration -> tenant Fabric private connectivity for the verified endpoints | Real query/answer against intended workspace/item IDs |
| App Service | Azure OpenAI account endpoint | HTTPS / TCP 443 | App integration -> account private endpoint | Authorized grounded model/tool response |
| App Service | GeoCatalog account endpoint | HTTPS / TCP 443 | App integration -> approved platform egress | Authorized STAC/search, catalog operations, and imagery retrieval |
| App Service | Blob package and runtime data | HTTPS / TCP 443 | App integration -> Blob private endpoint | Package loads after restart; authorized read/write operations succeed |
| App Service | Azure Resource Manager job API | HTTPS / TCP 443 | App integration -> approved platform egress | Job-scoped start/status request; no app-to-scoring dependency |
| Operational connector | Resolved Eventstream custom endpoint | AMQP over WebSockets / TCP 443 by default | Approved source transfer zone -> configured Fabric ingress | Producer acknowledgment and new curated `PiEvents` row |
| Connected SQL client or provisioning task | Lakehouse SQL analytics endpoint | Encrypted TDS / TCP 1433 | Approved runner/operator network -> selected Fabric SQL path | Authenticated SQL query; firewall treats traffic as MSSQL, not HTTPS |
| Forecast job | Aurora managed online endpoint | HTTPS / TCP 443 | Job environment network -> workspace private endpoint | Scoring succeeds with the job identity and current model |
| Forecast job | NOAA inputs, registry, Blob channel/output | HTTPS / TCP 443 for workload calls | Job's own DNS/private endpoints and approved egress | Image pull, input retrieval, payload exchange, and fresh published output |
| GeoCatalog ingestion service | Source imagery container | HTTPS / TCP 443 | Independently approved service-to-storage connection | Associated ingestion identity reads the source; ingestion and tiles complete |
| Fabric refresh, notebooks, and shortcuts | Configured source/connection | Source-specific; SQL uses TDS, Blob uses HTTPS | Fabric-managed source access, not App Service integration | Import refresh, notebook output, and shortcut content access |
| Browser | Azure Maps, Esri, and glyph hosts | HTTPS / TCP 443 | User network egress, not the application subnet | Each selected map style and glyph request succeeds |

The supplied connectors set `UseAmqpWebSockets=true`. If explicitly changed to native
AMQP/TLS, allow TCP 5671 as well as HTTPS dependencies for identity and SDK operations.
An HTTP-only proxy policy must support the configured WebSocket transport.

Keep Entra token endpoints, Azure management APIs, deployment-script dependencies,
diagnostics, and Container Apps platform requirements in the approved ruleset. Don't
interpret the workload's HTTPS rows as a complete platform allowlist. Managed identity
and short-lived Blob delegation credentials authorize requests; they don't bypass
storage or service network rules.

GeoCatalog is an approved public API dependency in this design. Its source-ingestion
connection must be reachable by the service; a Blob private endpoint used by App Service
doesn't establish that connection. Test ingestion and actual imagery access before
tightening source-storage network access.

## Identity and data governance

Use existing group-based access and explicit identity owners. Separate resource provisioning
and role assignment from app runtime access. Review the provisioner's resource-group Owner,
storage role-assignment rights, and optional Graph application permission as bootstrap
privileges with an approved ongoing lifecycle.

Use `entraSignInClientId` for a pre-created SPA registration. Use the
`refreshServicePrincipal*` parameters for an existing Import refresh identity, or approve
the directory permissions required for the provisioner to create the needed identities.
Rotate the refresh secret through the approved secret-management process and test refresh
after rotation.

Configure OneGrid governance in the provisioner:

- `governance.enabled` controls the governance phase.
- `governance.mode=inventory` reviews existing roles without provisioning role writes.
- `governance.groups` binds executive, control-room, maintenance, ontology, reviewer, and
  platform-administrator groups.
- `governance.autoCreateGroups=false` keeps group creation under enterprise administration.
- Review `governance.leastPrivilegeApp` against actual runtime and semantic permissions.

The ARM wrapper initializes governance disabled; apply the approved governance configuration
through the provisioner rather than assuming selecting the app configures enterprise roles.
Validate effective data filtering through DAX, KQL, SQL, OneLake, chat, and exports.

## Monitoring and policy

Route application, model, job, Fabric, identity, and network signals to approved destinations.
Correlate source lag, semantic refresh, model calls, and forecast publication with
user-facing failures. Assign an owner to every alert and test escalation.

Keep `exemptStorageFromPolicy=false` in the normal deployment configuration. A policy
exception requires platform approval, its scope, owner, expiration, and compensating
controls. The template's opt-out tags only affect policies configured to recognize them.
Deployment scripts require their supporting storage/container access; validate bootstrap
compatibility before rollout into a policy-controlled environment.

## Implement the enterprise deployment

1. Approve the resource, identity, data, network, monitoring, and recovery integration contract.
2. Provision or identify shared connectivity, DNS, diagnostic destinations, groups, and
   deployment runners through the platform pipeline.
3. Configure the OneGrid environment parameters, component choices, capacity, app package,
   sign-in, and refresh identity.
4. Validate and deploy ARM; inspect app-plane and Fabric-plane provisioning results.
5. Apply workload network integration, diagnostic settings, approved Fabric/governance
   configuration, access rules, and operating schedules through reviewed IaC/automation.
6. Test sign-in, denied access, package loading, DAX/KQL, model refresh, optional imagery,
   AI answers, and forecast publication through the enterprise network.
7. Record the approved configuration, exceptions, release versions, owners, and recovery
   evidence before promoting to production.

Keep enterprise network settings in the promoted resource definitions, not only in
post-deployment portal changes. The baseline `openAi` resource explicitly sets public
network access to `Enabled`; the enterprise deployment must change that setting with
its private connectivity configuration. Review what-if output and enforce policy on
every release so a baseline redeployment can't reopen an approved private dependency.
Stage and validate private access before enforcing denial during the initial migration.

### Acceptance criteria

- Every deployed component has an owner, environment label, and cost/recovery classification.
- Identity and data-access positive/negative tests pass.
- DNS, ingress/egress, package access, queries, and inference use the intended paths.
- Source ingestion, semantic refresh, and forecast freshness are monitored.
- Policy exceptions are explicitly approved; diagnostic redaction/retention is verified.
- Rollback, data restoration, and escalation have been exercised.

## Considerations

### Reliability

Include platform DNS, identity, network, shared Fabric capacity, and model
quota in dependency analysis and recovery exercises.

### Security

Protect asset locations, operational data, prompts, credentials, and audit
records; verify shared runtime identities cannot cross approved data boundaries.

### Cost Optimization

Allocate both shared-platform and workload costs, including private
connectivity, diagnostics, AI tokens, GPU capacity, and Fabric consumption.

### Operational Excellence

Review platform and workload changes together. Revalidate after
policy, DNS, firewall, identity, data-source, model, or capacity changes.

### Performance Efficiency

Measure latency through the enterprise ingress/egress path,
query concurrency, refresh overlap, and recovery-region capacity rather than only local tests.

## Next steps

- [Apply regulated workload controls](regulated-workload.md).
- [Design multiregion recovery](multiregion.md).
- [Configure Fabric data products and governance](fabric.md).
- [Establish Day 2 operations](../operations.md).
