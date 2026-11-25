---
title: OneGrid operational runbook
description: Diagnose OneGrid deployments and dependencies, restore data and model flows, manage releases, and decommission environments.
ms.date: 11/23/2026
ms.topic: how-to
---

# OneGrid operational runbook

Part of the [OneGrid landing zone design guide](architecture/design-guide.md).

[Operations guide](operations.md) | [Deployment procedure](deployment-and-data-guide.md)

Use these procedures with the environment inventory and approved operational access.
Start with read-only evidence, identify the failing stage, and verify the restored business
journey after any change.

## Deployment and configuration health

Sign in to the intended subscription and set the environment resource group. These
PowerShell examples inspect deployment state and logs without changing resources:

```powershell
$resourceGroup = 'onegrid-rg'
$appHost = '<app-name>.azurewebsites.net'

az account show --query "{subscription:id,tenant:tenantId}" -o table
az deployment group show -g $resourceGroup -n onegrid --query properties.provisioningState -o tsv
az deployment operation group list -g $resourceGroup -n onegrid --query "[?properties.provisioningState!='Succeeded'].{resource:properties.targetResource.resourceName,state:properties.provisioningState}" -o table
az deployment-scripts show-log -g $resourceGroup --name pcpro-onegrid-provision-app
az deployment-scripts show-log -g $resourceGroup --name pcpro-onegrid-provision-fabric
Invoke-WebRequest -Uri "https://$appHost/api/health"
```

Restrict log access and redact before sharing. Correlate deployment/phase results with
application logs and actual runtime settings. Do not copy resolved secrets or whole
credential-bearing configuration into an incident record.

## Validate network and traffic flows

