# OneGrid and Microsoft reference implementations

[Documentation home](../README.md)

## Implementation status

Only the existing evaluation baseline has repository deployment entry points. The
[enterprise](architecture/enterprise-landing-zone.md),
[regulated](architecture/regulated-workload.md), and
[multiregion](architecture/multiregion.md) documents describe work to implement and validate;
there are no corresponding deployment profiles or switches.

## OneGrid implementation map

| Artifact | Responsibility | Important boundary |
| --- | --- | --- |
| [Bicep source](../planetary-computer-pro-poc/deploy/azure/main.bicep) | Azure resources, component selection, identities, deployment-script orchestration | Resource-group scoped; not a platform landing zone deployment |
| [Compiled ARM template](../planetary-computer-pro-poc/deploy/azure/azuredeploy.json) | Template used by the portal deployment | Keep synchronized with Bicep when infrastructure changes |
| [Portal form](../planetary-computer-pro-poc/deploy/azure/createUiDefinition.json) | Deployment choices | Component selection is not an enterprise-security profile |
| [Copilot deployment runbook](../DEPLOY-WITH-COPILOT.md) | Prerequisites, choices, permission checks, deployment and verification | Deployment requires approval and creates billable resources |
| [Fabric/app phase provisioner](../planetary-computer-pro-poc/infra/deploy.ps1) | Fabric items, models, data, app configuration, and permissions | Azure RBAC does not replace Fabric tenant/workspace authorization |
| [Sample configuration](../planetary-computer-pro-poc/infra/config.sample.json) | Provisioner configuration shape | Never commit resolved tenant secrets or production configuration |
| [Application source](../OGE-OneGrid/) | Report API, web UI, chat, and Fabric artifacts | Current production host is App Service, not AKS |
| [Release workflow](../.github/workflows/release-onegrid-app.yml) | Build and publish `onegrid-app.zip` | Publishes the mutable `app-latest` release on matching `main` pushes or manual dispatch; publication alone does not prove a running tenant app was updated |
| [Weather pipeline](../planetary-computer-pro-poc/aurora/README.md) | Aurora input, inference, and output workflows | Optional, quota-dependent; verify actual forecast provenance |
| [Asset samples](../planetary-computer-pro-poc/samples/) | CSV/GeoJSON evaluation data | Samples are not production asset inventory |

## Microsoft reference implementations

These are external reference implementations, not vendored OneGrid components. Review their
current scope, prerequisites, support guidance, and license. Use pinned versions when
adopting code; do not deploy multiple overlapping foundations into the same environment.

