// -----------------------------------------------------------------------------
// Azure SRE Agent for the OneGrid SRE demo (Microsoft.App/agents).
// Adapted from F0bsterz/azure-sre-agent-demo-lab (MIT).
//
// The agent gets its own user-assigned identity with NO role assignments here;
// access is granted deliberately and narrowly by sre-demo/grant-agent-access.ps1.
// -----------------------------------------------------------------------------

@minLength(2)
@maxLength(32)
param name string = 'onegrid-sre-agent'

@description('Region for the agent (SRE Agent is not offered in eastus).')
param location string = 'eastus2'

@allowed([ 'ReadOnly', 'Review', 'Autonomous' ])
param mode string = 'Review'

@allowed([ 'Low', 'High' ])
param accessLevel string = 'Low'

@description('Application Insights AppId the agent reads telemetry from (pcpro-ai-ujcb2qv6).')
param appInsightsAppId string

@secure()
param appInsightsConnectionString string

@description('Object ID granted SRE Agent Administrator so the agent UI is reachable.')
param deployerObjectId string

@description('Resource groups the agent manages; Azure Monitor alerts from these flow to the agent.')
param managedResourceGroupIds array = []

param tags object = {
  purpose: 'onegrid-sre-demo'
}

resource agentIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${name}'
  location: location
  tags: tags
}

resource agent 'Microsoft.App/agents@2026-01-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    // Both are required: user-assigned carries connector auth + Azure RBAC; system-assigned
    // backs the agent itself (UserAssigned alone lands on the Public Preview generation).
    type: 'SystemAssigned,UserAssigned'
    userAssignedIdentities: {
      '${agentIdentity.id}': {}
    }
  }
  properties: {
    upgradeChannel: 'Stable'
    actionConfiguration: {
      mode: mode
      accessLevel: accessLevel
      identity: agentIdentity.id
    }
    logConfiguration: {
      applicationInsightsConfiguration: {
        appId: appInsightsAppId
        connectionString: appInsightsConnectionString
      }
    }
    // Azure Monitor as the incident platform: alerts in the managed resource groups
    // reach the agent automatically (no credentials needed).
    incidentManagementConfiguration: {
      type: 'AzMonitor'
      connectionName: 'azmonitor'
    }
    knowledgeGraphConfiguration: {
      identity: agentIdentity.id
      managedResources: managedResourceGroupIds
    }
  }
}

// Control-plane Owner does not cover the agent data plane; without this the UI 401s.
var sreAgentAdministratorRoleId = 'e79298df-d852-4c6d-84f9-5d13249d1e55'

resource deployerAgentAdmin 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(agent.id, deployerObjectId, sreAgentAdministratorRoleId)
  scope: agent
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', sreAgentAdministratorRoleId)
    principalId: deployerObjectId
  }
}

output agentId string = agent.id
output agentEndpoint string = agent.properties.agentEndpoint
output principalId string = agentIdentity.properties.principalId
output identityId string = agentIdentity.id
