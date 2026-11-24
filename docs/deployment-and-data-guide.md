# Deploy OneGrid and load evaluation data

[Documentation home](../README.md) | [Baseline architecture](architecture/baseline.md)

## Choose the supported path

Use [Deploy OneGrid with GitHub Copilot](../DEPLOY-WITH-COPILOT.md) as the current procedural
runbook. It deploys the same compiled template as the portal button and covers permissions,
component choices, quota, validation, deployment, monitoring, and smoke tests.

For a governed enterprise subscription, complete the
[enterprise integration design](architecture/enterprise-landing-zone.md) first. The evaluation
template can conflict with policies that deny public networking or shared-key helper storage.
There is no enterprise/regulated/multiregion parameter that fixes these incompatibilities.

## Prerequisites and choices

| Area | What to establish before deployment |
| --- | --- |
| Azure permissions | Rights to create resources and role assignments in the target scope; the runbook uses an Owner-based bootstrap |
| Resource providers | Providers for selected services; see the runbook's prerequisite checks |
| Region and quota | Current template accepts `eastus`, `northcentralus`, `westeurope`, `canadacentral`, and `uksouth`; validate every selected service, SKU, model, and quota |
| Fabric | Tenant settings allowing the deployment identity, capacity rights, and an existing capacity or quota/approval to create one |
| Entra sign-in | Approved existing SPA registration and callback, or permission for the provisioner to create one |
| Import refresh | Approved refresh service principal, or approved directory permissions for creation; secure any supplied secret outside Git |
| Weather inference | Optional Aurora model asset, model terms, A100 quota, and a successful GPU deployment |
| Cost | Budget for Fabric, App Service, storage, model usage, and optional GPU/scheduling resources |

The full OneGrid app depends on the Fabric plane and sample storage in the current template.
Some dependent components are skipped when prerequisites are disabled; review actual
deployment outputs rather than assuming every selected feature exists.

Common template choices include:

- `deployGeoCatalog`: optional imagery/catalog functionality.
- `deploySampleStorage`: storage and ingestion identity.
- `deployAiAgent`: Azure OpenAI model for chat.
- `deployFabricPlane`, `createFabricCapacity`, `fabricCapacityId`: data-plane provisioning.
- `deployOneGridApp`, `oneGridModules`, `chatAgentAppServiceSku`: app and visible modules.
- `deployUnifiedModel`: unified data/Import model path, enabled by default.
- `enableEntraSignIn`, `entraSignInClientId`: sign-in integration.
- `grantProvisionerGraphPermission` or `refreshServicePrincipalClientId` /
  `refreshServicePrincipalObjectId` / `refreshServicePrincipalSecret`: refresh identity setup.
- `deployAuroraModel`, `createAuroraModelDeployment`, `auroraModelAssetId`,
  `deployAuroraSchedule`: optional inference and forecast scheduling.

Check exact defaults and dependencies in [Bicep](../planetary-computer-pro-poc/deploy/azure/main.bicep)
and the [portal form](../planetary-computer-pro-poc/deploy/azure/createUiDefinition.json).
Keep `exemptStorageFromPolicy=false` unless the platform owner approves a compatible,
documented exception. Never paste resolved credentials into issues or deployment logs.

## Deployment workflow

1. Select the subscription, new evaluation resource group, region, components, and budget.
2. Complete the runbook's Azure, Fabric, Graph, policy, and quota checks.
3. Review parameters and obtain approval before creating resources.
4. Validate the compiled template and review `what-if` where appropriate.
5. Deploy and monitor the app-plane and Fabric-plane provisioning scripts separately.
6. Record outputs and complete the acceptance checks below.

The full deployment can take 30-90 minutes; data seeding and Fabric provisioning can take
longer. A successful resource creation does not mean all data or optional GPU models are ready.

### Application publication

The full OneGrid path uses the prebuilt `onegrid-app.zip` from the
[release workflow](../.github/workflows/release-onegrid-app.yml). The application entry point
is `node report-app/server/index.js`; App Service uses `WEBSITE_RUN_FROM_PACKAGE`.
Provisioning can rehost the package into deployment storage.

