# OneGrid Day 2 operations runbook

[Day 2 guide](operations.md) | [Documentation home](../README.md) | [Deployment guide](deployment-and-data-guide.md)

> **Scope:** operating guidance to implement around the existing baseline and any approved
> extensions. A complete alert suite, scheduled semantic refresh, immutable release promotion,
> backup policy, and disaster-recovery automation are not provided by this document or
> automatically established by the evaluation template.

## Ownership and service objectives

Assign an application owner/on-call team, Fabric administrator/data owner, AI/model owner,
platform/network owner, and security incident contact. Record support hours, escalation,
maintenance windows, and emergency access procedures.

Set measurable targets before production. For each journey, define availability, latency,
maximum data age, and recovery objectives. Choose thresholds from business needs and load
tests; the repository does not establish a production SLA.

## Monitor user journeys and dependencies

| Signal | Measurement | Response |
| --- | --- | --- |
| Application availability | HTTP status, server errors, request latency, startup/restarts, WebSocket disconnects | Page on sustained journey failure; check package, configuration, and dependencies |
| Authentication/authorization | Sign-in failures, unauthorized API requests, unusual role changes | Investigate denied access and unexpected successful access with identity/security teams |
| Fabric queries | Representative DAX/KQL success and latency, capacity utilization/throttling | Check workspace/item IDs, permissions, capacity state, and query load |
| Data freshness | Latest ingestion/checkpoint and Import-model refresh timestamps | Alert on approved maximum age; repair ingestion/refresh and clearly mark stale data |
| AI chat | Grounded answer success, dependency errors, token use, throttling, evaluation regressions | Check model deployment/settings and data tools; stop unsafe or ungrounded features |
| Weather | Job result, input/output timestamps, model version, inference latency | Inspect input/inference/publication stages; expose stale or unavailable forecasts |
| Geospatial | STAC search, ingestion status, sample tile request | Check catalog availability, ingestion identity, source credentials, and rendering configuration |
| Cost and capacity | Fabric usage, App Service utilization, GPU hours, model tokens, storage/log growth | Investigate budget anomalies; scale only against measured demand |

Centralize structured logs and dependency metrics through approved monitoring destinations.
Redact tokens, secrets, prompts containing restricted data, and sensitive asset information.
Set retention and access policies with the data owner. Test alert delivery and escalation,
not just dashboard rendering.

## Deployment and configuration health

Use read-only diagnostics first. The examples below run in PowerShell with Azure CLI signed
in to the correct subscription. Replace the resource names with your deployment values.
These commands do not change Azure resources.

```powershell
az deployment group show -g <resource-group> -n onegrid --query properties.provisioningState -o tsv
az deployment operation group list -g <resource-group> -n onegrid --query "[?properties.provisioningState!='Succeeded'].{resource:properties.targetResource.resourceName,state:properties.provisioningState}" -o table
az deployment-scripts show-log -g <resource-group> --name pcpro-onegrid-provision-app
az deployment-scripts show-log -g <resource-group> --name pcpro-onegrid-provision-fabric
Invoke-WebRequest -Uri "https://<app-host>/api/health"
```

