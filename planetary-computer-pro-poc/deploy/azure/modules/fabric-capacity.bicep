// ------------------------------------------------------------------------------------
// Nested deployment: Microsoft Fabric capacity (isolation seam)
//
// The Fabric capacity is deployed here as a NESTED deployment rather than as a resource
// in the parent template on purpose. A Fabric F-SKU with no regional quota sits in
// "Creating" for a long time before it fails, and when it lives directly in the parent
// deployment that stalled resource starves the parent's scheduler - the independent
// app-plane provisioner (GeoCatalog/Foundry/storage/Aurora wiring) ends up waiting ~an
// hour behind it. Isolating the capacity in its own child deployment means the parent
// only tracks a lightweight Microsoft.Resources/deployments resource, so the app plane
// runs in parallel and wires immediately regardless of what the capacity does. The
// fabric-plane provisioner still depends on this module's output, so it correctly waits
// for (and is skipped/failed by) the capacity - but nothing else is held hostage by it.
// ------------------------------------------------------------------------------------

@description('Name of the Fabric capacity to create.')
param capacityName string

@description('Azure region for the capacity.')
param location string

@description('Fabric capacity SKU (F2..F2048).')
param sku string

@description('Object id of the in-template Fabric-plane identity. Always registered as a capacity admin so the headless provisioner can create/assign the workspace.')
param fabricPlanePrincipalId string

@description('Optional additional Fabric capacity administrator (UPN/email or Entra object id).')
param fabricCapacityAdmin string = ''

resource fabricCapacity 'Microsoft.Fabric/capacities@2023-11-01' = {
  name: capacityName
  location: location
  sku: {
    name: sku
    tier: 'Fabric'
  }
  properties: {
    administration: {
      members: concat(
        [ fabricPlanePrincipalId ],
        empty(fabricCapacityAdmin) ? [] : [ fabricCapacityAdmin ]
      )
    }
  }
}

@description('Resource id of the created Fabric capacity.')
output capacityId string = fabricCapacity.id
