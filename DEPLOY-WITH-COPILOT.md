# Deploy OneGrid with GitHub Copilot

This runbook lets a GitHub Copilot agent deploy OneGrid into an Azure subscription for you. It
deploys the same template as the **Deploy to Azure** button
(`planetary-computer-pro-poc/deploy/azure/azuredeploy.json`) and asks the same questions as the
portal form, from the command line.

## How to use it

Open this repository with an agent that can run terminal commands, then ask:

> Deploy OneGrid by following DEPLOY-WITH-COPILOT.md

- **VS Code:** Copilot Chat in **Agent** mode, or run the `/deploy-onegrid` prompt.
- **GitHub Copilot CLI:** run `copilot` in the repo root and give the request above.

You need the Azure CLI on the machine, and an account that can deploy to the target subscription
(see Step 2). The agent signs in with your account; nothing is stored in the repo.

---

## Instructions for the agent

Follow the steps in order. Keep the user informed with a short update at each step.

**Rules**

- Ask before anything that creates, changes or deletes Azure resources. Show the full plan
  (Step 3) and get an explicit "yes" before Step 5.
- Collect every choice in Step 1 before running deployment commands. Offer the defaults shown.
- Never print, log or save access tokens, keys or connection strings.
- Don't edit files in this repository. Write the parameters file to a temporary folder
  outside the repo.
- Deploy into a **new, empty** resource group unless the user asks otherwise.
- If a step fails, stop, show the error, and use the Troubleshooting section before retrying.
  Don't retry the same failing command more than twice.
- Use single-line `az` commands so they work in both bash and PowerShell.

### Step 0 — Tools and sign-in

