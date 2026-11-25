# OneGrid parameter files

Ready-made parameter files for the OneGrid template. Each scenario has a JSON file for
[`azuredeploy.json`](../azuredeploy.json) and a `.bicepparam` twin for
[`main.bicep`](../main.bicep) with the same values.

| Scenario | JSON | Bicep | What it deploys |
| --- | --- | --- | --- |
| Baseline | [`baseline-required.parameters.json`](baseline-required.parameters.json) | [`baseline-required.bicepparam`](baseline-required.bicepparam) | The portal form's default components: GeoCatalog, sample storage, the Microsoft Foundry model, the Fabric plane, the web app, and the historical data seed. Creates a new `F2` Fabric capacity |
| Baseline, full | [`baseline-full.parameters.json`](baseline-full.parameters.json) | [`baseline-full.bicepparam`](baseline-full.bicepparam) | Every component, including the Aurora GPU deployment and the forecast job, with the Microsoft Graph permission that creates the sign-in and refresh identities. Sets the typical values explicitly |
| Brownfield | [`brownfield-existing-capacity.parameters.json`](brownfield-existing-capacity.parameters.json) | [`brownfield-existing-capacity.bicepparam`](brownfield-existing-capacity.bicepparam) | The baseline components on an existing Fabric capacity, with an existing sign-in registration and refresh service principal |
| Weather inference | [`weather-aurora.parameters.json`](weather-aurora.parameters.json) | [`weather-aurora.bicepparam`](weather-aurora.bicepparam) | The Aurora endpoint and GPU deployment, the forecast job, and the storage it publishes to. No Fabric plane, web app, GeoCatalog, or Foundry model |

## Before you deploy

1. Copy the file to a folder outside the repository, and edit the copy.
2. Replace every `<your-...>` placeholder. A deployment fails until you do.
3. Check `location`. Every file uses `westeurope`; the template allows `eastus`,
   `northcentralus`, `westeurope`, `canadacentral`, and `uksouth`.
4. Confirm the scenario's prerequisites in
   [Get started](../../../../docs/deploy/getting-started.md#prerequisites).

| File | Values to replace | Prerequisites to confirm |
| --- | --- | --- |
| `baseline-required` | None | Fabric tenant setting, Fabric capacity-unit quota. Like the portal defaults, it leaves `grantProvisionerGraphPermission` off: add it if you can grant it. Otherwise sign-in stays unconfigured unless you add `entraSignInClientId`, and the Import model isn't refreshed unless you add a refresh service principal |
| `baseline-full` | `fabricCapacityAdmin` | Also dedicated A100 quota, Aurora Marketplace terms, and a deployer who is a Privileged Role Administrator or Global Administrator |
| `brownfield-existing-capacity` | `fabricCapacityId`, `entraSignInClientId`, `refreshServicePrincipalClientId`, `refreshServicePrincipalObjectId`, and the Key Vault reference | `pcpro-fabricplane-identity` as an administrator of the capacity, and the sign-in redirect URI after deployment |
| `weather-aurora` | None | Dedicated A100 quota and Aurora Marketplace terms |

## Conventions

- **No secrets.** The brownfield file passes `refreshServicePrincipalSecret` from Azure Key
  Vault: a `reference` in the JSON file and `az.getSecret()` in the `.bicepparam` file. The
  vault must allow template deployment.
- **No `deploymentToken`.** It's internal and defaults to `utcNow()`; setting it can cause Key
  Vault name conflicts.
- **Explicit component switches.** The template's defaults differ from the portal form's, so
  every file sets each component switch.
- **Pin for production.** `baseline-full` sets `oneGridRef` and `oneGridAppPackageUrl` to the
  template defaults, which track `main` and the `app-latest` release. Pin a release tag and a
  versioned package for production; a commit SHA doesn't work for `oneGridRef`.
- **Relative template path.** Each `.bicepparam` file starts with `using '../main.bicep'`. If
  you move a copy, update the path.

## Deploy a file

```powershell
az group create --name onegrid-rg --location westeurope
az deployment group what-if --resource-group onegrid-rg --template-file .\planetary-computer-pro-poc\deploy\azure\azuredeploy.json --parameters "@C:\deployment\onegrid.parameters.json"
az deployment group create --resource-group onegrid-rg --name onegrid --template-file .\planetary-computer-pro-poc\deploy\azure\azuredeploy.json --parameters "@C:\deployment\onegrid.parameters.json"
```

[Deploy from the command line](../../../../docs/deploy/deploy-cli.md) covers validation, Azure
PowerShell, `.bicepparam` files, monitoring, and teardown. The
[parameter reference](../../../../docs/deploy/reference/parameters.md) documents every
parameter.

## Keep the files current

The deployment tests check that every file uses only parameters that `main.bicep` declares,
that values match the allowed values, that component dependencies hold, that secure values
come from Key Vault, and that each `.bicepparam` twin matches its JSON file. Run them after you
change the template or a file:

```powershell
python -m unittest discover -s docs/deploy -p "test_*.py"
```
