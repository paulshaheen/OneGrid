// =====================================================================================
// Microsoft Planetary Computer Pro — Rapid POC
// Provisions a GeoCatalog and (optionally) a web app (Azure App Service, Node), sample-
// data storage, an Azure OpenAI (Foundry) agent, and the Aurora weather model so you can
// prove the end-to-end ingest → configure → visualize flow.
// =====================================================================================

targetScope = 'resourceGroup'

// ------------------------------------------------------------------------------------
// Parameters
// ------------------------------------------------------------------------------------

@description('Azure region for all resources. Planetary Computer Pro GeoCatalog is available only in the regions listed here (Preview).')
@allowed([
  'eastus'
  'northcentralus'
  'westeurope'
  'canadacentral'
  'uksouth'
])
param location string = 'westeurope'

@description('Name of the Planetary Computer Pro GeoCatalog resource. Lowercase letters and numbers, 3-24 characters. Leave blank to auto-generate a unique name.')
@maxLength(24)
param geoCatalogName string = ''

@description('GeoCatalog service tier.')
@allowed([
  'Basic'
])
param geoCatalogTier string = 'Basic'

@description('Deploy a sample-data storage account and a user-assigned managed identity for the managed-identity ingestion path (bring-your-own-data scenario).')
param deploySampleStorage bool = true

@description('Deploy an Azure OpenAI (Microsoft Foundry) account + model deployment for agentic / reasoning GeoAI scenarios against the GeoCatalog.')
param deployAiAgent bool = true

@description('Name of the Azure OpenAI (Foundry) model deployment.')
param openAiDeploymentName string = 'gpt-5-mini'

@description('Azure OpenAI model name.')
param openAiModelName string = 'gpt-5-mini'

@description('Azure OpenAI model version.')
param openAiModelVersion string = '2025-08-07'

@description('Azure OpenAI deployment SKU.')
param openAiSkuName string = 'GlobalStandard'

@description('Azure OpenAI deployment capacity, in thousands of tokens per minute (TPM).')
param openAiCapacity int = 10

@description('Deploy the Microsoft Aurora weather foundation model on a GPU-backed Foundry managed-compute endpoint. Requires GPU (A100) quota, an Azure Marketplace subscription, and acceptance of the model terms.')
param deployAuroraModel bool = false

@description('GPU VM size for the Aurora managed-compute deployment. Aurora requires an A100-class SKU; you must have quota for it in the selected region.')
param auroraInstanceType string = 'Standard_NC24ads_A100_v4'

@description('Registry model asset ID for the Aurora managed-compute deployment. The official Microsoft storm-impact app uses azureml://registries/azureml/models/Aurora/versions/4. Leave blank to provision the Foundry workspace + endpoint only and deploy the model from the portal (the GPU deployment needs quota + accepted terms).')
param auroraModelAssetId string = ''

@description('Deploy the Aurora model onto the GPU endpoint for me using the official published model asset (azureml://registries/azureml/models/Aurora/versions/4) instead of pasting a model asset ID. Ignored when auroraModelAssetId is supplied. Still requires A100 quota in the region and accepted Azure Marketplace terms for Aurora.')
param createAuroraModelDeployment bool = false

@description('Deploy a scheduled Azure Container Apps Job that runs the Aurora forecast pipeline on the ECMWF cycle cadence (00/06/12/18 UTC), publishing weather-events.json to the model-outputs container so the map stays live without manual runs. The template also provisions a dedicated Azure Container Registry for the pipeline image. Requires the Aurora weather model (for the GPU endpoint) and sample storage.')
param deployAuroraSchedule bool = false

@description('Optional override for the Aurora pipeline container image, e.g. myregistry.azurecr.io/aurora-pipeline:latest. Leave blank to use the Azure Container Registry this template provisions (build into it once with `az acr build`).')
param auroraJobImage string = ''

@description('Image tag for the Aurora pipeline image in the auto-provisioned registry. Ignored when auroraJobImage is set.')
param auroraJobImageTag string = 'latest'

@description('Cron schedule (UTC) for the Aurora forecast job. The default runs ~1 h after each synoptic cycle (00/06/12/18 UTC) to allow for input-data latency.')
param auroraJobCron string = '0 1,7,13,19 * * *'

// ------------------------------------------------------------------------------------
// OneGrid Fabric plane (additive) — see deploy/onegrid section below.
// Fabric (OneLake/Eventhouse/semantic model) is NOT provisionable by RG-scoped ARM, so
// the actual Fabric provisioning runs post-deploy via OneGrid's deploy.ps1 (Fabric REST).
// This template stays the authoritative PCP backend; these params only add the seam:
// a managed identity + storage read grant, and a ready-to-run OneGrid config as outputs.
// ------------------------------------------------------------------------------------
@description('Enable the OneGrid Fabric plane on top of this PCP backend: it provisions a Fabric workspace, lakehouse, eventhouse/KQL database, the geo_point_in_polygon hazard join + composite-risk tables, and (when a connection id is supplied) a OneLake shortcut to the model-outputs container. Fabric is not an ARM resource type, so this runs as an in-template deploymentScript (Fabric REST) using the Fabric-plane identity. Requires deploySampleStorage and an existing Microsoft Fabric capacity.')
param deployFabricPlane bool = false

@description('Existing Microsoft Fabric capacity resource id or capacity GUID (F-SKU or Trial). Provide one to reuse an existing capacity. Ignored when createFabricCapacity is true (the template provisions a new one instead).')
param fabricCapacityId string = ''

@description('Create a new Microsoft Fabric capacity (F-SKU) in this resource group instead of reusing an existing one. When true, fabricCapacityId is ignored and the Fabric plane deploys onto the freshly created capacity. Note: an F-SKU is billed hourly until paused or deleted; ARM cannot create a free Trial capacity.')
param createFabricCapacity bool = false