1. Check the Azure CLI: `az version`. Version 2.62 or later is needed. If it's missing, tell
   the user how to install it (https://aka.ms/installazurecli) and stop.
2. Check sign-in: `az account show -o table`. If not signed in, run `az login` (use
   `az login --use-device-code` when no browser is available).
3. List subscriptions with `az account list -o table`, ask which one to use, then
   `az account set --subscription <id>`.

### Step 1 — Collect the deployment choices

Ask these questions, ideally in one structured question. Defaults match the portal form.

| # | Question | Template parameter | Default / allowed values |
| --- | --- | --- | --- |
| 1 | Resource group name (new) | — | `onegrid-rg` |
| 2 | Region | `location` | `eastus`, `northcentralus`, `westeurope`, `canadacentral`, `uksouth` (GeoCatalog regions only) |
| 3 | Infrastructure components | see below | sample storage, AI agent, Fabric plane, web app, data seed |
| 4 | App modules shown in the web app | `oneGridModules` | all eight (see below) |
| 5 | Fabric capacity: create new or use existing | `createFabricCapacity` | create new |
| 6 | New capacity SKU and admin | `fabricCapacitySku`, `fabricCapacityAdmin` | `F2`; admin = the signed-in user's UPN (`az ad signed-in-user show --query userPrincipalName -o tsv`) |
| 7 | Existing capacity id (only if not creating) | `fabricCapacityId` | resource id or GUID |
| 8 | Fabric workspace name | `fabricWorkspaceName` | `OneGrid` |
| 9 | Web app plan | `chatAgentAppServiceSku` | `B1` (B1–B3, S1–S3, P0v3–P3v3) |
| 10 | Microsoft Entra sign-in | `enableEntraSignIn`, `entraSignInClientId` | on; see Step 2.6 for how the sign-in app gets created |
| 11 | Exempt storage from storage policies | `exemptStorageFromPolicy`, `storagePolicyExemptionTagName`, `storagePolicyExemptionTagValue` | off; see Step 2.7. Tag defaults `SecurityControl` / `Ignore` |
| 12 | Graph permission or refresh service principal | `grantProvisionerGraphPermission`, or `refreshServicePrincipalClientId` / `ObjectId` / `Secret` | decided in Step 2.6 |
| 13 | Unified asset model | `deployUnifiedModel` | on (recommended); needs the refresh identity from Step 2.6 |

**Infrastructure components** (question 3) map to these boolean parameters:

| Component | Parameter | Default | Notes |
| --- | --- | --- | --- |
| Planetary Computer Pro GeoCatalog | `deployGeoCatalog` | on | Optional. Without it the web app still reads live Fabric data, but has no catalog imagery layers or asset uploads |
| Sample storage + ingestion identity | `deploySampleStorage` | on | Required by the Fabric plane and the web app |
| AI agent (Azure OpenAI / Foundry) | `deployAiAgent` | on | Required for Copilot chat |
| OneGrid Fabric plane | `deployFabricPlane` | on | Required by the web app |
| OneGrid web app | `deployOneGridApp` | on | |
| Historical data seed (large) | `deployOneGridData` | on | Adds deployment time |
| Aurora weather model (GPU) | `deployAuroraModel` | off | Needs A100 GPU quota; usually leave off |
| Aurora scheduled forecast job | `deployAuroraSchedule` | off | Needs the Aurora model |

**App modules** (question 4) are passed as an array in `oneGridModules`. Core pages (Overview,
Asset Explorer, Maintenance, Alerts, Ontology, Thresholds, Governance, Cyber Readiness,
Deployment) are always included.

| Module id | Adds |
| --- | --- |
| `exec` | Executive Brief (Dashboard, Actions, Scorecard, Workbench) |
| `weather` | Storm map, forecast timeline, storm exposure, response posture, corridor weather |
| `twin` | 3D Control Room, failure simulation, distribution network |
| `infra` | IT/OT Infrastructure admin plane |
| `sap` | SAP S/4HANA plant maintenance view |
| `esu` | ESU Planner |
| `onerig` | Oil & Gas (OneRig) solution and the Energy / Oil & Gas switch |
| `copilot` | Copilot chat dock (needs the AI agent component) |

Check the dependencies and point out conflicts before moving on:

- The web app needs the Fabric plane, and the Fabric plane needs sample storage. If either is
  off, the template silently skips the dependent component.
- `copilot` without the AI agent component leaves a chat that can't answer.
- The Aurora schedule needs the Aurora model and sample storage.

### Step 2 — Check prerequisites

Run these checks and report a pass/fail list. Stop on a failure the user must fix.

1. **Permissions.** The account needs **Owner** on the subscription (or on the target resource
   group, created in Step 5), because the template creates role assignments. Check with:
   `az role assignment list --assignee <user-object-id> --scope /subscriptions/<sub-id> --query "[].roleDefinitionName" -o tsv`
   (object id: `az ad signed-in-user show --query id -o tsv`).
2. **Resource providers.** Register any that aren't `Registered`:
   `az provider show -n <namespace> --query registrationState -o tsv` and
   `az provider register -n <namespace>` for `Microsoft.Orbital`, `Microsoft.Fabric`,
   `Microsoft.Web`, `Microsoft.Storage`, `Microsoft.ManagedIdentity`,
   `Microsoft.CognitiveServices`, `Microsoft.ContainerInstance`, `Microsoft.Resources`
   (plus `Microsoft.MachineLearningServices`, `Microsoft.KeyVault`, `Microsoft.Insights`,
   `Microsoft.App`, `Microsoft.ContainerRegistry`, `Microsoft.OperationalInsights` when Aurora
   is selected). Registration can take a few minutes; poll until done.
3. **Quota.** If PowerShell (`pwsh`) is available, run
   `pwsh ./planetary-computer-pro-poc/deploy/azure/scripts/preflight-quota.ps1 -SubscriptionId <sub-id> -Location <region>`
   and report its PASS/FAIL lines. It checks Fabric capacity-unit quota and A100 GPU quota
   (ignore the GPU line when Aurora is off). Without `pwsh`, check Fabric quota directly:
   `az rest --method get --url "https://management.azure.com/subscriptions/<sub-id>/providers/Microsoft.Fabric/locations/<region>/usages?api-version=2023-11-01" --query "value[0].{limit:limit,used:currentValue}"`.
   Quota differs by region, and everything deploys to one region. If the chosen region has no
   Fabric quota for the SKU, check the other allowed regions and offer the user one that has it.
   App Service quota is checked in Step 4 (validation reports `InternalSubscriptionIsOverQuotaForSku`).
4. **Fabric tenant setting (manual).** Ask the user to confirm that a Fabric administrator has
   enabled **"Service principals can create workspaces, connections, and deployment
   pipelines"** (Fabric Admin portal → Tenant settings) for the identity
   `pcpro-fabricplane-identity`, or for a security group it will be added to. The agent can't
   check this. Without it the Fabric plane fails to create the workspace.
5. **Existing capacity only.** The template creates `pcpro-fabricplane-identity`, and that
   identity needs Contributor or Admin rights on the capacity. If the user can pre-create the
   resource group, they can grant rights after the first run: the Fabric script fails at
   capacity assignment, the user adds the identity as a capacity admin in the Fabric Admin
   portal, and the agent redeploys (Step 5 is safe to repeat). A new capacity created by the
   template is handled automatically.
6. **Entra permissions (sign-in and semantic-model refresh).** Two things need app registrations:
   the sign-in app, and a service principal that binds and refreshes the Import semantic model.
   Check the user's directory roles:
   `az rest --method get --url "https://graph.microsoft.com/v1.0/me/memberOf/microsoft.graph.directoryRole?$select=displayName" --query "value[].displayName" -o tsv`
   - **Global Administrator or Privileged Role Administrator:** set
     `grantProvisionerGraphPermission` to `true`. The template grants the deployment identity
     Microsoft Graph `Application.ReadWrite.OwnedBy`, and the setup scripts create both apps.
   - **Otherwise**, if the user can register apps (most tenants allow it), create them as the
     user and pass them in. Tell the user what you'll create and get a yes first.
     1. Refresh service principal:
        `az ad app create --display-name onegrid-<rg>-refresh-sp --sign-in-audience AzureADMyOrg --query appId -o tsv`,
        then `az ad sp create --id <appId> --query id -o tsv` (the object id), then
        `az ad app credential reset --id <appId> --display-name onegrid --query password -o tsv`
        (the secret; keep it in memory and the temp parameters file only). Pass them as
        `refreshServicePrincipalClientId`, `refreshServicePrincipalObjectId` and
        `refreshServicePrincipalSecret`.
     2. Sign-in app: `az ad app create --display-name onegrid-<rg>-signin --sign-in-audience AzureADMyOrg --query "{appId:appId,id:id}"`
        and pass the `appId` as `entraSignInClientId`. After the deployment (Step 7), add the
        web app's SPA redirect URI:
        `az rest --method patch --url https://graph.microsoft.com/v1.0/applications/<id> --headers Content-Type=application/json --body "{\"spa\":{\"redirectUris\":[\"<app-url>/auth/callback\"]}}"`
   - **Neither:** deploy anyway. The app works without sign-in, but the Import semantic model
     isn't refreshed, so dashboards and chat have no model data. Tell the user.
7. **Storage policies.** Some subscriptions enforce Azure Policy that turns off shared-key or
   public network access on every new storage account (Microsoft internal MCAPS subscriptions
   do). The deployment scripts then fail with `KeyBasedAuthenticationNotPermitted`, and the web
   app can't read its package. Policies assigned at management-group level often aren't visible
   from the subscription, so look for these signs:
   - the subscription or tenant name contains `MCAP` (`az account show --query "{sub:name, tenant:tenantDefaultDomain}"`);
   - existing storage accounts in the subscription all have shared-key access off:
     `az storage account list --query "[].{name:name, sharedKey:allowSharedKeyAccess, publicNetwork:publicNetworkAccess}" -o table`.

   If either sign is present, or the user isn't sure, ask whether to set
   `exemptStorageFromPolicy` to `true`. It tags the deployment's storage accounts with the
   policy's opt-out tag. Confirm the tag the policy honors (MCAPS uses `SecurityControl` =
   `Ignore`), and that the user's organization allows the exemption.