Use the [enterprise traffic matrix](architecture/enterprise-landing-zone.md#traffic-flow-matrix)
and the environment's actual endpoint inventory. Test from each initiating network:
the gateway, App Service runtime, connector host, forecast job environment, connected
deployment runner, Fabric connection, and user browser. A workstation test doesn't
prove that a different caller can resolve, reach, or authorize the same destination.

From an approved connected Windows diagnostic host, inspect DNS and transport without
changing configuration:

```powershell
$appOrigin = '<app-name>.azurewebsites.net'
$storageHost = '<storage-account>.blob.core.windows.net'
$sqlHost = '<resolved-lakehouse-sql-host>'

Resolve-DnsName -Name $appOrigin
Test-NetConnection -ComputerName $appOrigin -Port 443
Resolve-DnsName -Name $storageHost
Test-NetConnection -ComputerName $storageHost -Port 443
Resolve-DnsName -Name $sqlHost
Test-NetConnection -ComputerName $sqlHost -Port 1433
```

Inspect the selected site's inbound and outbound settings without exposing app secrets:

```powershell
$resourceGroup = '<onegrid-resource-group>'
$appName = '<app-name>'
az resource show --resource-group $resourceGroup --resource-type Microsoft.Web/sites --name $appName --query "properties.{publicNetworkAccess:publicNetworkAccess,virtualNetworkSubnetId:virtualNetworkSubnetId,outboundVnetRouting:outboundVnetRouting}" -o json
```

Then verify the real protocol and identity from the actual caller. TCP success alone
doesn't establish TLS hostname validation, WAF/proxy behavior, or authorization.

| Path | Acceptance test | Failure evidence to retain |
| --- | --- | --- |
| Private ingress | Published host signs in; APIs and WebSocket reconnect work; direct public origin is denied | DNS result, gateway backend/probe status, host/SNI, HTTP result |
| Package bootstrap | Approved restart/release mounts the intended package over the selected route | Package version, startup event, Blob/network denial if any |
| Fabric queries/refresh | DAX/KQL and configured Data Agent succeed; SQL query and Import refresh complete | Item IDs, query/refresh result, source and model timestamps |
| Source ingestion | Connector publishes over the selected AMQP transport and a new curated event appears | Queue/checkpoint, acknowledgment, source event and ingestion times |
| Forecast job | Job pulls its image, retrieves inputs, scores Aurora, exchanges payloads, and publishes output | Execution ID, model/image version, input cycle, output timestamp |
| Service-to-storage | GeoCatalog ingestion and configured Fabric source/shortcut read actual content | Connection identity, storage authorization/network result, resulting item |
| Browser map | Selected basemap, satellite/bathymetry, and glyph requests load on the user's network | Sanitized destination/status; no keys, tokens, or signed URLs |

For SQL, inspect the connection as MSSQL/TDS on TCP 1433, not HTTPS. For Eventstream,
confirm `UseAmqpWebSockets` matches the firewall/proxy policy and retain processed
Eventhouse ingestion. For private endpoints, check the selected next hop as well as DNS:
a default route to a firewall doesn't prove that a private endpoint connection crosses it.

Record UTC test time, environment/release, initiating network, destination, expected route,
identity reference, observed result, and owner. Redact credentials and payloads. Treat
unexecuted checks as pending; architecture review isn't deployed endpoint acceptance.
Require platform/workload approval before changing network policy or restarting services.

## Monitor user journeys and dependencies

| Signal | Evidence |
| --- | --- |
| Application | Host/version, startup, HTTP errors/latency, WebSocket reconnect |
| Identity | Sign-in result, API authorization, role changes, credential expiry |
| Fabric | Capacity state/utilization, DAX/KQL result/latency, workspace/model/database targets |
| Data | Source heartbeat, ingestion checkpoints, newest event, notebook/pipeline result, refresh time |
| AI | Endpoint/deployment/version, throttling, tool queries, grounded answer evaluation |
| Geospatial | Ingestion identity/source permission, STAC results, tile response |
| Weather | Input cycle, image/model version, inference result, job/publication time, normalized schema |
| Cost | Fabric, App Service, model tokens, GPU hours, storage, registry, logs, transfer |

Set thresholds from approved service objectives. An empty storm result can be correct;
check whether the run completed and its inputs/output are current rather than alerting
only because the event count is zero.

## Common incident procedures

| Symptom | Investigate | Restore and verify |
| --- | --- | --- |
| App startup/503 after release | Package location/version, blob access, startup command, Node runtime, port | Apply known-good compatible package/settings; test UI/API and queries |
| Sign-in missing/failing | Client/tenant IDs, registration, callback host, identity/network policy | Restore approved configuration; test permitted and denied data access |
| DAX fails | Capacity state, `PBI_WORKSPACE`, `PBI_DATASET`, runtime grants, model binding/refresh | Correct intended target/access; refresh if needed; verify expected business rows |
| KQL empty/failing | `KUSTO_CLUSTER`, `KUSTO_DATABASE`, viewer grant, ingestion, source heartbeat | Repair correct stage; replay safely; verify latest event and outage query |
| Model data stale | Source completion, SQL metadata, connection credential, refresh history | Repair processing/binding, refresh, compare counts and timestamps |
| Chat `DeploymentNotFound` | `AZURE_AI_ENDPOINT`, `AI_DEFAULT_MODEL`, actual deployment name | Align approved deployment; test a grounded answer and tool query |
| Unauthorized/overbroad answer | User/API policy, runtime query identity, model/data permissions, tools | Contain affected feature, restore access boundary, run denied-access tests |
| Catalog/shortcut access fails | Connection identity, storage RBAC, source/DNS/network settings | Restore approved access; verify both metadata and content retrieval |
| Weather stale/absent | Input retrieval, image, GPU readiness, transfer channel, publication | Repair failing stage; test valid output and age/provenance before marking current |
| Source backlog | Connector host, certificate, outbox, endpoint, capacity/ingest | Restore transport and controlled drain; monitor duplicates/lag and watermark |

Escalate policy and identity issues to their owners. Avoid broad role changes, disabled
authentication, or unapproved policy opt-outs as incident shortcuts.

## Change, release, and rollback

1. Record source commit, package digest/version, settings, Fabric item/schema version, image,
   model version, and identity/connection changes.
2. Validate a compatible release in nonproduction, including access and data freshness.
3. Obtain approvals and promote the intended artifact/configuration.
4. Confirm the host's mounted package and actual query targets.
5. Run representative sign-in, DAX/KQL, imagery, grounded chat, and weather tests.

The source workflow publishes the mutable `app-latest` release. Environment provisioning
can rehost the package in Blob Storage; a GitHub release does not establish which bits a
tenant currently runs. Retain immutable known-good artifacts.

Rollback restores the compatible app package and configuration. If data or model schema
changed incompatibly, follow its recovery plan before reopening the affected journey.
Avoid rerunning all provisioning phases blindly during triage.

## Data and model lifecycle

- Schedule and monitor source processing, scoring, and Import refresh in dependency order.
- Preserve lineage, schema version, source quality, event/checkpoint time, model version,
  input cycle, and publication timestamp.
- Rotate the refresh service-principal secret and connector certificates before expiry;
  test actual refresh/publication after rotation.
- Evaluate AI model/tool changes before promotion and monitor retirement dates.
- Review governance roles, shared runtime identity boundaries, exports, and Data Agent access.
- Distinguish generated/seeded measurements from observed operational data.

## Backup, restore, and decommissioning

**Protect:** source data, Fabric item definitions, SQL/model connections, permission/configuration
records, reference files, app packages, pipeline images, catalog metadata, weather artifacts,
and connector checkpoints. Keep credentials in the approved secret system.

**Restore:** recover the intended items and data, reapply bindings/grants, refresh Import,
reconnect sources, and verify DAX/KQL, data counts, latest observations, imagery, and model
output. Record achieved RTO/RPO. Coordinate regional recovery using the
[multiregion procedure](architecture/multiregion.md#recovery-procedure).

**Decommission:** obtain data-owner approval and satisfy retention. Inventory Azure resources,
Fabric workspaces/items, capacities, Entra registrations, connections, credentials, connector
hosts, and ingestion jobs. Resource-group deletion does not itself remove all SaaS/directory
objects. Remove only workload-owned resources, revoke unused grants/credentials, and retain
required audit evidence. Obtain explicit owner approval before changing shared capacity or
platform resources.