@description('SKU for the auto-created Fabric capacity (used only when createFabricCapacity is true). F2 is the smallest; scale up for heavier workloads.')
@allowed([ 'F2', 'F4', 'F8', 'F16', 'F32', 'F64', 'F128', 'F256', 'F512', 'F1024', 'F2048' ])
param fabricCapacitySku string = 'F2'

@description('Additional Fabric capacity administrator (used only when createFabricCapacity is true): a user principal name (email) or an Entra object id. The in-template Fabric-plane identity is always added as an admin so provisioning can assign the workspace; add a human admin here so you can manage the capacity in the Fabric portal.')
param fabricCapacityAdmin string = ''

@description('Display name of the Fabric workspace the OneGrid plane provisions.')
param fabricWorkspaceName string = 'OneGrid'

@description('GUID of a Fabric cloud connection to the sample storage account. Needed only for the OneLake shortcut to the model-outputs container; leave blank to provision the Fabric plane (workspace, lakehouse, eventhouse, hazard KQL) and add the shortcut later.')
param fabricConnectionId string = ''

@description('Instead of pasting an existing Fabric connection id, have the in-template provisioner create the storage connection for you using the Fabric workspace identity (secret-free): it provisions a workspace identity, grants it Storage Blob Data Reader on the sample storage account, creates an ADLS Gen2 connection bound to that identity, and builds the OneLake shortcut. Ignored when fabricConnectionId is supplied. Requires the Fabric tenant setting for service principals/workspace identities.')
param createFabricConnection bool = false

@description('Also stand up the OneGrid web application: the AI Foundry account (reused from the AI agent above when present) and the chat/report Container App, deployed into THIS resource group. Requires the OneGrid Fabric plane. The in-template provisioner runs OneGrid deploy.ps1 for the foundry/dataagent/chatagent phases; because this creates resources and role assignments, the Fabric-plane identity is granted Owner on this resource group.')
param deployOneGridApp bool = false

@description('App Service plan pricing tier for the OneGrid chat/report web app. B1 (Basic) is the low-cost default; pick a Premium v3 tier (P0v3/P1v3/P2v3/P3v3) for production-grade CPU/memory, autoscale, and better cold-start. Only applies when the OneGrid web app is deployed.')
@allowed([
  'B1'
  'B2'
  'B3'
  'S1'
  'S2'
  'S3'
  'P0v3'
  'P1v3'
  'P2v3'
  'P3v3'
])
param chatAgentAppServiceSku string = 'B1'

@description('Seed the full OneGrid historical demo dataset into the lakehouse/eventhouse (cloud-seeded from the public release bundle, ~hundreds of MB). Off by default to keep the deployment fast; enable for a fully populated demo.')
param deployOneGridData bool = false

@description('Git repository the in-template provisioner clones OneGrid deploy.ps1 + accelerator content from. The OneGrid monorepo keeps the orchestrator at planetary-computer-pro-poc/infra/deploy.ps1.')
param oneGridRepoUrl string = 'https://github.com/paulshaheen/OneGrid.git'

@description('Git ref (branch/tag/commit) of the OneGrid repository to deploy.')
param oneGridRef string = 'main'

// ------------------------------------------------------------------------------------
// Variables
// ------------------------------------------------------------------------------------

var namePrefix = 'pcpro'
// When no name is supplied (e.g. left blank in the portal form) generate a unique one
// here in the template — uniqueString() is an ARM function and is not available in
// createUiDefinition.json, so name generation must live in the template.
var effectiveGeoCatalogName = empty(geoCatalogName) ? toLower('pcpro${uniqueString(resourceGroup().id)}') : geoCatalogName
var sampleStorageName = toLower('pcpro${uniqueString(resourceGroup().id)}')
var ingestIdentityName = '${namePrefix}-ingest-identity'
var sampleContainerName = 'sample-assets'
// Container the Aurora storm-impact notebook uploads its weather model outputs to
// (matches UPLOAD_CONTAINER_NAME in the app .env).
var modelOutputsContainerName = 'model-outputs'

// Storage Blob Data Reader — lets the ingestion managed identity read blobs for ingestion.
var storageBlobDataReaderRoleId = '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1'

// Storage Blob Data Contributor — lets the Aurora job's managed identity WRITE its scratch
// channel SAS and the published weather-events.json to the sample storage account.
var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'

// Azure OpenAI (Foundry) agent.
var openAiName = toLower('pcpro-oai-${uniqueString(resourceGroup().id)}')
// Cognitive Services OpenAI User — key-less inference access.
var cognitiveServicesOpenAiUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'

// Aurora managed-compute (Azure ML / Foundry) workspace + GPU endpoint.
var amlSuffix = take(uniqueString(resourceGroup().id), 8)
var amlWorkspaceName = 'pcpro-aml-${amlSuffix}'
var amlStorageName = toLower('pcproaml${take(uniqueString(resourceGroup().id), 12)}')
var amlKeyVaultName = 'pcpro-kv-${amlSuffix}'
var amlApplicationInsightsName = 'pcpro-ai-${amlSuffix}'
var auroraEndpointName = 'aurora-${amlSuffix}'
var auroraDeploymentName = 'aurora'
var azureMLDataScientistRoleId = 'f6c7c914-8db3-469d-8ca1-694a8f32e121'
// The GPU model deployment only runs when a model asset ID is supplied (it needs GPU
// quota + accepted marketplace terms); otherwise just the workspace + endpoint deploy.
// When the caller ticks "deploy it for me" (createAuroraModelDeployment) and hasn't pasted
// an id, fall back to the official published Aurora model asset.
var auroraDefaultModelAssetId = 'azureml://registries/azureml/models/Aurora/versions/4'
var effectiveAuroraModelAssetId = !empty(auroraModelAssetId) ? auroraModelAssetId : (createAuroraModelDeployment ? auroraDefaultModelAssetId : '')
var deployAuroraDeployment = deployAuroraModel && !empty(effectiveAuroraModelAssetId)