Do not use a standalone `az webapp up` against only the web UI as a substitute for this
unified package. The report API, chat, SSR application, and runtime dependencies ship together.
See [implementations](implementations.md) and [release operations](operations-runbook.md#change-release-and-rollback).

## Acceptance checks

Retain results with the selected components, deployment ID, source/package version, and
test time. Record disabled features as not applicable; do not report skipped tests as passed.

| Check | Expected result |
| --- | --- |
| ARM and provisioning | Resource deployment and both selected provisioning paths complete; skipped/degraded components are explicitly recorded |
| Process health | `/api/health` responds with HTTP 200 after startup |
| Authentication | Approved user can sign in; unauthenticated/unauthorized clients cannot retrieve protected data; callback uses the deployed host |
| Fabric queries | Representative app DAX and KQL calls return expected rows from the intended tenant/workspace, not sample fallback data |
| Semantic model | SQL connection is bound, Import refresh succeeds, counts/timestamps match the intended source |
| Data isolation | Users/query identities cannot access data outside the approved boundary, including through chat and exports |
| Chat, if selected | An authenticated representative question produces a grounded answer and evidence of a data query; model/deployment names match |
| GeoCatalog, if selected | STAC search, an authorized ingestion, and tile retrieval succeed |
| Aurora, if selected | Actual model inference succeeds, not just workspace/endpoint creation |
| Schedule, if selected | A job run publishes valid outputs with current input/output timestamps and provenance |
| Operations | Alerts, freshness checks, cost ownership, and recovery responsibilities are assigned |

The runbook includes a representative chat request. Execute it using the approved authenticated
client/session; failure without credentials should not be "fixed" by disabling protection.
If sign-in is unconfigured or an optional feature is degraded, restrict exposure and resolve
or explicitly exclude that feature before accepting the environment.

## Load an asset register

Assets and imagery use different paths. An asset register describes **what you operate and
where it is**. Weather inputs, forecast tracks, and calculated exposure are not asset uploads.

Use **CSV** for point assets or **GeoJSON** for points, lines, and polygons. Coordinates use
WGS 84 (EPSG:4326); GeoJSON coordinate arrays are `[longitude, latitude]`.

| Field | Purpose |
| --- | --- |
| `id`, `name`, `type` | Stable asset identifier, display name, and supported asset category |
| `latitude`, `longitude` | Point coordinates |
| `geometry` | GeoJSON geometry for line/polygon assets instead of point coordinates |
| `operator`, `region`, `business_unit` | Optional ownership and organizational context |
| `operating_status`, `criticality` | Operational state and risk-weighting context |
| `metadata` | Additional asset attributes supported by the selected workflow |

Start with the checked-in samples rather than inventing a schema:

- [Sample CSV](../planetary-computer-pro-poc/samples/sample-assets.csv).
- [Sample GeoJSON](../planetary-computer-pro-poc/samples/sample-assets.geojson).

```csv
id,name,type,latitude,longitude,operator,region,operating_status,criticality
PLT-D7,Platform Delta-7,offshore_platform,27.62,-90.35,Meridian Energy,Central Gulf,producing,business_critical
```

Use the app's Asset Management workflow where enabled and verify accepted/rejected records,
coordinates, and resulting counts. The current no-GeoCatalog configuration omits catalog
imagery and asset-upload functionality; Fabric-backed views remain a separate path.

Exposure joins asset locations and attributes to forecast information. Validate the scoring
method and data provenance for the use case; scores and generated recommendations are not
engineering or safety assurances.

## Ingest imagery and rasters

Imagery is optional and separate from asset-to-weather scoring:

- **Pixel data:** Cloud-Optimized GeoTIFF (COG).
- **Metadata:** STAC Items identifying assets and their spatial/temporal properties.
- **Serving:** GeoCatalog STAC and tile APIs.

For customer-owned data:

1. Upload assets to the deployed `sample-assets` container or an approved source.
2. Register a managed-identity ingestion source using the deployment's container URL and
   ingestion identity. Verify identity association and Storage Blob Data Reader scope.
3. Submit the STAC items and verify ingestion status, search, and rendering.

See [managed-identity ingestion](https://learn.microsoft.com/azure/planetary-computer/set-up-ingestion-credentials-managed-identity)
and the [Planetary Computer API tutorial](https://learn.microsoft.com/azure/planetary-computer/api-tutorial).

The sample Sentinel-2 workflow can read from Microsoft's public Planetary Computer using a
short-lived source SAS. It does not mean customer storage contains the source imagery.
The deployed sample account also holds weather `model-outputs` and, for the full app,
package artifacts. A private/nonanonymous container does not imply a private network endpoint.

## Operator access and cleanup

Use [GeoCatalog access guidance](https://learn.microsoft.com/azure/planetary-computer/manage-access)
to assign the minimum role for an operator's task. Runtime identity permissions do not
automatically grant the human operator catalog access.

Before deleting an evaluation environment, export required data and inventory Azure
resources, Fabric workspaces/items, capacities, Entra registrations, connections, and secrets.
Resource-group deletion alone does not clean up all SaaS/directory objects. Follow the
[decommissioning checklist](operations-runbook.md#backup-restore-and-decommissioning), and never
remove a shared capacity or platform resource without its owner's approval.
