// OneGrid weather inference: the Aurora endpoint and GPU deployment, the scheduled forecast
// job, and the storage account it publishes weather-events.json to. No Fabric plane, web app,
// GeoCatalog, or Microsoft Foundry model.
// Requires dedicated A100 quota and accepted Aurora Marketplace terms in the region.
// Twin of weather-aurora.parameters.json; keep the two in sync.
using '../main.bicep'

param location = 'westeurope'

param deployGeoCatalog = false
param deploySampleStorage = true
param deployAiAgent = false

param deployAuroraModel = true
param auroraInstanceType = 'Standard_NC24ads_A100_v4'
param createAuroraModelDeployment = true
param deployAuroraSchedule = true
param auroraJobCron = '0 1,7,13,19 * * *'

param deployFabricPlane = false
param deployOneGridApp = false
param deployOneGridData = false