// Scheduled Aurora forecast job (Azure Container Apps Job). It needs the GPU endpoint
// to call and the sample storage account for its scratch channel + published output, so
// it deploys only when those are present. The template also provisions a dedicated
// Azure Container Registry for the pipeline image (each deployment is self-contained —
// no shared/external registry), and grants the job's identity AcrPull on it.
var containerAppsEnvName = '${namePrefix}-cae-${amlSuffix}'
var logAnalyticsName = '${namePrefix}-logs-${amlSuffix}'
var auroraJobName = '${namePrefix}-aurora-job-${amlSuffix}'
var auroraJobIdentityName = '${namePrefix}-aurora-job-identity'
var auroraAcrName = toLower('pcproacr${amlSuffix}')
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
// Contributor — the in-template ACR build (az acr build) needs registries/scheduleRun/action
// to queue the ACR Task; AcrPull/AcrPush do not include it. Scoped to the registry only.
var acrContributorRoleId = 'b24988ac-6180-42a0-ab88-20f7382dd24c'
// Build the pipeline image into the auto-provisioned ACR at deploy time so the scheduled
// job can be created against a real manifest. Only when we own the registry — a supplied
// auroraJobImage is the caller's responsibility.
var buildAuroraImage = deployAuroraJob && empty(auroraJobImage)
// Scratch container the Aurora endpoint streams tensors through (the blob "channel").
var auroraChannelContainerName = 'aurora-channel'
var deployAuroraJob = deployAuroraSchedule && deployAuroraModel && deploySampleStorage
// By default the job pulls from the ACR this template provisions; an explicit
// auroraJobImage overrides it (bring-your-own registry / prebuilt image).
var auroraJobImageRef = !empty(auroraJobImage) ? auroraJobImage : '${auroraAcrName}.azurecr.io/aurora-pipeline:${auroraJobImageTag}'
// Configure image pull with the job's managed identity when the image lives in an ACR
// (the auto-provisioned one, or an external *.azurecr.io the caller supplied).
var auroraJobUsesAcr = deployAuroraJob && (empty(auroraJobImage) || contains(auroraJobImage, '.azurecr.io'))
var auroraJobRegistryServer = empty(auroraJobImage) ? '${auroraAcrName}.azurecr.io' : (contains(auroraJobImage, '.azurecr.io') ? split(auroraJobImage, '/')[0] : '')

// OneGrid Fabric plane (additive). The plane needs sample storage (for the model-outputs
// container the OneLake shortcut targets), so it only engages when that is present.
var deployFabricPlaneEffective = deployFabricPlane && deploySampleStorage
var fabricPlaneIdentityName = '${namePrefix}-fabricplane-identity'
// The OneGrid web app (Foundry + Container App) rides on top of the Fabric plane.
var deployOneGridAppEffective = deployFabricPlaneEffective && deployOneGridApp
// The chat/report web app (Azure App Service, Linux/Node) is a first-class ARM resource so
// ARM owns its lifecycle and its managed identity exists before the provisioner runs its
// Fabric/Kusto/PBI grants. The web app name must be GLOBALLY unique (Azure App
// Service names are unique across all of Azure), so it carries a uniqueString suffix
// derived from the resource group — stable per RG (redeploys reuse the same site) but
// distinct across RGs/subscriptions. The computed name is passed to the provisioner
// via CHAT_AGENT_APP_NAME so both sides agree (see onegrid-solution-provision.ps1).
var chatAgentAppName = '${namePrefix}-onegrid-app-${uniqueString(resourceGroup().id)}'
var chatAgentPlanName = '${chatAgentAppName}-plan'
// GeoCatalog Administrator (data-plane) — lets the web app identity browse tenant STAC
// collections/imagery under managed identity.
var geoCatalogAdminRoleId = 'c9c97b9c-105d-4bb5-a2a7-7d15666c2484'
// Optionally provision a Fabric capacity in-template instead of requiring an existing one.
var createFabricCapacityEffective = deployFabricPlaneEffective && createFabricCapacity
var fabricCapacityName = toLower('${namePrefix}${uniqueString(resourceGroup().id)}fab')
// Optionally have the provisioner create the storage connection via workspace identity
// (only when the caller didn't supply an existing connection id).
var createFabricConnectionEffective = deployFabricPlaneEffective && createFabricConnection && empty(fabricConnectionId)
// User Access Administrator — lets the Fabric-plane identity grant the workspace identity
// Storage Blob Data Reader on the sample storage account at deploy time.
var userAccessAdministratorRoleId = '18d7d88d-d35e-4fb5-a5c3-7773c20a72d9'
// Owner — the OneGrid provisioner creates resources AND Azure role assignments
// (grants the chat-app identity Storage Blob Data Reader / Cognitive Services User),
// which Contributor cannot do. Scoped to THIS resource group only.
var ownerRoleId = '8e3af657-a8ff-443c-a75c-2fe8c4bcb635'
// Phases handed to OneGrid deploy.ps1 -Only, mapped from the selected components.
// Base = the operational Fabric plane; +data seeds the historical demo dataset;
// +foundry/dataagent/chatagent stand up the AI + chat/report web app.
var ogPhasesBase = [ 'workspace', 'core', 'fabricplane', 'artifacts', 'semantic', 'oge', 'governance', 'permissions' ]
var ogPhases = concat(ogPhasesBase, deployOneGridData ? [ 'data' ] : [], deployOneGridApp ? [ 'foundry', 'dataagent', 'chatagent' ] : [])
var ogPhasesCsv = join(ogPhases, ',')

// ------------------------------------------------------------------------------------
// Core resource: the Planetary Computer Pro GeoCatalog
// ------------------------------------------------------------------------------------

resource geoCatalog 'Microsoft.Orbital/geoCatalogs@2026-04-15' = {
  name: effectiveGeoCatalogName
  location: location
  // Associate the ingestion managed identity so the managed-identity ingestion path
  // (bring-your-own-data) works without a manual portal step.
  identity: deploySampleStorage ? {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${ingestIdentity.id}': {}
    }
  } : null
  properties: {
    tier: geoCatalogTier
  }
}

