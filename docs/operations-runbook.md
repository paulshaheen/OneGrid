---
title: OneGrid operational runbook
description: Diagnose OneGrid deployments and dependencies, restore data and model flows, manage releases, run BCDR drills, fail back after regional recovery, and decommission environments.
ms.date: 11/24/2026
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

## BCDR drills

Drills prove that the [multiregion recovery](architecture/multiregion.md) design meets its
objectives. Run them on the policy-defined schedule and after any change to the regional
template, Fabric items, connectors, or Front Door configuration. Each drill uses the
[Fail over](architecture/multiregion.md#fail-over) steps and gates; start read-only and change
only what the drill's scope allows.

| Drill | Scope | Production impact | Exit criteria |
| --- | --- | --- | --- |
| Tabletop | Walk through declare, fence, recover, rebind, gate, cut over, observe, reconcile, and fail back with every owner | None | Each step has an owner, a tested command or runbook, and a decision threshold |
| Full nonproduction failover | Fail a complete nonproduction environment over to its recovery region, then fail back | None | Every cutover gate passes in both directions; achieved RTO and RPO recorded per journey |
| Partial production test | Exercise the production recovery stamp through a test route, with the recovery publisher disabled | None to users; replication and the primary publisher keep running | Recovery app passes the origin, application, data, and inference gates on the test route |

### Run a partial production test

1. Confirm the primary is healthy and the recovery forecast job and recovery origin are
   disabled. Leave replication running; the recovery Blob containers stay read-only, so
   features that write to them, such as uploads, are expected to fail in the test.
2. Give testers a test route to the recovery origin, for example a separate Front Door
   endpoint or route with its own origin group that contains only the recovery origin and is
   restricted to the test group. Don't enable the recovery origin in the production origin group.
3. Apply the recovery configuration, bind the recovery Fabric items, and refresh the recovery
   Import model from the recovered or copied data.
4. Run the origin access, application, data, and inference gates through the test route.
   Test Aurora by scoring without publishing; the publication ownership gate is out of scope
   because the recovery publisher stays disabled.
5. Remove the test route, record results, and return the recovery stamp to standby.

### Check stamp configuration drift

Compare the two regional apps without printing setting values. Run this from the connected
administration host; it lists only setting names that differ:

```powershell
$primary  = @{ ResourceGroup = '<primary-resource-group>';  App = '<primary-app-name>' }
$recovery = @{ ResourceGroup = '<recovery-resource-group>'; App = '<recovery-app-name>' }

function Get-AppSettingMap($site) {
  $map = @{}
  az webapp config appsettings list -g $site.ResourceGroup -n $site.App -o json |
    ConvertFrom-Json | ForEach-Object { $map[$_.name] = $_.value }
  $map
}

$p = Get-AppSettingMap $primary
$r = Get-AppSettingMap $recovery

# Settings that exist in only one region
Compare-Object @($p.Keys) @($r.Keys) | Select-Object InputObject, SideIndicator

# Settings that must match in both regions
'ENTRA_CLIENT_ID','ENTRA_TENANT_ID','UPLOAD_CONTAINER_NAME','REPORT_PORT','WEBSITES_PORT',
'REPORT_API_URL','REPORT_API_ENABLED','WEBSITE_NODE_DEFAULT_VERSION','ONEGRID_MODULES' |
  Where-Object { $p[$_] -ne $r[$_] }

# Regional settings where the recovery app still points at a primary value
'KUSTO_CLUSTER','PBI_WORKSPACE','PBI_DATASET','DATA_AGENT_ID','AZURE_AI_ENDPOINT',
'FOUNDRY_ENDPOINT','GEOCATALOG_URI','UPLOAD_CONTAINER_URL','SAMPLE_CONTAINER_URL','AURORA_ENDPOINT' |
  Where-Object { $p[$_] -and $p[$_] -eq $r[$_] }
```

Also compare each forecast job's environment variable names and image, both regions'
template parameter files, Front Door origin state, and the connector's staged recovery
`Fabric:FabricNamespaceFqdn`. Treat any difference that isn't in the
[per-region configuration](architecture/multiregion.md#per-region-configuration) table as drift.

### Keep the standby ready

- Deploy every release (package, settings, template, image, Fabric item definitions) to both
  stamps, and record the version in each.
- Rotate the refresh service-principal secret and connector certificates in both regions,
  and renew certificates on both origins before expiry.
- Confirm recovery-region Microsoft Foundry and GPU quota, and that the approved model and
  version are still available there.
- Keep the recovery registry image current, by replication or by rebuild.
- Stage connector configuration for the recovery Eventstream endpoint without activating it.
- Confirm that replication is healthy and that the recovery package URL is readable.

### Record results

For each drill, record the UTC start and end, scope, environment and release, each journey's
achieved RTO, RPO, and data age against its objective, each gate result, deviations from the
procedure, and owned remediation with a due date. Treat a drill that didn't reach a gate as a
failed drill for that gate.

## Fail back

Fail back is a planned change; schedule it in an approved window after the incident is
closed. Follow the [Fail back](architecture/multiregion.md#fail-back) procedure and verify:

| Check | Pass condition |
| --- | --- |
| Primary health | Azure Service Health reports the primary region healthy; the primary stamp matches the template with its job and origin disabled |
| Reverse copy | Pending replication from the recovery to the primary account is zero; Lakehouse, Eventhouse, and GeoCatalog changes since cutover are in the primary |
| Recovery publisher fenced | The recovery forecast job is stopped and connectors aren't publishing to the recovery Eventstream; checkpoints are recorded |
| Primary rebound | Primary configuration applied, connectors repointed and replayed once, Import model refreshed |
| Gates on the primary | Every cutover acceptance check passes against the primary region |
| Origins swapped | Primary origin enabled and recovery origin disabled; direct public-origin access still denied |
| Re-protected | Replication from the primary to the recovery region restored; recovery stamp back in standby |

Record achieved fail-back time and any data reconciled, and update the drill record.

## Backup, restore, and decommissioning

**Protect:** source data, Fabric item definitions, SQL/model connections, permission/configuration
records, reference files, app packages, pipeline images, catalog metadata, weather artifacts,
and connector checkpoints. Keep credentials in the approved secret system.

**Restore:** recover the intended items and data, reapply bindings/grants, refresh Import,
reconnect sources, and verify DAX/KQL, data counts, latest observations, imagery, and model
output. Record achieved RTO/RPO. Coordinate regional recovery using the
[multiregion failover procedure](architecture/multiregion.md#fail-over), and exercise it
through [BCDR drills](#bcdr-drills).

**Decommission:** obtain data-owner approval and satisfy retention. Inventory Azure resources,
Fabric workspaces/items, capacities, Entra registrations, connections, credentials, connector
hosts, and ingestion jobs. Resource-group deletion does not itself remove all SaaS/directory
objects. Remove only workload-owned resources, revoke unused grants/credentials, and retain
required audit evidence. Obtain explicit owner approval before changing shared capacity or
platform resources.