### Step 3 — Write the parameters file and confirm the plan

Write `onegrid.parameters.json` to a temp folder (for example `$env:TEMP` or `/tmp`), not the
repo. Example for the default choices:

```json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "location": { "value": "eastus" },
    "deployGeoCatalog": { "value": true },
    "deploySampleStorage": { "value": true },
    "deployAiAgent": { "value": true },
    "deployFabricPlane": { "value": true },
    "deployOneGridApp": { "value": true },
    "deployOneGridData": { "value": true },
    "deployAuroraModel": { "value": false },
    "deployAuroraSchedule": { "value": false },
    "createFabricCapacity": { "value": true },
    "fabricCapacitySku": { "value": "F2" },
    "fabricCapacityAdmin": { "value": "user@contoso.com" },
    "fabricWorkspaceName": { "value": "OneGrid" },
    "createFabricConnection": { "value": true },
    "chatAgentAppServiceSku": { "value": "B1" },
    "enableEntraSignIn": { "value": true },
    "entraSignInClientId": { "value": "" },
    "exemptStorageFromPolicy": { "value": false },
    "deployUnifiedModel": { "value": true },
    "oneGridModules": { "value": ["exec", "weather", "twin", "infra", "sap", "esu", "onerig", "copilot"] }
  }
}
```

