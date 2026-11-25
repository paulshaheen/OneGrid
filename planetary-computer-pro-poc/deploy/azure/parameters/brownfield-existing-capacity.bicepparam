// OneGrid brownfield: reuse an existing Fabric capacity, sign-in app registration, and
// Import-model refresh service principal instead of creating them.
// Replace every <your-...> placeholder before you deploy.
// The refresh secret comes from Azure Key Vault at deployment time; never put it in this file.
// Twin of brownfield-existing-capacity.parameters.json; keep the two in sync.
using '../main.bicep'

param location = 'westeurope'

// Components (the portal form's default selection)
param deployGeoCatalog = true
param deploySampleStorage = true
param deployAiAgent = true
param deployAuroraModel = false
param deployAuroraSchedule = false
param deployFabricPlane = true
param deployOneGridApp = true
param deployOneGridData = true

// Existing Fabric capacity: resource ID (/subscriptions/.../providers/Microsoft.Fabric/
// capacities/<name>) or capacity GUID. pcpro-fabricplane-identity needs Contributor or Admin
// rights on it.
param createFabricCapacity = false
param fabricCapacityId = '<your-fabric-capacity-resource-id>'
param fabricWorkspaceName = 'OneGrid'
param createFabricConnection = true
param deployUnifiedModel = true

// Existing sign-in app registration (SPA). Add https://<app-host>/auth/callback as a SPA
// redirect URI after the deployment; the provisioner doesn't add it to a pre-created app.
param enableEntraSignIn = true
param entraSignInClientId = '<your-sign-in-app-client-id>'

// Existing refresh service principal for the Import semantic model.
param grantProvisionerGraphPermission = false
param refreshServicePrincipalClientId = '<your-refresh-sp-client-id>'
param refreshServicePrincipalObjectId = '<your-refresh-sp-object-id>'
param refreshServicePrincipalSecret = az.getSecret('<your-subscription-id>', '<your-key-vault-resource-group>', '<your-key-vault-name>', '<your-refresh-sp-secret-name>')