| Area | Microsoft Learn guidance | GitHub implementation | How to use with OneGrid |
| --- | --- | --- | --- |
| Platform landing zone | [Implementation options](https://learn.microsoft.com/azure/cloud-adoption-framework/ready/landing-zone/implementation-options) | [Azure/ALZ-PowerShell-Module](https://github.com/Azure/ALZ-PowerShell-Module) | Platform team establishes or evolves shared foundations independently of the workload |
| AI landing zone | [Foundry enterprise integration](https://learn.microsoft.com/azure/architecture/ai-ml/architecture/baseline-microsoft-foundry-landing-zone) | [Azure/AI-Landing-Zones](https://github.com/Azure/AI-Landing-Zones) | Evaluate AI-specific design and deployment options; reconcile with existing platform ownership |
| Foundry chat baseline | [Baseline architecture](https://learn.microsoft.com/azure/architecture/ai-ml/architecture/baseline-microsoft-foundry-chat) | [Azure-Samples/microsoft-foundry-baseline](https://github.com/Azure-Samples/microsoft-foundry-baseline) | Reference for private connectivity and managed agent architecture; not a drop-in replacement for OneGrid's app-hosted agent |
| AKS baseline | [Baseline architecture](https://learn.microsoft.com/azure/architecture/reference-architectures/containers/aks/baseline-aks) | [mspnp/aks-baseline](https://github.com/mspnp/aks-baseline) | Starting point only if the workload moves to AKS; application packaging and integrations remain work |
| Planetary Computer Pro | [Product documentation](https://learn.microsoft.com/azure/planetary-computer/) | [Azure/microsoft-planetary-computer-pro](https://github.com/Azure/microsoft-planetary-computer-pro) | Microsoft's original notebooks, SDK, and storm-impact sample |

For **Fabric**, use the [adoption roadmap](https://learn.microsoft.com/power-bi/guidance/fabric-adoption-roadmap),
[security guidance](https://learn.microsoft.com/fabric/security/security-overview), and OneGrid's
Fabric provisioner above. Do not confuse an open-mirroring file "landing zone" with an Azure
platform/workload landing zone. No separate Microsoft Fabric landing zone implementation is
bundled or claimed here.

For **regulated AKS** and **multiregion AKS**, use the linked
[regulated](https://learn.microsoft.com/azure/aks/pci-intro) and
[multiregion](https://learn.microsoft.com/azure/architecture/reference-architectures/containers/aks-multi-region/aks-multi-cluster)
guidance to locate current supporting assets. OneGrid does not supply these clusters.

## Production implementation backlog

Before calling an enterprise variant deployable, provide:

1. Parameterized, policy-compatible network and identity integration with existing resources.
2. A reviewed deployment path that works from the approved private runner environment.
3. Versioned packages/configuration and an explicit application rollout/rollback procedure.
4. Automated functional and denied-access tests for app, Fabric, AI, and optional weather.
5. Provisioned diagnostics, alerts, budgets, and recovery controls with accountable owners.
6. Evidence that the relevant [enterprise gates](architecture/enterprise-landing-zone.md#exit-criteria)
   pass. Add regulated/multiregion evidence only when those variants are actually implemented.

## Documentation structure

Each article below follows the source article's **ordered H2/H3 structure**, rather than a
single generic architecture template. Body text, component inventories, diagrams, decisions,
and procedures describe OneGrid. Microsoft authors/contributors, site feedback controls,
and automatically generated "Additional resources" panels are not copied.

| OneGrid article | Microsoft Learn structural source | Structure retained |
| --- | --- | --- |
| [Landing page](../README.md) | [What is an Azure landing zone?](https://learn.microsoft.com/azure/cloud-adoption-framework/ready/landing-zone/) | Architecture with conceptual/reference views; platform; workload; technology adoption; next steps |
| [Baseline](architecture/baseline.md) | [Foundry chat baseline](https://learn.microsoft.com/azure/architecture/ai-ml/architecture/baseline-microsoft-foundry-chat) | Architecture with workflow/components/model selection/alternatives; five-pillar considerations; deployment; contributors; next step; related resources |
| [Enterprise integration](architecture/enterprise-landing-zone.md) | [Foundry in an Azure landing zone](https://learn.microsoft.com/azure/architecture/ai-ml/architecture/baseline-microsoft-foundry-landing-zone) | Article-layout matrix; architecture; subscription; compute; networking; developer access; monitoring; policy; change management; enterprise architecture; five pillars; end matter |
| [Regulated workload](architecture/regulated-workload.md) | [Regulated AKS introduction](https://learn.microsoft.com/azure/aks/pci-intro) | Shared responsibility; before you begin; control-series overview; next steps |
| [Multiregion](architecture/multiregion.md) | [AKS multiregion baseline](https://learn.microsoft.com/azure/architecture/reference-architectures/containers/aks-multi-region/aks-multi-cluster) | Architecture; components; alternatives; geode/stamp patterns; ordered operational considerations; next steps; related resources |
| [Fabric](architecture/fabric.md) | [Fabric security overview](https://learn.microsoft.com/fabric/security/security-overview) | Authentication; inbound/outbound networking; geography; workspace/sharing/access; protection; recovery; administration; audit; capabilities; related content |
| [Day 2 guide](operations.md) | [AKS Day 2 guide](https://learn.microsoft.com/azure/architecture/operator-guides/aks/day-2-operations-guide) | Prerequisites; contributors; next steps and other articles in the series |

H4 sections add OneGrid-specific implementation detail without replacing the source H2/H3
outline. The AKS multiregion article's cluster-bootstrap heading is retained and explicitly
distinguishes the current App Service deployment from a future AKS host. The detailed
[operations runbook](operations-runbook.md), this implementation catalog, and the
[deployment/data guide](deployment-and-data-guide.md) are project procedures, not claimed
replicas of Microsoft Learn articles.