// ------------------------------------------------------------------------------------
// Optional: sample-data storage + user-assigned managed identity (BYO-data ingestion)
// ------------------------------------------------------------------------------------

resource ingestIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = if (deploySampleStorage) {
  name: ingestIdentityName
  location: location
}

resource sampleStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = if (deploySampleStorage) {
  name: sampleStorageName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource sampleBlobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = if (deploySampleStorage) {
  parent: sampleStorage
  name: 'default'
}

resource sampleContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = if (deploySampleStorage) {
  parent: sampleBlobService
  name: sampleContainerName
  properties: {
    publicAccess: 'None'
  }
}

// Destination container for the Aurora weather-forecast model outputs produced by the
// storm-impact notebook.
resource modelOutputsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = if (deploySampleStorage) {
  parent: sampleBlobService
  name: modelOutputsContainerName
  properties: {
    publicAccess: 'None'
  }
}

// Scratch container the Aurora endpoint streams initial conditions and predictions
// through (the blob "channel"). Only needed when the scheduled forecast job is deployed.
resource auroraChannelContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = if (deployAuroraJob) {
  parent: sampleBlobService
  name: auroraChannelContainerName
  properties: {
    publicAccess: 'None'
  }
}

// Grant the ingestion identity read access to the sample container so a GeoCatalog
// managed-identity ingestion source can read the assets.
resource blobReaderAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (deploySampleStorage) {
  name: guid(sampleStorage.id, ingestIdentityName, storageBlobDataReaderRoleId)
  scope: sampleStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataReaderRoleId)
    principalId: deploySampleStorage ? ingestIdentity.properties.principalId : ''
    principalType: 'ServicePrincipal'
  }
}

// ------------------------------------------------------------------------------------
// Optional: OneGrid Fabric-plane identity + read grant (additive seam)
// A user-assigned managed identity for the OneGrid Fabric plane, granted Storage Blob
// Data Reader on the sample storage account so the OneLake shortcut to the model-outputs
// container (and anything reading Aurora's hazard geometry) resolves under a real
// identity. PCP's own resources are unchanged; this only ADDS an identity + a read role.
// ------------------------------------------------------------------------------------
resource fabricPlaneIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = if (deployFabricPlaneEffective) {
  name: fabricPlaneIdentityName
  location: location
}

// Optional: provision a Fabric capacity so the deployment doesn't require a pre-existing
// one. The in-template Fabric-plane identity is registered as a capacity admin so the
// headless provisioner can create the workspace and assign it to this capacity. An
// F-SKU is billed hourly until paused/deleted; ARM cannot create a free Trial capacity.
resource fabricCapacity 'Microsoft.Fabric/capacities@2023-11-01' = if (createFabricCapacityEffective) {
  name: fabricCapacityName
  location: location
  sku: {
    name: fabricCapacitySku
    tier: 'Fabric'
  }
  properties: {
    administration: {
      members: concat(
        [ fabricPlaneIdentity.properties.principalId ],
        empty(fabricCapacityAdmin) ? [] : [ fabricCapacityAdmin ]
      )
    }
  }
}

resource fabricPlaneBlobReaderRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (deployFabricPlaneEffective) {
  name: guid(sampleStorage.id, fabricPlaneIdentityName, storageBlobDataReaderRoleId)
  scope: sampleStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataReaderRoleId)
    principalId: deployFabricPlaneEffective ? fabricPlaneIdentity.properties.principalId : ''
    principalType: 'ServicePrincipal'
  }
}

// When the provisioner creates the storage connection via workspace identity, it must
// grant that workspace-identity service principal Storage Blob Data Reader at deploy time.
// Assigning a data-plane role requires roleAssignments/write, so give the Fabric-plane
// identity User Access Administrator scoped to the sample storage account only.
resource fabricPlaneStorageUaaRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (createFabricConnectionEffective) {
  name: guid(sampleStorage.id, fabricPlaneIdentityName, userAccessAdministratorRoleId)
  scope: sampleStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', userAccessAdministratorRoleId)
    principalId: createFabricConnectionEffective ? fabricPlaneIdentity.properties.principalId : ''
    principalType: 'ServicePrincipal'
  }
}

// When the OneGrid web app is included, the provisioner also creates the Foundry account
// and the chat/report Container App IN THIS RESOURCE GROUP and assigns data-plane roles to
// the app's identity. That requires resource-creation AND role-assignment rights, so the
// Fabric-plane identity is granted Owner scoped to this resource group only.
resource fabricPlaneRgOwner 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (deployOneGridAppEffective) {
  name: guid(resourceGroup().id, fabricPlaneIdentityName, ownerRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', ownerRoleId)
    principalId: deployOneGridAppEffective ? fabricPlaneIdentity.properties.principalId : ''
    principalType: 'ServicePrincipal'
  }
}

// The OneGrid chat/report web app is declared here as first-class ARM resources (App Service
// on Linux/Node) rather than being created imperatively inside the provisioner. Declaring the
// plan + site + its managed identity means ARM owns their lifecycle (a failure surfaces on the
// deployment instead of being silently swallowed by a script phase), and the app's identity
// exists minutes before the provisioner issues Fabric/Kusto/PBI grants \u2014 which avoids the
// "All provided principals must be existing" propagation errors. The provisioner's chatagent
// phase then only pushes code (Oryx build) and patches the Fabric-derived app settings it
// computes at run time.
resource chatAgentPlan 'Microsoft.Web/serverfarms@2023-12-01' = if (deployOneGridAppEffective) {
  name: chatAgentPlanName
  location: location
  kind: 'linux'
  sku: {
    name: chatAgentAppServiceSku
  }
  properties: {
    reserved: true
  }
}

