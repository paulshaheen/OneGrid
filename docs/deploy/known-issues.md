---
title: Known issues for OneGrid deployments
description: Current limitations and inconsistencies in the OneGrid template, portal form, provisioner, and documentation, with their impact, workarounds, and status.
ms.date: 11/25/2026
ms.topic: troubleshooting-known-issue
---

# Known issues for OneGrid deployments

Part of the [OneGrid landing zone design guide](../architecture/design-guide.md).

[Deploy OneGrid](README.md) | [Troubleshooting](troubleshooting.md) |
[Parameter reference](reference/parameters.md)

These issues are current in the repository. Each one names the code or document it comes
from, its effect on a deployment, a workaround, and a status:

- **Open:** The behavior or text is wrong or incomplete, and no fix is in the code yet.
- **By design:** The behavior is intentional. Plan around it.
- **Verify:** The code and the documentation disagree, or the effect depends on your
  environment. Confirm it before you rely on either.

For problems with a known fix, see [Troubleshooting](troubleshooting.md). For issues that are
now fixed in the code, and what an earlier deployment needs, see
[Fixed in the repository](#fixed-in-the-repository).

| Issue | Area | Status |
| --- | --- | --- |
| [The live-ingestion Eventstream isn't created](#the-live-ingestion-eventstream-isnt-created) | Provisioning | Open |
| [The Aurora Key Vault name changes on every deployment](#the-aurora-key-vault-name-changes-on-every-deployment) | Template | By design |
| [GeoCatalog and the sample storage account share a name](#geocatalog-and-the-sample-storage-account-share-a-name) | Template | By design |
| [Mutable source defaults](#mutable-source-defaults) | Template | Open |
| [Manual app setting changes don't survive a redeployment](#manual-app-setting-changes-dont-survive-a-redeployment) | Template | By design |
| [The provisioner sets tags on the resource group](#the-provisioner-sets-tags-on-the-resource-group) | Provisioning | Verify |
| [Deleting the resource group leaves Fabric and directory objects](#deleting-the-resource-group-leaves-fabric-and-directory-objects) | Lifecycle | By design |
| [The region list applies without GeoCatalog](#the-region-list-applies-without-geocatalog) | Template | Open |
| [Portal and template defaults differ](#portal-and-template-defaults-differ) | Portal form | By design |
| [Sign-in wiring can't be turned off in the portal](#sign-in-wiring-cant-be-turned-off-in-the-portal) | Portal form | Open |
| [A pre-created sign-in registration needs its redirect URI](#a-pre-created-sign-in-registration-needs-its-redirect-uri) | Provisioning | By design |
| [Studio shared quota isn't available to the template](#studio-shared-quota-isnt-available-to-the-template) | Aurora | By design |
| [The deploy wizard doesn't create GeoCatalog, Aurora, or the forecast job](#the-deploy-wizard-doesnt-create-geocatalog-aurora-or-the-forecast-job) | Deploy wizard | By design |
| [The Foundry IQ manuals add-on targets a container app](#the-foundry-iq-manuals-add-on-targets-a-container-app) | Add-ons | Verify |
| [The configuration sample says telemetry is on by default](#the-configuration-sample-says-telemetry-is-on-by-default) | Documentation | Open |

## Deployment and provisioning

### The live-ingestion Eventstream isn't created

The repository includes the `pi-events-stream` Eventstream definition, but no deployment path
publishes it, although the provisioner's header comment and its `core` phase log message list
an Eventstream. A baseline deployment has no live ingestion path, and the data-plane add-on's
connector settings get a `REPLACE-ME` endpoint placeholder.

- **Workaround:** Publish the Eventstream to the workspace, bind it to the Eventhouse database
  and `PiEventsRaw` mapping, confirm the `PIForwarderEndpoint` source, and then run the
  data-plane add-on. The design guide's
  [known gap](../architecture/design-guide.md#known-gap-live-ingestion-eventstream) has the
  steps.
- **Status:** Open.
- **Source:** [`deploy.ps1`](../../planetary-computer-pro-poc/infra/deploy.ps1) (`Phase-Core`,
  `Phase-DataPlane`).

### The Aurora Key Vault name changes on every deployment

The Azure Machine Learning workspace's Key Vault is named `pcpro-kv-<run>`, where `<run>`
derives from `deploymentToken`, which defaults to `utcNow()`. The template does this so a
redeployment never collides with a vault that's soft-deleted for 90 days. As a result:

- You can't predict the vault's name for inventory or policy.
- Each deployment with Aurora declares a new vault for the existing workspace, and the earlier
  vaults stay in the resource group, because deployments are incremental.
- **Workaround:** Don't set `deploymentToken`. Preview redeployments with what-if, and remove
  vaults you no longer need. Exclude the `pcpro-kv-` prefix from name-based policy, or match
  on the resource group instead.
- **Status:** By design.
- **Source:** [`main.bicep`](../../planetary-computer-pro-poc/deploy/azure/main.bicep)
  (`deploymentToken`, `amlKeyVaultName`).

### GeoCatalog and the sample storage account share a name

When `geoCatalogName` is blank, the GeoCatalog and the sample storage account both resolve to
`pcpro<unique>`. They're different resource types, so the names don't collide, but inventory
and cost reports show the same name twice.

- **Workaround:** Set `geoCatalogName` to give the catalog its own name.
- **Status:** By design.
- **Source:** [`main.bicep`](../../planetary-computer-pro-poc/deploy/azure/main.bicep)
  (`effectiveGeoCatalogName`, `sampleStorageName`); the design guide's
  [resource organization and naming](../architecture/design-guide.md#resource-organization-and-naming).

### Mutable source defaults

The template's defaults track sources that change over time, so two deployments with the same
parameters can install different code:

- `oneGridAppPackageUrl` points at the `app-latest` release asset, which the release workflow
  replaces on every published change.
- `oneGridRef` is `main`, and `oneGridRepoUrl` is the public repository. The deployment
  scripts clone the provisioner, the Fabric content, and the forecast pipeline source from
  there.
- The in-template wrapper always seeds historical data from
  `releases/latest/download/onegrid-data.zip`. That URL isn't a template parameter.
- `oneGridRef`'s description says it accepts a branch, tag, or commit. The scripts clone with
  `git clone --depth 1 --branch`, which accepts only a branch or tag, and the source-archive
  fallback resolves branches only.

- **Workaround:** For production, pin `oneGridRef` to a release tag, and point
  `oneGridAppPackageUrl` at a versioned package that you retain. Record both with the
  environment. The [release and rollback procedure](../operations-runbook.md#change-release-and-rollback)
  explains why a published release doesn't establish what a tenant runs.
- **Status:** Open.
- **Source:** [`main.bicep`](../../planetary-computer-pro-poc/deploy/azure/main.bicep)
  (`oneGridAppPackageUrl`, `oneGridRef`, `auroraImageBuild`);
  [`onegrid-solution-provision.ps1`](../../planetary-computer-pro-poc/deploy/azure/scripts/onegrid-solution-provision.ps1).

### Manual app setting changes don't survive a redeployment

On every deployment, Azure Resource Manager replaces the web app's settings with the five
values declared in the template. The deployment scripts then reapply the settings they
compute. A setting you change by hand, such as `ONEGRID_MODULES` with
`az webapp config appsettings set`, lasts only until the next deployment.

- **Workaround:** Change settings through parameters, such as `oneGridModules`, and redeploy.
- **Status:** By design.
- **Source:** [`main.bicep`](../../planetary-computer-pro-poc/deploy/azure/main.bicep)
  (`appProvisionScript`, `fabricPlaneScript`).

### The provisioner sets tags on the resource group

The provisioner's `chatagent` phase, and its `foundry` phase when it creates its own
Microsoft Foundry account, run `az group create` on the deployment's resource group with the
tags `onegrid-deploy=1` and `onegrid-workspace=<workspace-id>`.

- **Workaround:** If your organization requires specific resource group tags, check the
  resource group's tags after the deployment, and reapply them if needed.
- **Status:** Verify.
- **Source:** [`deploy.ps1`](../../planetary-computer-pro-poc/infra/deploy.ps1)
  (`Phase-ChatAgent`, `Phase-Foundry`).

### Deleting the resource group leaves Fabric and directory objects

The resource group holds only the Azure resources. Deleting it leaves:

- The OneGrid Fabric workspace and its items.
- The tenant-level Fabric connection `<workspace name> - sql`. A later deployment with the same
  workspace name reuses it while it still points at the deleted SQL endpoint, which breaks the
  Import refresh.
- The sign-in registration and refresh service principal that the provisioner created.
- Soft-deleted Key Vaults and a soft-deleted Microsoft Foundry account, which hold their names.

- **Workaround:** Follow [Tear down](deploy-cli.md#tear-down) to remove each object.
- **Status:** By design.
- **Source:** [`deploy.ps1`](../../planetary-computer-pro-poc/infra/deploy.ps1)
  (`Phase-Teardown`, `Phase-Foundry`); [Copilot runbook](../../DEPLOY-WITH-COPILOT.md#tear-down).

### The region list applies without GeoCatalog

The `location` parameter allows only the five GeoCatalog preview regions, and the portal form
filters regions by GeoCatalog availability. The restriction applies even when
`deployGeoCatalog` is `false`.

- **Workaround:** Deploy into one of the five regions. Check that the other services you select,
  and their quota, are available there.
- **Status:** Open.
- **Source:** [`main.bicep`](../../planetary-computer-pro-poc/deploy/azure/main.bicep)
  (`location`); [`createUiDefinition.json`](../../planetary-computer-pro-poc/deploy/azure/createUiDefinition.json)
  (`config.basics.location`).

## Portal form

### Portal and template defaults differ

With every default kept, the portal deploys the Fabric plane, the web app, and the data seed,
and creates the storage connection. The template's defaults leave all four off, so a
command-line deployment with few parameters deploys much less than the portal. The data seed
downloads hundreds of megabytes and adds deployment time; clear **OneGrid historical data seed
(large)** in the form when you don't need the demo dataset.

- **Workaround:** Start from a [parameter file](../../planetary-computer-pro-poc/deploy/azure/parameters/README.md).
  `baseline-required` reproduces the portal's component selection. The
  [parameter reference](reference/parameters.md#portal-defaults-that-differ-from-the-template)
  lists the differences.
- **Status:** By design.
- **Source:** [`createUiDefinition.json`](../../planetary-computer-pro-poc/deploy/azure/createUiDefinition.json);
  [`main.bicep`](../../planetary-computer-pro-poc/deploy/azure/main.bicep).

### Sign-in wiring can't be turned off in the portal

The form sends `enableEntraSignIn` as `true` whenever the web app is selected. Clearing
**Create the sign-in (Entra SPA) app registration for me** only switches to a registration you
supply; it doesn't turn off sign-in wiring.

- **Workaround:** Set `enableEntraSignIn` to `false` from the command line.
- **Status:** Open.
- **Source:** [`createUiDefinition.json`](../../planetary-computer-pro-poc/deploy/azure/createUiDefinition.json)
  (`outputs.enableEntraSignIn`).

## Application and Aurora

### A pre-created sign-in registration needs its redirect URI

When you supply `entraSignInClientId`, the provisioner wires the client ID into the app but
doesn't change the registration. It adds the redirect URI only to a registration it creates.

- **Workaround:** After the deployment, add `https://<app-host>/auth/callback` as a
  single-page application redirect URI. The
  [Copilot runbook](../../DEPLOY-WITH-COPILOT.md#step-2--check-prerequisites), step 2.6, has a
  command for it.
- **Status:** By design.
- **Source:** [`deploy.ps1`](../../planetary-computer-pro-poc/infra/deploy.ps1)
  (`Phase-ChatAgent`).

### Studio shared quota isn't available to the template

Azure Machine Learning studio can deploy Aurora on shared quota to a temporary endpoint. That
option is studio-only. A template deployment needs dedicated `Standard_NC24ads_A100_v4` quota,
and with zero quota the model deployment fails with a capacity error.

- **Workaround:** Leave **Deploy the Aurora model for me** cleared so the template creates only
  the workspace and endpoint, and deploy the model from the studio.
- **Status:** By design.
- **Source:** [`createUiDefinition.json`](../../planetary-computer-pro-poc/deploy/azure/createUiDefinition.json)
  (Aurora section).

## Tools and add-ons

### The deploy wizard doesn't create GeoCatalog, Aurora, or the forecast job

The deploy wizard runs the provisioner directly, without the ARM template. It deploys the
Fabric workspace and items, Microsoft Foundry, and the web app on an existing Fabric capacity,
but not the resources that only the template declares.

- **Workaround:** Use the [portal](deploy-portal.md) or the [command line](deploy-cli.md) when
  you need GeoCatalog, Aurora, or the forecast job.
- **Status:** By design.
- **Source:** [Deploy wizard](../../planetary-computer-pro-poc/infra/deploy-ui/README.md); the
  design guide's [deployment options](../architecture/design-guide.md#deployment-options).

### The Foundry IQ manuals add-on targets a container app

The add-on's README asks for a `<container-app>` name, and its `deploy.ps1` sets the `MANUALS_*`
settings with `az containerapp update`. The template deploys the web app on App Service.

- **Workaround:** Verify the add-on against your deployment before you use it. On App Service,
  the equivalent settings change is `az webapp config appsettings set`, and a later
  redeployment of the template replaces settings that it doesn't declare.
- **Status:** Verify before use.
- **Source:** [Foundry IQ manuals README](../../planetary-computer-pro-poc/infra/bolt-ons/foundry-iq-manuals/README.md);
  [`foundry-iq-manuals/deploy.ps1`](../../planetary-computer-pro-poc/infra/bolt-ons/foundry-iq-manuals/deploy.ps1).

## Documentation

### The configuration sample says telemetry is on by default

The `telemetry` comment in
[`config.sample.json`](../../planetary-computer-pro-poc/infra/config.sample.json) says the
provisioner reports an install event by default. In
[`deploy.ps1`](../../planetary-computer-pro-poc/infra/deploy.ps1), the telemetry function is
disabled and sends nothing, and the in-template wrapper also sets `telemetry.enabled` to
`false`.

- **Workaround:** None needed. No install telemetry is sent.
- **Status:** Open.
- **Source:** [`config.sample.json`](../../planetary-computer-pro-poc/infra/config.sample.json);
  [`deploy.ps1`](../../planetary-computer-pro-poc/infra/deploy.ps1) (`Send-Telemetry`).

## Fixed in the repository

These issues are fixed in the repository's code. A deployment gets a fix only when it runs code
that contains the fix. The deployment scripts clone the provisioner from `oneGridRef`, and the
web app runs the package at `oneGridAppPackageUrl`. An environment deployed before a fix keeps
the old behavior until you redeploy it from a ref and a package that include the fix.

| Issue | Fix | Earlier deployments |
| --- | --- | --- |
| The Deployment page could show **Model required** after the Aurora GPU deployment succeeded. Azure Resource Manager renders `string(true)` as `True`, and the app accepted only lowercase `true` in `AURORA_MODEL_DEPLOYED`. | The provisioner writes the setting in lowercase, and the app compares it case-insensitively. | Redeploy, or move the web app to a package built from the fixed code. Until then, use the `auroraModelDeployed` output and the endpoint in Azure Machine Learning studio. |
| Portal, template, and provisioner text described the web app as a Container App built from source, with an Oryx build. | The text describes the App Service web app that runs the prebuilt package. | No action needed. |
| The portal said the forecast job needs a prebuilt pipeline image, and to build it after you deploy. | The text says the template builds the image during the deployment, and that `auroraImageBuildCommand` rebuilds it. | No action needed. |
| The portal and `deployFabricPlane` said the Fabric plane needs an existing Fabric capacity. | The text names both choices: an existing capacity, or a new one with `createFabricCapacity`. | No action needed. |
| The data seed option said it was off by default, but the form preselects it. | The text says the form selects the option by default. | No action needed. |
| The portal's **New Fabric capacity SKU** list stopped at `F256`. | The list offers `F2` through `F2048`, the same range as the template. | No action needed. |
| Portal and template text used an earlier name for the model service. | The text names Microsoft Foundry throughout. | No action needed. |

## Next steps

- [Troubleshooting](troubleshooting.md)
- [Parameter reference](reference/parameters.md)
- [Deploy OneGrid](README.md)