For an existing capacity, set `createFabricCapacity` to `false` and add
`"fabricCapacityId": { "value": "<id>" }`.

Show the user a short plan: subscription, resource group, region, components, modules,
capacity, and the costs to expect (Fabric capacity and App Service bill while running; the
GeoCatalog, Azure OpenAI and storage bill by use). Ask for a "yes" to continue.

### Step 4 — Validate

1. Create the resource group: `az group create -n <rg> -l <region>`
2. Validate the template, using the published template so the result matches the portal:
   `az deployment group validate -g <rg> --template-uri https://raw.githubusercontent.com/paulshaheen/OneGrid/main/planetary-computer-pro-poc/deploy/azure/azuredeploy.json --parameters @<path-to>/onegrid.parameters.json -o none`
   To deploy changes from this checkout instead, use
   `--template-file planetary-computer-pro-poc/deploy/azure/azuredeploy.json`.
3. Optionally preview with `az deployment group what-if` (same arguments).

Fix any validation error before continuing. A quota error names the resource type and
region; see Troubleshooting. When a different region is needed, delete the empty resource
group and recreate it in the new region so the resource group and its resources match.

### Step 5 — Deploy

Start the deployment without blocking:

`az deployment group create -g <rg> -n onegrid --template-uri https://raw.githubusercontent.com/paulshaheen/OneGrid/main/planetary-computer-pro-poc/deploy/azure/azuredeploy.json --parameters @<path-to>/onegrid.parameters.json --no-wait`

Tell the user it typically takes **30–90 minutes**. The Fabric plane and data seed are the long
parts; the in-template scripts can run for up to 2–3 hours.

### Step 6 — Monitor

Poll every 2–3 minutes and give a one-line progress update each time:

- Overall state: `az deployment group show -g <rg> -n onegrid --query properties.provisioningState -o tsv`
- Resources still running or failed:
  `az deployment operation group list -g <rg> -n onegrid --query "[?properties.provisioningState!='Succeeded'].{resource:properties.targetResource.resourceName, state:properties.provisioningState}" -o table`
- Provisioning script logs (the app plane, then the Fabric plane). These commands need the
  long `--name` option; `-n` isn't accepted:
  `az deployment-scripts show-log -g <rg> --name pcpro-onegrid-provision-app`
  `az deployment-scripts show-log -g <rg> --name pcpro-onegrid-provision-fabric`
  Summarize the latest phase lines (they start with a `[hh:mm:ss]` timestamp); don't paste
  whole logs. A script's log is only available once its container has started.

Stop polling when the state is `Succeeded` or `Failed`. On failure, find the failed operation's
`properties.statusMessage`, then use Troubleshooting.

### Step 7 — Verify

1. Read the outputs:
   `az deployment group show -g <rg> -n onegrid --query "properties.outputs.{app:oneGridAppUrl.value, geoCatalog:geoCatalogUri.value, fabric:fabricPlaneEnabled.value, phases:oneGridPhases.value}" -o json`
2. Check the app responds: request `<app-url>/api/health` and expect HTTP 200. The first request
   after deployment can take a minute while the app starts.
3. Confirm the modules: the web app name starts with `pcpro-onegrid-app-`.
   `az webapp config appsettings list -g <rg> -n <app-name> --query "[?name=='ONEGRID_MODULES'].value" -o tsv`