resource chatAgentSite 'Microsoft.Web/sites@2023-12-01' = if (deployOneGridAppEffective) {
  name: chatAgentAppName
  location: location
  kind: 'app,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: chatAgentPlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      appCommandLine: 'node report-app/server/index.js'
      webSocketsEnabled: true
      alwaysOn: true
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      // Static settings only; the Fabric-derived env (endpoints, dataset/agent ids) is merged
      // in later by the provisioner via `az webapp config appsettings set` (which preserves
      // these). SCM_DO_BUILD_DURING_DEPLOYMENT lets Oryx build the SPA on zip deploy.
      appSettings: [
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'true' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~22' }
        { name: 'REPORT_PORT', value: '8080' }
        { name: 'WEBSITES_PORT', value: '8080' }
      ]
    }
  }
}

// Fabric-independent data-plane grants for the web app identity, declared here so they are in
// place (and propagated) before the provisioner runs. Foundry/Cognitive grants stay in the
// provisioner because the Foundry account may be created there (created-vs-reused).
resource chatAgentStorageReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (deployOneGridAppEffective) {
  name: guid(deployOneGridAppEffective ? sampleStorage.id : resourceGroup().id, chatAgentAppName, storageBlobDataReaderRoleId)
  scope: sampleStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataReaderRoleId)
    principalId: deployOneGridAppEffective ? chatAgentSite.identity.principalId : ''
    principalType: 'ServicePrincipal'
  }
}

resource chatAgentGeoCatalogAdmin 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (deployOneGridAppEffective) {
  name: guid(geoCatalog.id, chatAgentAppName, geoCatalogAdminRoleId)
  scope: geoCatalog
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', geoCatalogAdminRoleId)
    principalId: deployOneGridAppEffective ? chatAgentSite.identity.principalId : ''
    principalType: 'ServicePrincipal'
  }
}

// In-template provisioning of the whole OneGrid solution. Fabric workspaces/lakehouses/
// eventhouses/KQL, the AI Foundry account, and the chat/report Container App are not ARM
// resource types, so we run OneGrid's own orchestrator (deploy.ps1) headless as a
// deploymentScript (Azure PowerShell image → pwsh; git + az CLI installed at runtime),
// under the Fabric-plane identity. The selected components map to deploy.ps1 -Only phases
// (ogPhasesCsv). This is what makes the solution stand up alongside the PCP backend from
// the single Deploy button instead of a separate manual script run.
resource fabricPlaneScript 'Microsoft.Resources/deploymentScripts@2023-08-01' = if (deployFabricPlaneEffective) {
  name: '${namePrefix}-onegrid-provision'
  location: location
  kind: 'AzurePowerShell'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${fabricPlaneIdentity.id}': {}
    }
  }
  properties: {
    azPowerShellVersion: '11.5'
    retentionInterval: 'P1D'
    timeout: 'PT3H'
    cleanupPreference: 'OnSuccess'
    environmentVariables: [
      { name: 'SUBSCRIPTION_ID', value: subscription().subscriptionId }
      { name: 'LOCATION', value: location }
      { name: 'TARGET_RESOURCE_GROUP', value: resourceGroup().name }
      { name: 'NAME_PREFIX', value: namePrefix }
      { name: 'CHAT_AGENT_APP_NAME', value: chatAgentAppName }
      { name: 'IDENTITY_CLIENT_ID', value: deployFabricPlaneEffective ? fabricPlaneIdentity.properties.clientId : '' }
      { name: 'ONEGRID_REPO', value: oneGridRepoUrl }
      { name: 'ONEGRID_REF', value: oneGridRef }
      { name: 'ONEGRID_PHASES', value: ogPhasesCsv }
      { name: 'FABRIC_CAPACITY_ID', value: createFabricCapacityEffective ? fabricCapacity.id : fabricCapacityId }
      { name: 'FABRIC_WORKSPACE', value: fabricWorkspaceName }
      { name: 'FABRIC_CONNECTION_ID', value: fabricConnectionId }
      { name: 'PCP_CREATE_CONNECTION', value: string(createFabricConnectionEffective) }
      { name: 'PCP_STORAGE_ACCOUNT_NAME', value: sampleStorageName }
      { name: 'PCP_STORAGE_ACCOUNT_ID', value: deployFabricPlaneEffective ? sampleStorage.id : '' }
      { name: 'PCP_BLOB_ENDPOINT', value: deployFabricPlaneEffective ? sampleStorage.properties.primaryEndpoints.blob : '' }
      { name: 'PCP_DFS_ENDPOINT', value: deployFabricPlaneEffective ? sampleStorage.properties.primaryEndpoints.dfs : '' }
      { name: 'PCP_MODEL_CONTAINER', value: modelOutputsContainerName }
      { name: 'PCP_OPENAI_ENDPOINT', value: deployAiAgent ? openAi.properties.endpoint : '' }
      { name: 'PCP_OPENAI_ACCOUNT_ID', value: deployAiAgent ? openAi.id : '' }
      { name: 'PCP_GEOCATALOG_URI', value: geoCatalog.properties.catalogUri }
      { name: 'PCP_GEOCATALOG_ID', value: geoCatalog.id }
      { name: 'PCP_SAMPLE_CONTAINER', value: sampleContainerName }
      { name: 'PCP_AURORA_ENDPOINT', value: deployAuroraModel ? auroraEndpoint.properties.scoringUri : '' }
      { name: 'PCP_AURORA_DEPLOYED', value: string(deployAuroraDeployment) }
    ]
    scriptContent: loadTextContent('scripts/onegrid-solution-provision.ps1')
  }
  dependsOn: [
    fabricPlaneBlobReaderRole
    fabricPlaneRgOwner
    fabricPlaneStorageUaaRole
    modelOutputsContainer
    chatAgentSite
  ]
}

// ------------------------------------------------------------------------------------
// Optional: Azure OpenAI (Microsoft Foundry) — agentic / reasoning GeoAI scenarios
// ------------------------------------------------------------------------------------

resource openAi 'Microsoft.CognitiveServices/accounts@2024-10-01' = if (deployAiAgent) {
  name: openAiName
  location: location
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: openAiName
    publicNetworkAccess: 'Enabled'
  }
}

