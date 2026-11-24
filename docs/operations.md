# OneGrid Day 2 operations guide

[Documentation home](../README.md) | [Baseline architecture](architecture/baseline.md)

After deploying OneGrid, establish an ongoing operating model for incident triage,
maintenance, upgrades, and troubleshooting. Operations must cover the entire user journey:
application, identity, Fabric, AI, imagery, and weather, not only the web process.

Article structure: [AKS day-2 operations guide](https://learn.microsoft.com/azure/architecture/operator-guides/aks/day-2-operations-guide).
This is the guide/index; detailed OneGrid procedures live in the
[operations runbook](operations-runbook.md). The current host is App Service, not AKS.

> [!IMPORTANT]
> This guidance does not provision a complete alert suite, scheduled semantic refresh,
> immutable promotion, backup policy, or failover automation. Implement and test those
> capabilities for the selected architecture.

## In this article

- [Prerequisites](#prerequisites)
- [Contributors](#contributors)
- [Next steps](#next-steps)

## Prerequisites

- Deploy and understand the [baseline](architecture/baseline.md); complete the
  [acceptance checks](deployment-and-data-guide.md#acceptance-checks).
- For enterprise environments, agree on the
  [platform/workload responsibilities](architecture/enterprise-landing-zone.md#components).
- Assign app/on-call, Fabric/data, AI/model, platform/network, and security contacts.
- Set measurable availability, latency, maximum data age, RTO, and RPO objectives for each
  journey. The evaluation template does not establish a production SLA.
- Establish approved telemetry access, diagnostic retention, emergency access, maintenance
  windows, artifact inventory, and incident/change procedures.
- Distinguish generated/sample measurements from observed operational data.

Use the following operational areas to select the relevant procedure:

| Operational area | OneGrid procedure | Verification |
| --- | --- | --- |
| Triage and troubleshooting | [Read-only deployment health](operations-runbook.md#deployment-and-configuration-health) and [incident procedures](operations-runbook.md#common-incident-procedures) | Restore the affected data-backed journey, not just HTTP health |
| Monitoring | [User-journey and dependency signals](operations-runbook.md#monitor-user-journeys-and-dependencies) | Prove alert delivery, escalation, and freshness detection |
| Maintenance | [Data/model lifecycle](operations-runbook.md#data-and-model-lifecycle) and [operating cadence](operations-runbook.md#operating-cadence) | Refresh, identity rotation, access review, and capacity checks succeed |
| Release and upgrade | [Change, release, and rollback](operations-runbook.md#change-release-and-rollback) | Record deployed artifact/configuration identity and test compatible rollback |
| Recovery | [Backup/restore](operations-runbook.md#backup-restore-and-decommissioning) and [multiregion design](architecture/multiregion.md) | Measure achieved RTO/RPO and verify recovered data |
| Decommissioning | [Cleanup checklist](operations-runbook.md#backup-restore-and-decommissioning) | Handle Fabric/Entra objects and shared resources separately from Azure RG deletion |

## Contributors

Project-maintained adaptation by the
[OneGrid repository contributors](https://github.com/paulshaheen/OneGrid/graphs/contributors).
The Microsoft article supplies the guide structure, not authorship or endorsement.

## Next steps

Start with the [OneGrid operations runbook](operations-runbook.md). Implement the selected
procedures, exercise them in nonproduction, and retain results with accountable owners.

### Other articles in this series

- [Baseline architecture](architecture/baseline.md).
- [Enterprise integration and change management](architecture/enterprise-landing-zone.md).
- [Fabric security and governance](architecture/fabric.md).
- [Regulated workload controls](architecture/regulated-workload.md).
- [Multiregion recovery](architecture/multiregion.md).
- [Deployment and acceptance checks](deployment-and-data-guide.md).