4. If Copilot chat was selected, ask it one question to prove the AI and Fabric wiring end to
   end. POST `{"message":"How many assets are on the watchlist?","history":[]}` as JSON to
   `<app-url>/api/chat`. The response is a server-sent event stream; read the final line that
   starts with `data: {"type":"done"`. Its `reply` should be an answer, and `queries` should
   list at least one query. An `API error (404) DeploymentNotFound` reply means the app's
   `AI_DEFAULT_MODEL` setting doesn't match the Azure OpenAI deployment name.
5. Grant the user access to browse the GeoCatalog (if deployed):
   `az role assignment create --assignee <user-object-id> --role "GeoCatalog Administrator" --scope <geoCatalogResourceId output>`

### Step 8 — Report

Finish with a short summary for the user:

- the app URL and the GeoCatalog URI;
- which components and modules were deployed;
- anything skipped or degraded (for example, sign-in not configured, shortcut skipped);
- manual follow-ups (Fabric tenant setting, capacity rights, sign-in app);
- how to change modules later and how to tear down (below).

Delete the temporary parameters file.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `location ... is not part of the allowed value(s)` | Region outside the GeoCatalog preview regions | Use one of the five allowed regions |
| Validation: `InternalSubscriptionIsOverQuotaForSku` on `Microsoft.Web/serverFarms` | No App Service quota for that plan size in the region (often zero for every size) | Validate the other allowed regions and pick one that passes, or request App Service quota on the portal **Quotas** blade |
| `MissingSubscriptionRegistration` / `Microsoft.Orbital` not registered | Provider not registered | Register it (Step 2) and retry |
| Fabric capacity create fails on quota | No Fabric capacity-unit quota in the region | Request quota on the portal **Quotas** blade (Microsoft Fabric), or use an existing capacity |
| Fabric script log shows 401/403 creating the workspace | Fabric tenant setting not enabled for service principals | Fabric admin enables the setting (Step 2.4); redeploy |
| Fabric script fails assigning the capacity | `pcpro-fabricplane-identity` lacks rights on an existing capacity | Add it as capacity Contributor/Admin; redeploy |
| `AuthorizationFailed` on role assignments | Deployer isn't Owner | Use an Owner account, or have an Owner run the deployment |
| A deployment script fails with `KeyBasedAuthenticationNotPermitted` | A storage policy turned off shared-key access on the script's storage account | Redeploy with `exemptStorageFromPolicy=true` (Step 2.7) |
| App returns 403/404 or a blank page after deployment | App package blob not readable, often an Azure Policy that turns off public network access on storage accounts | Redeploy with `exemptStorageFromPolicy=true` if the policy allows an opt-out tag; otherwise allow the web app to reach the `onegrid-app-package` container, then restart the app |
| Sign-in not configured | Deployment identity can't create app registrations | Follow Step 2.6: grant the Graph permission, or supply `entraSignInClientId` for a SPA app (redirect URI `https://<app>/auth/callback`) and redeploy |
| Deployment fails on `provisionerGraphRole` with `Authorization_RequestDenied` | The deployer isn't allowed to grant Graph application permissions | Set `grantProvisionerGraphPermission=false` and use the app-registration path in Step 2.6 |
| Semantic model refresh failed, or chat says the watchlist is empty | No refresh service principal, or the refresh hit a data error | Check the model's refresh history in the Fabric workspace; supply a refresh service principal (Step 2.6) and redeploy |
| Aurora endpoint fails | No A100 GPU quota | Leave Aurora off, or request quota (`preflight-quota.ps1 -RequestGpuQuota`) |

Redeploying the same template into the same resource group is safe; the provisioning scripts
re-run on every deployment.

## Change app modules later

`az webapp config appsettings set -g <rg> -n <app-name> --settings ONEGRID_MODULES=exec,weather,infra`
then `az webapp restart -g <rg> -n <app-name>`. Use `none` for core pages only, or delete the
setting to show every module.

## Tear down

Deleting the resource group removes everything the template created:
`az group delete -n <rg> --yes`. The Fabric workspace isn't an Azure resource; delete it in the
Fabric portal if you no longer need it.