resource openAiDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = if (deployAiAgent) {
  parent: openAi
  name: openAiDeploymentName
  sku: {
    name: openAiSkuName
    capacity: openAiCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: openAiModelName
      version: openAiModelVersion
    }
    versionUpgradeOption: 'NoAutoUpgrade'
  }
}

// Grant the interactive deployer the same role so they can call Foundry with their sign-in.
resource openAiDeployerRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (deployAiAgent) {
  name: guid(openAi.id, deployer().objectId, cognitiveServicesOpenAiUserRoleId)
  scope: openAi
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesOpenAiUserRoleId)
    principalId: deployer().objectId
  }
}

// ------------------------------------------------------------------------------------
// Optional: Microsoft Aurora weather model on a Foundry (Azure ML) managed-compute GPU
// endpoint. The workspace + endpoint always deploy with this component; the GPU model
// deployment only runs when an Aurora model asset ID is supplied (it needs GPU quota +
// accepted marketplace terms).
// ------------------------------------------------------------------------------------

resource amlStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = if (deployAuroraModel) {
  name: amlStorageName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource amlKeyVault 'Microsoft.KeyVault/vaults@2023-07-01' = if (deployAuroraModel) {
  name: amlKeyVaultName
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    accessPolicies: []
  }
}

resource amlApplicationInsights 'Microsoft.Insights/components@2020-02-02' = if (deployAuroraModel) {
  name: amlApplicationInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
  }
}

resource amlWorkspace 'Microsoft.MachineLearningServices/workspaces@2023-10-01' = if (deployAuroraModel) {
  name: amlWorkspaceName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    friendlyName: amlWorkspaceName
    applicationInsights: amlApplicationInsights.id
    storageAccount: amlStorage.id
    keyVault: amlKeyVault.id
  }
}

resource auroraEndpoint 'Microsoft.MachineLearningServices/workspaces/onlineEndpoints@2023-10-01' = if (deployAuroraModel) {
  parent: amlWorkspace
  name: auroraEndpointName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    authMode: 'AADToken'
  }
}

resource auroraDeployment 'Microsoft.MachineLearningServices/workspaces/onlineEndpoints/deployments@2023-10-01' = if (deployAuroraDeployment) {
  parent: auroraEndpoint
  name: auroraDeploymentName
  location: location
  sku: {
    name: 'Default'
    capacity: 1
  }
  properties: {
    endpointComputeType: 'Managed'
    model: effectiveAuroraModelAssetId
    instanceType: auroraInstanceType
  }
}

// ------------------------------------------------------------------------------------
// Optional: scheduled Aurora forecast job on an Azure Container Apps Job. This is the
// production "make it live" trigger — a light CPU job that runs the pipeline
// (build initial conditions → call the Aurora GPU endpoint → track → publish
// weather-events.json) on the ECMWF cycle cadence. The GPU stays in the standing Foundry
// endpoint (as the Aurora Foundry docs assume); this job is just the scheduled client.
// It authenticates to the endpoint and storage with its own managed identity (no keys).
// ------------------------------------------------------------------------------------
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = if (deployAuroraJob) {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource containerAppsEnv 'Microsoft.App/managedEnvironments@2024-03-01' = if (deployAuroraJob) {
  name: containerAppsEnvName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: deployAuroraJob ? logAnalytics.properties.customerId : ''
        sharedKey: deployAuroraJob ? logAnalytics.listKeys().primarySharedKey : ''
      }
    }
  }
}

resource auroraJobIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = if (deployAuroraJob) {
  name: auroraJobIdentityName
  location: location
}

// Dedicated registry for the pipeline image so each deployment is self-contained (no
// shared/external ACR). Build the image into it once with `az acr build`.
resource auroraAcr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = if (deployAuroraJob && empty(auroraJobImage)) {
  name: auroraAcrName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
}

// Let the job pull its image from the auto-provisioned registry with its managed identity.
resource auroraJobAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (deployAuroraJob && empty(auroraJobImage)) {
  name: guid(auroraAcr.id, auroraJobIdentityName, acrPullRoleId)
  scope: auroraAcr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: deployAuroraJob ? auroraJobIdentity.properties.principalId : ''
    principalType: 'ServicePrincipal'
  }
}

// Give the same identity Contributor on the registry so the in-template build step can
// queue an ACR Task (az acr build). Scoped to the registry only.
resource auroraJobAcrContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (buildAuroraImage) {
  name: guid(auroraAcr.id, auroraJobIdentityName, acrContributorRoleId)
  scope: auroraAcr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrContributorRoleId)
    principalId: deployAuroraJob ? auroraJobIdentity.properties.principalId : ''
    principalType: 'ServicePrincipal'
  }
}

