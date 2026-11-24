# OneGrid architecture diagrams

These diagrams describe the OneGrid solution and its enterprise, regulated, and recovery
implementations. They use official Azure, Microsoft Entra, and Microsoft Fabric icons.

## Views

| View | Scalable image | PNG preview |
| --- | --- | --- |
| Baseline and logical architecture | [SVG](onegrid-logical-architecture.svg) | [PNG](../onegrid-logical-architecture.png) |
| Fabric data and analytics | [SVG](onegrid-fabric.svg) | [PNG](onegrid-fabric.png) |
| Enterprise landing zone | [SVG](onegrid-enterprise-landing-zone.svg) | [PNG](onegrid-enterprise-landing-zone.png) |
| Regulated workload | [SVG](onegrid-regulated-workload.svg) | [PNG](onegrid-regulated-workload.png) |
| Multiregion recovery | [SVG](onegrid-multiregion.svg) | [PNG](onegrid-multiregion.png) |

Open [onegrid-architecture.drawio](onegrid-architecture.drawio) in diagrams.net or a compatible
draw.io editor. It contains five named pages. Service groups, boundaries, text, icons, and connectors
are separate editable objects. Services use icon-first notation, not boxed component cards.
Boxes denote actual workspace, network, subnet, source, application, or recovery boundaries.
Connectors bind to service groups at the icon perimeter, so endpoints follow the icons when
you move a group. Keep publication changes in the builder and regenerate the artifacts.

## Generate and validate

Python 3.10 or later builds SVGs and the native draw.io document using the standard library:

```powershell
python .\docs\diagrams\build_architecture_diagrams.py
python .\docs\diagrams\build_architecture_diagrams.py --check
python -m unittest discover -s .\docs\diagrams -p "test_*.py"
```

PNG publication output is rendered by the actual draw.io Desktop export engine. Install
[draw.io Desktop](https://github.com/jgraph/drawio-desktop/releases) or use its portable
distribution, then supply the executable path (version 27.0.2 or later):

```powershell
$drawio = 'C:\Program Files\draw.io\draw.io.exe'
python .\docs\diagrams\build_architecture_diagrams.py --png --drawio $drawio
python .\docs\diagrams\build_architecture_diagrams.py --png --drawio $drawio --check
```

Use Segoe UI on the publication machine. PNG text rasterization depends on installed fonts;
SVG and draw.io generation is deterministic across machines. PNGs are 2,400 pixels wide.
The baseline preview preserves its existing location for README links.

The builder creates native `mxGraphModel` XML, the diagram model accepted by the
[draw.io load API](https://www.drawio.com/docs/reference/embed-mode/). Publication PNGs use
the desktop CLI's `--export`, `--page-index`, `--size page`, and `--format png` API, not a
generic SVG screenshot. Export was verified with draw.io Desktop 32.7.4.
SVG icons are embedded, so the SVG and draw.io files are self-contained. Rendering stays
local; no diagram content is submitted to a hosted renderer.

Validation checks official-icon hashes, XML parsing, unique object IDs, parent containment,
node overlap, icon-attached connector endpoints, orthogonal routes, and connectors crossing
unrelated services. Unit tests cover the generated formats, key flow directions, private-network
boundaries, query/refresh separation, and recovery gating.

## Read the flows

| Line | Meaning |
| --- | --- |
| Blue | Initiator of a query or API request; response traffic is omitted |
| Green | Data movement or persisted/published output |
| Dashed orange | Provisioning, configuration, or recovery control |
| Dashed purple | Identity and authorization, not an inline data proxy |
| Dashed gray | Diagnostic export outside the user request path |
| Dashed blue | Configured shortcut access or gated standby traffic, as labeled by the view |
| Dashed green | Explicitly configured copy/recovery workflow |

The logical view represents the complete enabled solution; ARM parameters select individual
planes. The enterprise view adds networking owned by the enterprise implementation.
App Service and Fabric remain service-hosted, outside the customer subnets. The multiregion
view shows recovery targets and release gates rather than treating two web endpoints as
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

| Boundary | Applied rule | Microsoft Learn service guidance |
| --- | --- | --- |
| App ingress and egress | Private endpoint handles inbound; VNet integration handles outbound | [App Service VNet integration](https://learn.microsoft.com/azure/app-service/overview-vnet-integration) |
| App bootstrap | Validate application and configuration traffic, including package and token dependencies | [App Service routing](https://learn.microsoft.com/azure/app-service/configure-vnet-integration-routing), [Run from package](https://learn.microsoft.com/azure/app-service/deploy-run-package) |
| Fabric SaaS | Private Link secures inbound client access; source access is configured independently | [Fabric Private Link](https://learn.microsoft.com/fabric/security/security-private-links-overview) |
| Eventstream | Publish and bind the Eventhouse destination and mapping before source producers | [Eventhouse destination](https://learn.microsoft.com/fabric/real-time-intelligence/event-streams/add-destination-kql-database) |
| Aurora inference | Workspace private endpoint handles managed-endpoint inbound; managed network handles deployment outbound | [Secure managed online endpoints](https://learn.microsoft.com/azure/machine-learning/how-to-secure-online-endpoint?view=azureml-api-2) |
| GeoCatalog | Associate ingestion identity, grant Blob read access, and configure the container ingestion source | [Managed identity ingestion](https://learn.microsoft.com/azure/planetary-computer/set-up-ingestion-credentials-managed-identity) |
| Forecast job | Scheduled/on-demand finite execution is separate from the managed online endpoint | [Container Apps jobs](https://learn.microsoft.com/azure/container-apps/jobs) |
| Regional ingress | Restrict direct origins and gate traffic on workload readiness | [Front Door origin security](https://learn.microsoft.com/azure/frontdoor/origin-security) |
| Fabric recovery | Select recovery mechanisms per item and capacity; recover bindings and operational data | [Fabric reliability](https://learn.microsoft.com/fabric/security/reliability-fabric) |

Use the [deployment acceptance steps](../deployment-and-data-guide.md) and
[operations runbook](../operations-runbook.md) to validate deployed endpoint reachability,
authorization, data freshness, and recovery behavior.

## Icon sources and terms

The [asset manifest](assets/manifest.json) records the source archive, exact archive member,
and SHA-256 for each unmodified icon. The Fabric archive URL is pinned to a source commit.
Only the selected icon files are included.

- [Azure architecture icons and terms](https://learn.microsoft.com/azure/architecture/icons/)
- [Microsoft Entra architecture icons and terms](https://learn.microsoft.com/entra/architecture/architecture-icons)
- [Microsoft Fabric icons and terms](https://learn.microsoft.com/fabric/fundamentals/icons)

Microsoft permits these icons in architectural diagrams, training materials, and
documentation. You can copy, distribute, and display them only for the permitted use unless
Microsoft grants explicit permission. Microsoft reserves all other rights. Keep product
names near icons; don't crop, flip, rotate, distort, or use them as OneGrid branding.
These icon permissions don't relicense the icons under the repository's code license.
