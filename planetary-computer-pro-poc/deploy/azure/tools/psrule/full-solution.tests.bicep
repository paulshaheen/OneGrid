// =====================================================================================
// PSRule for Azure test harness (not a deployment entry point).
//
// PSRule expands Bicep with the parameter values it is given, and resources whose
// condition is false are not analyzed. main.bicep on its own expands with its defaults,
// which leave the Fabric plane, web app, Aurora model and forecast job off. This file
// expands main.bicep with the full-solution component set so PSRule also analyzes those
// resources. ps-rule.yaml (repository root) includes *.tests.bicep files from this folder.
//
// The Microsoft Graph grant stays off: it needs a directory role at deployment time and
// PSRule does not analyze Graph extension resources.
//
// CI also builds this file in the bicep job, so a renamed or removed main.bicep parameter
// fails fast here instead of silently shrinking PSRule coverage.
// =====================================================================================
targetScope = 'resourceGroup'

module oneGridFullSolution '../../main.bicep' = {
  name: 'onegrid-full-solution'
  params: {
    location: 'westeurope'
    deployGeoCatalog: true
    deploySampleStorage: true
    deployAiAgent: true
    deployFabricPlane: true
    createFabricCapacity: true
    fabricCapacitySku: 'F2'
    createFabricConnection: true
    deployOneGridApp: true
    chatAgentAppServiceSku: 'P0v3'
    deployUnifiedModel: true
    deployOneGridData: false
    enableEntraSignIn: true
    grantProvisionerGraphPermission: false
    deployAuroraModel: true
    createAuroraModelDeployment: true
    deployAuroraSchedule: true
    exemptStorageFromPolicy: false
  }
}
