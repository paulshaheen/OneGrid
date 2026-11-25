// OneGrid baseline, full solution (greenfield): every component, including the Aurora GPU
// deployment and the scheduled forecast job.
// Replace the <your-...> placeholder before you deploy.
// Requires: dedicated A100 quota and accepted Aurora Marketplace terms in the region, and a
// deployer who can grant Microsoft Graph application permissions (Privileged Role
// Administrator or Global Administrator) for grantProvisionerGraphPermission.
// Twin of baseline-full.parameters.json; keep the two in sync.
using '../main.bicep'

param location = 'westeurope'
param exemptStorageFromPolicy = false

// Components
param deployGeoCatalog = true
param deploySampleStorage = true
param deployAiAgent = true
param openAiDeploymentName = 'gpt-5-mini'

// Aurora weather model and forecast job
param deployAuroraModel = true
param auroraInstanceType = 'Standard_NC24ads_A100_v4'
param createAuroraModelDeployment = true
param deployAuroraSchedule = true
param auroraJobCron = '0 1,7,13,19 * * *'

// Microsoft Fabric
param deployFabricPlane = true
param createFabricCapacity = true
param fabricCapacitySku = 'F2'
param fabricCapacityAdmin = '<your-capacity-admin-upn>'
param fabricWorkspaceName = 'OneGrid'
param createFabricConnection = true
param deployUnifiedModel = true

// Web app
param deployOneGridApp = true
param chatAgentAppServiceSku = 'B1'
param oneGridModules = [
  'exec'
  'weather'
  'twin'
  'infra'
  'sap'
  'esu'
  'onerig'
  'copilot'
]
param deployOneGridData = true

// Identity and sign-in
param enableEntraSignIn = true
param grantProvisionerGraphPermission = true

// Source. These are the template defaults and they track mutable sources; pin a release tag
// and a versioned package for production.
param oneGridAppPackageUrl = 'https://github.com/paulshaheen/OneGrid/releases/download/app-latest/onegrid-app.zip'
param oneGridRepoUrl = 'https://github.com/paulshaheen/OneGrid.git'
param oneGridRef = 'main'
