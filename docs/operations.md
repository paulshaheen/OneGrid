---
title: Day 2 operations for OneGrid
description: Operate OneGrid application, Fabric ingestion and models, geospatial services, AI inference, and Aurora forecast publication.
ms.date: 11/23/2026
ms.topic: conceptual
---

# OneGrid Day 2 operations

[Solution overview](../README.md) | [Operational procedures](operations-runbook.md)

Day 2 operations maintain the user journeys established by deployment: asset investigation,
real-time monitoring, maintenance prioritization, weather exposure, and grounded AI answers.
Monitor the application and its dependencies as a system rather than treating HTTP health
as evidence that every data/model path works.

## Prerequisites

- Complete [deployment acceptance](deployment-and-data-guide.md#acceptance-checks).
- Record environments, resource/item IDs, settings, source/package/model versions, identities,
  permissions, source modes, data owners, and support contacts.
- Set availability, latency, maximum data age, RTO, and RPO objectives for each journey.
- Approve log destinations/retention, alert routing, operational access, change windows,
  credential lifecycle, rollback, and restoration.

## Operating model

| Owner | Accountabilities |
| --- | --- |
| Application/on-call | Availability, APIs, WebSocket, package/configuration, user journeys |
| Fabric/data | Capacity, source ingestion, notebooks, SQL metadata, semantic refresh, DAX/KQL, data quality |
| AI/weather | Model version/quota, tools/evaluations, inference, job cycles, forecast provenance |
| Platform/network | Connectivity, DNS, identity guardrails, privileged access, shared diagnostics |
| Security/data governance | Access reviews, classification, logs/evidence, incident coordination |

Agree on escalation across teams. A DAX failure might be capacity, identity, model binding,
or source freshness; a weather issue might be input, GPU inference, tracking, or publication.
Assign an incident owner even when investigation crosses service boundaries.

## Monitor the complete journey

| Journey | Signals | Required response |
| --- | --- | --- |
| App and user access | Requests/errors/latency, restarts, sign-in, API denials, WebSocket connectivity | Restore the intended host/version and authorized user path |
| Streaming operations | Connector queue/heartbeat, Eventstream delivery, `PiEventsRaw`/`PiEvents` lag, KQL | Repair source/transport/ingestion and replay buffered data |
| Business and reliability | Notebook/pipeline result, source quality, model binding/refresh, DAX | Restore processing and prove expected counts/timestamps |
| Geospatial | Source permissions, ingestion status, STAC search, tile rendering | Restore authorized source/catalog/render path |
| AI answers | Model errors/throttling, tool success, grounded-answer evaluations, token cost | Restore correct model/tools and prevent unauthorized grounding |
| Weather | Input cycle, job result, GPU inference, output age/schema, detected events | Repair the failing stage and label stale/unavailable output |
| Governance | Identity/role changes, secret/certificate expiry, activity/audit evidence | Remediate access drift and retain the review trail |

Centralize approved diagnostics and redact credentials, tokens, restricted prompts, and
sensitive asset details. Test alert delivery and escalation, not only dashboards.

## Maintain data, identities, and models

Schedule source processing, scoring, and Import refresh as an explicit chain. Check
completion and data age. Keep SQL/model bindings and runtime query targets aligned with
the current workspace and schema.

Review app, provisioner, refresh, ingestion, workspace-connection, and forecast identities.
Rotate refresh secrets and connector certificates before expiry, then test the complete
dependent flow.

Track model/version retirement and quota. Evaluate model, prompt, grounding, and tool changes
before promotion. Preserve forecast provenance and distinguish operational observations from
generated or seeded values.

## Release and recover

The release record includes app package, source commit, configuration, Fabric schema/model,
connection/permission changes, pipeline image, and model version. Promote a tested compatible
set and retain known-good artifacts.

After rollout, verify app/sign-in, DAX/KQL, refresh, optional imagery, AI tools, and weather
publication. Rollback must account for data/model compatibility, not just package replacement.

Protect source data, item definitions, connections, settings, permissions, reference files,
packages, and connector checkpoints. Exercise restore and measure achieved RTO/RPO. For
regional failure, coordinate [multiregion recovery](architecture/multiregion.md) with
application routing and single-publisher ownership.

## Operational cadence

| Frequency | Work |
| --- | --- |
| Continuous | Journey probes, error/latency, source/refresh/forecast freshness, job failure, capacity, budgets |
| Each release | Compatibility, access, grounded-answer evaluation, artifact identity, rollout/rollback checks |
| Policy-defined review | Access/privileges, identity expiry, policy exceptions, retention, capacity/quota, costs |
| Recovery exercise | Data/item restore, rebinding, replay, model readiness, degraded mode, regional cutover if configured |
| After an incident | Timeline, cause, data impact, recovery evidence, owned corrective actions |

## Operational procedures

Use the [OneGrid runbook](operations-runbook.md) for read-only diagnostics, symptom-based
triage, release/rollback, data/model lifecycle, restore, and decommissioning. Record the
result of each action and recheck the affected business journey before closing an incident.
