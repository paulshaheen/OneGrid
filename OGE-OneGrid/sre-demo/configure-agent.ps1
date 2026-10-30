<#
.SYNOPSIS
  Wires the OneGrid MCP server into the Azure SRE Agent and routes the SRE demo
  alerts to it. Idempotent - safe to re-run.

  1. MCP connector "onegrid"        -> https://<pcpro>/mcp  (bearer = SRE_MCP_KEY)
  2. Sub-agent "onegrid-maintenance" -> uses onegrid/* tools; investigates equipment
                                        alarms and raises work orders after approval
  3. Response plans                  -> sre-demo-05 alerts -> onegrid-maintenance
                                        sre-demo-01..04    -> default agent
  All plans run in Review mode: the agent asks before it changes anything.

.EXAMPLE
  ./configure-agent.ps1 -McpKey (Get-Content mcp-key.txt -Raw).Trim()
#>
param(
  [Parameter(Mandatory)] [string] $McpKey,
  [string] $Subscription = '87bc8fc7-c4b7-4466-80b8-a7d5004b4f14',
  [string] $AgentResourceGroup = 'rg-onegrid-sre',
  [string] $AgentName = 'onegrid-sre-agent',
  [string] $McpUrl = 'https://pcpro-onegrid-app-ujcb2qv6vi2ts.azurewebsites.net/mcp',
  [string] $ApiVersion = '2025-05-01-preview'
)
$ErrorActionPreference = 'Stop'
$agentId = "/subscriptions/$Subscription/resourceGroups/$AgentResourceGroup/providers/Microsoft.App/agents/$AgentName"

function Invoke-Arm([string]$Method, [string]$Path, $Body) {
  $tok = az account get-access-token --resource https://management.azure.com --query accessToken -o tsv
  $p = @{ Uri = "https://management.azure.com$Path`?api-version=$ApiVersion"; Method = $Method; Headers = @{ Authorization = "Bearer $tok" }; ContentType = 'application/json' }
  if ($null -ne $Body) { $p.Body = ($Body | ConvertTo-Json -Depth 20 -Compress) }
  Invoke-RestMethod @p
}

$endpoint = (Invoke-Arm GET $agentId).properties.agentEndpoint.TrimEnd('/')
Write-Host "Agent endpoint: $endpoint"

function Invoke-Agent([string]$Method, [string]$Path, $Body) {
  $tok = az account get-access-token --resource https://azuresre.dev --query accessToken -o tsv
  $p = @{ Uri = "$endpoint$Path"; Method = $Method; Headers = @{ Authorization = "Bearer $tok" }; ContentType = 'application/json'; TimeoutSec = 60 }
  if ($null -ne $Body) { $p.Body = ($Body | ConvertTo-Json -Depth 20 -Compress) }
  for ($i = 1; $i -le 4; $i++) {
    try { return Invoke-RestMethod @p }
    catch { if ($i -eq 4) { throw }; Write-Host "  retry $i ($($_.Exception.Message))"; Start-Sleep 15 }
  }
}

# 1. MCP connector ------------------------------------------------------------
Write-Host '1. MCP connector onegrid'
$null = Invoke-Arm PUT "$agentId/DataConnectors/onegrid" @{
  properties = @{
    dataConnectorType  = 'Mcp'
    dataSource         = $McpUrl
    extendedProperties = @{ type = 'http'; endpoint = $McpUrl; authType = 'BearerToken'; bearerToken = $McpKey }
    identity           = 'system'
  }
}

# 2. Sub-agent ------------------------------------------------------------------
Write-Host '2. Sub-agent onegrid-maintenance'
$prompt = @'
You are the OneGrid maintenance reliability specialist. OneGrid is the operations platform for a fleet of power plants and offshore assets.
You handle equipment-condition alerts raised from OneGrid telemetry (for example sre-demo-05-bearing-vibration). These are equipment problems, not Azure infrastructure problems: do not change any Azure resource.

Procedure:
1. Call get_active_alarms to see the alarm, the asset and the current readings.
2. Call get_sensor_trend for that asset (15 minutes). Quantify how fast each sensor is rising, which sensors moved together, and how far they are from their 6-hour baseline.
3. Call get_asset_context for root cause, failure predictions and open work orders.
4. Diagnose: state the failure mode, your confidence, and the consequence. Estimate time to trip at the current rate of rise.
5. Propose exactly ONE corrective work order: a one-line problem statement, priority (emergency, urgent, high or routine), the recommended work including interim operating limits (for example reduce load, increase monitoring), and the key evidence.
6. Ask the user to approve it. Do NOT call create_work_order until a human explicitly approves in this conversation. Pass the approver's name as approved_by.
7. After it is created, report the work order id and that it is visible in OneGrid Maintenance and the executive brief.

Keep the report short and plain: what we see, what it means, what it costs if ignored, what to do.
'@
$null = Invoke-Agent PUT '/api/v2/extendedAgent/agents/onegrid-maintenance' @{
  name = 'onegrid-maintenance'; type = 'ExtendedAgent'; tags = @()
  properties = @{
    description         = 'Investigates OneGrid equipment alarms (vibration, temperature) and raises corrective work orders after human approval.'
    handoff_description = 'Use for OneGrid equipment-condition alarms such as turbine vibration or bearing temperature, and for creating maintenance work orders.'
    system_prompt       = $prompt
    tools               = @()
    mcp_tools           = @('onegrid/*')
    handoffs            = @()
  }
}

# 3. Response plans -------------------------------------------------------------
Write-Host '3. Response plans'
$plans = @(
  @{ id = 'sre-demo-05-equipment'; name = 'OneGrid equipment alarms (demo 05)'; titleContains = 'sre-demo-05'; handlingAgent = 'onegrid-maintenance' }
  @{ id = 'sre-demo-01-storage';  name = 'Storage access (demo 01)';  titleContains = 'sre-demo-01'; handlingAgent = '' }
  @{ id = 'sre-demo-02-deploy';   name = 'Bad deployment (demo 02)';  titleContains = 'sre-demo-02'; handlingAgent = '' }
  @{ id = 'sre-demo-03-capacity'; name = 'Fabric capacity (demo 03)'; titleContains = 'sre-demo-03'; handlingAgent = '' }
  @{ id = 'sre-demo-04-sensor';   name = 'Faulty sensor (demo 04)';   titleContains = 'sre-demo-04'; handlingAgent = '' }
)
foreach ($p in $plans) {
  $body = $p + @{ priorities = @('Sev0', 'Sev1', 'Sev2', 'Sev3', 'Sev4'); agentMode = 'review'; maxAttempts = 3 }
  $null = Invoke-Agent PUT "/api/v1/incidentPlayground/filters/$($p.id)" $body
  Write-Host "   $($p.id) -> $(if ($p.handlingAgent) { $p.handlingAgent } else { 'default agent' })"
}

# Verify ------------------------------------------------------------------------
Start-Sleep 10
$c = Invoke-Arm GET "$agentId/DataConnectors/onegrid"
Write-Host "Connector state: $($c.properties.provisioningState) $($c.properties.status)"
(Invoke-Agent GET '/api/v1/incidentPlayground/filters' $null) | ConvertTo-Json -Depth 5 -Compress | Write-Host
