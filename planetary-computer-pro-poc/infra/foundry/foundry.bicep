// Azure AI Foundry (AIServices) account for the chat agent — Entra-only auth.
// Model deployments are created by deploy.ps1 (az cognitiveservices ... deployment create)
// so Anthropic/marketplace models can be added without editing this template.
@description('Foundry (AIServices) account name — becomes the inference endpoint host.')
param accountName string = 'pm-chatagent-foundry'
@description('Region.')
param location string = resourceGroup().location

resource account 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: accountName
  location: location
  kind: 'AIServices'
  sku: { name: 'S0' }
  identity: { type: 'SystemAssigned' }
  properties: {
    customSubDomainName: accountName
    publicNetworkAccess: 'Enabled'
    // Entra-only (no local keys) — the app uses managed identity.
    disableLocalAuth: true
  }
}

output endpoint string = account.properties.endpoint
output accountId string = account.id