Restrict access to deployment logs and redact them before sharing. A health endpoint response
is a process-level signal; confirm actual DAX/KQL, authentication, and selected optional
features using the [acceptance checks](deployment-and-data-guide.md#acceptance-checks).

## Common incident procedures

| Symptom | Investigate | Restore and verify |
| --- | --- | --- |
| App fails after a release | Mounted package/version, startup log, app settings, runtime compatibility | Reapply a known-good package and compatible configuration; test sign-in and representative data queries |
| DAX fails or returns stale results | Dataset ID, model permissions, SQL connection binding, refresh history | Correct grants/binding, run an approved refresh, and compare expected counts/timestamps |
| KQL is empty or fails | Eventhouse/database setting, viewer permissions, source ingestion, capacity | Restore the correct target/access/ingestion; check the newest event and actual query results |
| Chat reports `DeploymentNotFound` | Model deployment name and app model settings | Align with the approved deployment; verify a grounded answer with a recorded data query |
| Forecast absent or stale | Job history, input source, GPU endpoint/deployment, storage publication | Repair the failing stage; validate timestamps/provenance before marking forecasts current |
| Shortcut or imagery access fails | Connection identity, storage RBAC, source access, DNS/network changes | Restore approved access and verify both metadata and content retrieval |
| Sign-in unexpectedly absent | App registration, tenant/client IDs, redirect URI, provisioning outcome | Restrict exposure until authentication and denied-access tests pass |

Do not broaden roles, disable authentication, or add policy opt-outs as an incident shortcut.
Escalate policy and identity issues to the accountable platform team.

## Change, release, and rollback

The existing release workflow builds a package for matching `main` changes and publishes
the mutable `app-latest` release. It is not a per-environment production promotion pipeline.
The deployed host can use a rehosted blob package, so a GitHub release does not establish
which bits a tenant is currently running.

Implement a release record with source commit, package digest, model version, configuration,
Fabric item IDs/schema version, and deployment time. Retain known-good immutable packages.
Test in nonproduction, obtain approvals, and explicitly deploy/restart or otherwise refresh
the host through the chosen release mechanism. Recheck all critical journeys afterward.

Rollback requires a compatible combination of app package, settings, and data/model schema.
Define recovery for non-backward-compatible data changes; do not assume reverting code
reverts Fabric data. Avoid blind reruns of the entire provisioner during an incident.

## Data and model lifecycle

- Schedule and monitor Import-model refresh after ingestion or regeneration. Confirm the
  schedule and data-source credentials survive identity rotation.
- Retain source-data provenance, schema versions, telemetry replay checkpoints, forecast
  inputs, model versions, and output timestamps.
- Evaluate AI model changes before promotion. The template pins a version and specifies
  `NoAutoUpgrade`; monitor model retirement dates and plan migration.
- Review the dedicated Import refresh credential and rotate before expiry. Validate binding
  and a complete refresh after rotation.
- Keep sample/synthetic telemetry distinguishable from observed production measurements.

## Operating cadence

| Cadence | Actions | Evidence |
| --- | --- | --- |
| Daily / automated | Critical journey probes, ingestion/refresh/forecast freshness, failed jobs, capacity and cost anomalies | Probe and job history; acknowledged alerts |
| Each release | Scan dependencies, evaluate models/tools, test access and functionality, verify artifact identity, rehearse rollback where affected | Release approval and test results |
| Monthly or policy-defined | Access/privilege review, secret expiry, SKU/quota, retention, policy exceptions, cost sizing | Reviewed inventory and remediation records |
| Risk-defined recovery exercise | Restore data/items, rebuild configuration, test degraded modes and regional failover if implemented | Achieved RTO/RPO and tracked gaps |
| Each incident | Timeline, root cause, data impact, recovery verification, corrective actions | Post-incident review and owned follow-ups |

## Backup, restore, and decommissioning

Protect source data, Fabric item definitions, model connection configuration, app packages,
STAC metadata, identities/permissions as code, and required weather artifacts. Store secrets
only in approved secret systems, not in configuration backups committed to Git.

Test item-specific restore, query rebinding, authorization, semantic refresh, and data
freshness. See [Fabric recovery guidance](https://learn.microsoft.com/fabric/security/reliability-fabric)
and the [multiregion design](architecture/multiregion.md).

Before decommissioning, obtain data-owner approval and satisfy retention requirements.
Deleting an Azure resource group does **not** by itself delete Fabric workspaces/items or
Entra app registrations. Inventory and separately handle those objects, shared capacities,
role assignments, connections, stored credentials, and external ingestion jobs. Never delete
shared platform resources as part of workload cleanup.