// Build the pipeline image INTO the auto-provisioned registry before the job is created.
// Container Apps validates the image manifest at create time, so an empty registry makes
// the job fail with MANIFEST_UNKNOWN. This server-side ACR Task build (az acr build) makes
// the one-click deploy self-contained — no manual post-deploy `az acr build`.
resource auroraImageBuild 'Microsoft.Resources/deploymentScripts@2023-08-01' = if (buildAuroraImage) {
  name: '${namePrefix}-aurora-image-build'
  location: location
  kind: 'AzureCLI'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${auroraJobIdentity.id}': {}
    }
  }
  properties: {
    azCliVersion: '2.62.0'
    retentionInterval: 'P1D'
    timeout: 'PT45M'
    cleanupPreference: 'OnSuccess'
    environmentVariables: [
      { name: 'ONEGRID_REPO', value: oneGridRepoUrl }
      { name: 'ONEGRID_REF', value: oneGridRef }
      { name: 'ACR_NAME', value: auroraAcrName }
      { name: 'IMAGE_TAG', value: auroraJobImageTag }
      { name: 'IDENTITY_CLIENT_ID', value: buildAuroraImage ? auroraJobIdentity.properties.clientId : '' }
      { name: 'SUBSCRIPTION_ID', value: subscription().subscriptionId }
    ]
    // Single-quoted string with explicit \n escapes so the compiled scriptContent is pure
    // LF. A multi-line ''' literal on a CRLF-saved file bakes in \r, which breaks bash in
    // the Linux container (e.g. "set: pipefail\r: invalid option name").
    scriptContent: 'set -euo pipefail\necho "az login --identity ($IDENTITY_CLIENT_ID)"\naz login --identity --username "$IDENTITY_CLIENT_ID" --allow-no-subscriptions -o none\naz account set --subscription "$SUBSCRIPTION_ID" -o none 2>/dev/null || true\nif ! command -v git >/dev/null 2>&1; then (apk add --no-cache git 2>/dev/null) || (apt-get update -y && apt-get install -y git); fi\nrm -rf /tmp/src\necho "cloning $ONEGRID_REPO ($ONEGRID_REF)"\ngit clone --depth 1 --branch "$ONEGRID_REF" "$ONEGRID_REPO" /tmp/src\ncd /tmp/src/planetary-computer-pro-poc\necho "building aurora-pipeline:$IMAGE_TAG into $ACR_NAME (ACR Task)"\naz acr build -r "$ACR_NAME" -t "aurora-pipeline:$IMAGE_TAG" aurora\necho "done"\n'
  }
  dependsOn: [
    auroraJobAcrContributor
  ]
}

// The job writes its scratch channel SAS and the published weather-events.json to the
// sample storage account, so it needs Storage Blob Data Contributor there.
resource auroraJobBlobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (deployAuroraJob) {
  name: guid(sampleStorage.id, auroraJobIdentityName, storageBlobDataContributorRoleId)
  scope: sampleStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataContributorRoleId)
    principalId: deployAuroraJob ? auroraJobIdentity.properties.principalId : ''
    principalType: 'ServicePrincipal'
  }
}

// The job invokes the Aurora online endpoint and mints its AAD token via managed
// identity, so it needs AzureML Data Scientist on the workspace (same as the web app).
resource auroraJobMlRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (deployAuroraJob) {
  name: guid(amlWorkspace.id, auroraJobIdentityName, azureMLDataScientistRoleId)
  scope: amlWorkspace
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', azureMLDataScientistRoleId)
    principalId: deployAuroraJob ? auroraJobIdentity.properties.principalId : ''
    principalType: 'ServicePrincipal'
  }
}

resource auroraJob 'Microsoft.App/jobs@2024-03-01' = if (deployAuroraJob) {
  name: auroraJobName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${auroraJobIdentity.id}': {}
    }
  }
  properties: {
    environmentId: containerAppsEnv.id
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: 3600
      replicaRetryLimit: 1
      scheduleTriggerConfig: {
        cronExpression: auroraJobCron
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: auroraJobUsesAcr ? [
        {
          server: auroraJobRegistryServer
          identity: auroraJobIdentity.id
        }
      ] : []
    }
    template: {
      containers: [
        {
          name: 'aurora-pipeline'
          image: auroraJobImageRef
          resources: {
            // Consumption Container Apps cap at cpu 2.0 / memory 4.0Gi; the heavy compute
            // runs on the GPU Foundry endpoint, the job just orchestrates the pipeline.
            cpu: json('2.0')
            memory: '4Gi'
          }
          env: [
            // Selects the job's user-assigned identity for DefaultAzureCredential.
            {
              name: 'AZURE_CLIENT_ID'
              value: deployAuroraJob ? auroraJobIdentity.properties.clientId : ''
            }
            {
              name: 'AURORA_ENDPOINT'
              value: deployAuroraModel ? auroraEndpoint.properties.scoringUri : ''
            }
            // Public, real-time NOAA GFS initial conditions (no credentials). With no
            // ANALYSIS_TIME set, the pipeline targets the latest available synoptic cycle.
            {
              name: 'INITIAL_CONDITION_SOURCE'
              value: 'gfs'
            }
            {
              name: 'AURORA_NUM_STEPS'
              value: '20'
            }
            {
              name: 'DETECTION_BBOX'
              value: '-100,15,-70,35'
            }
            {
              name: 'AURORA_BLOB_ACCOUNT_URL'
              value: deploySampleStorage ? sampleStorage.properties.primaryEndpoints.blob : ''
            }
            {
              name: 'AURORA_BLOB_CONTAINER'
              value: auroraChannelContainerName
            }
            {
              name: 'OUTPUT_CONTAINER_URL'
              value: deploySampleStorage ? '${sampleStorage.properties.primaryEndpoints.blob}${modelOutputsContainerName}' : ''
            }
            {
              name: 'OUTPUT_BLOB_NAME'
              value: 'weather-events.json'
            }
          ]
        }
      ]
    }
  }
  dependsOn: [
    // Ensure the image manifest exists in the registry before Container Apps validates it.
    auroraImageBuild
  ]
}

