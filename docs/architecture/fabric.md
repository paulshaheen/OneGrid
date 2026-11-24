# Security and governance for OneGrid in Microsoft Fabric

[Documentation home](../../README.md) | [Baseline](baseline.md) | [Enterprise integration](enterprise-landing-zone.md)

OneGrid uses Fabric as a SaaS data plane: workspace, Lakehouse, Eventhouse/KQL, Import
semantic model, and optional Data Agent. Azure resource-group permissions do not establish
Fabric tenant, workspace, item, or data authorization.

Article structure: [Security in Microsoft Fabric](https://learn.microsoft.com/fabric/security/security-overview).
The sections apply that service guidance to OneGrid. Enterprise controls below require
configuration and validation; the evaluation template does not establish all of them.

## In this article

- [Authenticate](#authenticate)
- [Understand network security](#understand-network-security)
- [Secure Data](#secure-data)
- [Access data](#access-data)
- [Protect data](#protect-data)
- [Recover data](#recover-data)
- [Administer Fabric](#administer-fabric)
- [Audit Logs](#audit-logs)
- [Capabilities](#capabilities)
- [Related content](#related-content)

## Authenticate

Separate the signed-in user, app runtime managed identity, Fabric provisioning identity,
workspace identity/cloud connections, and Import refresh service principal. Inventory the
permissions and credential lifecycle for each.

Enable the necessary tenant settings only for approved identities/groups. User sign-in at
the app does not automatically make backend DAX/KQL requests execute as that user.

## Understand network security

Fabric is not deployed inside the workload's VNet. Evaluate inbound and outbound paths
separately, and test feature support for the selected capacity, region, and item types.

### Inbound network security

Agree on tenant access, Conditional Access, and supported Fabric Private Link configuration
with Fabric administrators. Test app APIs, browser access, SQL analytics, DAX/KQL, automation,
and operator access under the restrictions. Do not assume an App Service private endpoint
also restricts Fabric.

### Outbound network security

Choose supported managed private endpoints, managed VNets, or trusted workspace access for
the actual Fabric-to-source path. These capabilities are not interchangeable. Verify
shortcuts, notebooks, SQL refresh connections, and ingestion under the chosen source
firewall/storage controls.

## Secure Data

Classify asset coordinates, maintenance records, operational telemetry, manuals, prompts,
and derived forecasts. Define approved processing, retention, sharing, and export boundaries.
Service encryption does not replace correct permissions or data minimization.

### Understand tenants in multiple geographies

Document capacity/workspace placement and the geography of source data, copies, shortcuts,
model processing, and diagnostics. Multi-geo placement is not a disaster-recovery plan.
Validate the actual feature and residency requirements rather than inferring them from an
Azure resource group's region.

## Access data

### Workspace roles

Separate administrators, developers, runtime query identities, and refresh identities.
Grant the documented workspace/item permissions needed for each path, with periodic review.
Do not grant all users workspace administration to solve a data access issue.

### Share items

Approve reports, semantic models, Data Agent access, links, exports, and external sharing.
Trace access to underlying data and derived results, not just the visible report or page.

### Limit access

Test the effective authorization of DAX, KQL, SQL, OneLake, chat tools, and exports. A shared
backend identity can have broader access than the user; enforce the application's authorized
data boundary and verify negative tests. Do not claim user-specific RLS merely because the
browser signed in.

## Protect data

Use the organization's Fabric/Purview classification, sensitivity labels, lineage, retention,
and DLP standards where supported. Minimize restricted data in prompts and diagnostic logs.
Approve preview or unavailable controls explicitly; exclude features that cannot meet a
mandatory requirement.

## Recover data

Protect source data, item definitions, model connection/binding configuration, grants, and
ingestion checkpoints. Test item-specific restoration, semantic model refresh, KQL queries,
counts, and timestamps.

Capacity DR settings and Power BI continuity do not imply every Fabric item has identical
recovery behavior. Follow [Fabric reliability](https://learn.microsoft.com/fabric/security/reliability-fabric)
and [experience-specific guidance](https://learn.microsoft.com/fabric/security/experience-specific-guidance).
Use the [OneGrid multiregion design](multiregion.md) to coordinate application recovery.

## Administer Fabric

Assign tenant, capacity, workspace, data, and on-call owners. Monitor capacity contention,
query failures, Import refresh, credential expiry, and ingestion lag. Schedule refresh
after data updates; a successful provisioning-time refresh is not a continuous schedule.

The current app path uses Import. The repository records a Direct Lake/service-identity
query limitation; validate any replacement against the exact runtime identity/query path.

## Audit Logs

Collect the supported administrative and activity/audit signals required by policy. Correlate
identity, item/workspace, application request, deployment, refresh, and ingestion events.
Protect evidence access and retention; redact tokens and restricted data. Verify that
required events are actually captured rather than assuming app logs cover all SaaS activity.

## Capabilities

| Capability | OneGrid baseline | Enterprise validation |
| --- | --- | --- |
| Workspace/data artifacts | Provisioner creates the selected plane and artifacts | Confirm intended tenant/capacity/items and permissions |
| Import refresh | Unified path can bind and refresh using a dedicated identity | Schedule, rotate credentials, alert, and test recovery |
| Network isolation | No complete private Fabric integration profile supplied | Validate inbound/outbound feature compatibility and every dependency path |
| Data governance | Governance artifacts exist; effective access depends on configuration | Test roles, labels, lineage, sharing, exports, and actual query identities |
| Disaster recovery | No end-to-end automated failover supplied | Implement and rehearse item-specific recovery against RTO/RPO |
| Operations | Component provisioning is not a full alert/SLO suite | Establish [Day 2 operations](../operations.md) and escalation |

## Related content

- [Fabric security overview](https://learn.microsoft.com/fabric/security/security-overview).
- [Fabric adoption roadmap](https://learn.microsoft.com/power-bi/guidance/fabric-adoption-roadmap).
- [OneGrid Fabric provisioning implementation](../implementations.md#onegrid-implementation-map).
- [Regulated control review](regulated-workload.md).