// ------------------------------------------------------------------------------------
// Outputs
// ------------------------------------------------------------------------------------
output geoCatalogResourceId string = geoCatalog.id
@description('The GeoCatalog URI (catalogUri), including the platform-assigned domain hash. Use as GEOCATALOG_URL for the ingest script and Explorer.')
output geoCatalogUri string = geoCatalog.properties.catalogUri
@description('Open the GeoCatalog in the portal and copy the GeoCatalog URI from the Overview blade; use it as GEOCATALOG_URL for the ingest script and Explorer.')
output geoCatalogPortalHint string = 'Portal → ${effectiveGeoCatalogName} → Overview → GeoCatalog URI'
output sampleStorageAccount string = deploySampleStorage ? sampleStorageName : 'not-deployed'
output sampleContainer string = deploySampleStorage ? sampleContainerName : 'not-deployed'
output sampleContainerUrl string = deploySampleStorage ? '${sampleStorage.properties.primaryEndpoints.blob}${sampleContainerName}' : 'not-deployed'
output aiAgentEndpoint string = deployAiAgent ? openAi.properties.endpoint : 'not-deployed'
output aiAgentDeployment string = deployAiAgent ? openAiDeploymentName : 'not-deployed'
output auroraWorkspace string = deployAuroraModel ? amlWorkspaceName : 'not-deployed'
output auroraEndpoint string = deployAuroraModel ? auroraEndpointName : 'not-deployed'
output auroraModelDeployed bool = deployAuroraDeployment
@description('Whether the scheduled Aurora forecast job (Container Apps Job) was deployed. Requires the Aurora model + sample storage components.')
output auroraScheduleDeployed bool = deployAuroraJob
output auroraJobName string = deployAuroraJob ? auroraJobName : 'not-deployed'
@description('Cron schedule (UTC) the Aurora forecast job runs on.')
output auroraJobSchedule string = deployAuroraJob ? auroraJobCron : 'not-deployed'
@description('Principal (object) ID of the Aurora job managed identity. AcrPull on the auto-provisioned registry is granted for you; grant it on any external registry you point auroraJobImage at.')
output auroraJobIdentityPrincipalId string = deployAuroraJob ? auroraJobIdentity.properties.principalId : 'not-deployed'
@description('Name of the auto-provisioned Azure Container Registry for the pipeline image (empty when a custom auroraJobImage is supplied).')
output auroraAcrName string = (deployAuroraJob && empty(auroraJobImage)) ? auroraAcrName : 'not-deployed'
@description('The pipeline image is built into the auto-provisioned registry automatically at deploy time. Use this command only to rebuild it manually (e.g. after changing the pipeline code).')
output auroraImageBuildCommand string = (deployAuroraJob && empty(auroraJobImage)) ? 'az acr build -r ${auroraAcrName} -t aurora-pipeline:${auroraJobImageTag} aurora' : 'not-applicable'
output ingestIdentityClientId string = deploySampleStorage ? ingestIdentity.properties.clientId : 'not-deployed'
output ingestIdentityObjectId string = deploySampleStorage ? ingestIdentity.properties.principalId : 'not-deployed'

// ------------------------------------------------------------------------------------
// OneGrid Fabric-plane outputs (additive). Fabric can't be provisioned by ARM, so these
// hand the Fabric plane everything it needs: the exact OneGrid `pcp` config (derived from
// this deployment's real resources) plus the command to run it. Feed fabricPlaneConfig
// into OneGrid's config.json (the wrapper deploy-onegrid-on-pcp.ps1 does this for you).
// ------------------------------------------------------------------------------------
@description('Whether the OneGrid Fabric plane was provisioned (workspace, lakehouse, eventhouse, hazard KQL, and identity + storage read grant) in this deployment.')
output fabricPlaneEnabled bool = deployFabricPlaneEffective
@description('Principal (object) ID of the OneGrid Fabric-plane managed identity (has Storage Blob Data Reader on the sample storage account).')
output fabricPlaneIdentityPrincipalId string = deployFabricPlaneEffective ? fabricPlaneIdentity.properties.principalId : 'not-deployed'
@description('Microsoft Fabric capacity id/GUID the OneGrid plane deploys onto (the auto-created capacity resource id when createFabricCapacity is true, otherwise the supplied value).')
output fabricPlaneCapacityId string = deployFabricPlaneEffective ? (createFabricCapacityEffective ? fabricCapacity.id : fabricCapacityId) : 'not-deployed'
@description('Result of the in-template Fabric provisioning: workspace/lakehouse/eventhouse ids, KQL apply status, and OneLake shortcut status.')
output fabricPlaneProvisionResult object = deployFabricPlaneEffective ? fabricPlaneScript.properties.outputs : {}
@description('Ready-to-run OneGrid config fragment (reuseExistingFoundry + fabric + pcp). Merge into OneGrid config.json; still set pcp.connectionId to a Fabric cloud connection for the OneLake shortcut.')
output fabricPlaneConfig object = deployFabricPlaneEffective ? {
  reuseExistingFoundry: deployAiAgent
  fabric: {
    capacityId: createFabricCapacityEffective ? fabricCapacity.id : fabricCapacityId
    workspaceName: fabricWorkspaceName
  }
  pcp: {
    storageAccountName: sampleStorageName
    storageAccountId: sampleStorage.id
    blobEndpoint: sampleStorage.properties.primaryEndpoints.blob
    modelOutputsContainer: modelOutputsContainerName
    shortcutName: 'pcp_model_outputs'
    connectionId: ''
    openAiEndpoint: deployAiAgent ? openAi.properties.endpoint : ''
    openAiAccountId: deployAiAgent ? openAi.id : ''
    geoCatalogUri: geoCatalog.properties.catalogUri
  }
} : {}
@description('The Fabric plane is provisioned in-template. If no fabricConnectionId was supplied, create a Fabric cloud connection to the sample storage account and re-deploy with fabricConnectionId set to add the OneLake shortcut to model-outputs.')
output fabricPlaneCommand string = deployFabricPlaneEffective ? (empty(fabricConnectionId) ? 'provisioned (set fabricConnectionId to add the OneLake shortcut)' : 'provisioned (shortcut included)') : 'not-applicable'

// ------------------------------------------------------------------------------------
// OneGrid solution outputs (the full-in-button path). These reflect exactly which OneGrid
// deploy.ps1 phases ran and, when the web app was included, where to reach it.
// ------------------------------------------------------------------------------------
@description('Whether the OneGrid web app (AI Foundry + chat/report Container App) was provisioned in this resource group.')
output oneGridAppEnabled bool = deployOneGridAppEffective
@description('OneGrid deploy.ps1 phases the in-template provisioner ran (mapped from the selected components).')
output oneGridPhases string = deployFabricPlaneEffective ? ogPhasesCsv : 'not-deployed'
@description('Public URL of the OneGrid chat/report web app (the ARM-declared App Service). Serves once the provisioner finishes the first Oryx build + code deploy.')
output oneGridAppUrl string = deployOneGridAppEffective ? 'https://${chatAgentSite.properties.defaultHostName}' : 'not-deployed'
