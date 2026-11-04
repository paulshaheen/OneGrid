<#
.SYNOPSIS
  Wires the OneGrid MCP server into the Azure SRE Agent and routes the SRE demo
  alerts to it. Idempotent - safe to re-run.

  1. MCP connector "onegrid"        -> https://<pcpro>/mcp  (bearer = SRE_MCP_KEY)
  2. Sub-agent "onegrid-maintenance" -> uses onegrid/* tools; investigates equipment
                                        alarms (05) and sensor faults (04) and proposes a
                                        work order that a human approves or rejects on the
                                        OneGrid SRE page
  3. Response plans                  -> sre-demo-01..03 alerts -> default agent
                                        (04's and 05's plans are off: OneGrid pages the agent
                                        directly through the HTTP triggers)
  4. HTTP triggers                   -> onegrid-equipment-alarm (05) and onegrid-sensor-fault
                                        (04) -> onegrid-maintenance
  All plans and the trigger run in Review mode: the agent asks before it changes anything.

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
    catch {
      $code = [int]$_.Exception.Response.StatusCode
      if ($i -eq 4 -or ($code -ge 400 -and $code -lt 500 -and $code -ne 429)) { throw }
      Write-Host "  retry $i ($($_.Exception.Message))"; Start-Sleep 15
    }
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
You handle two kinds of alerts raised from OneGrid telemetry. Both are equipment problems, not Azure infrastructure problems: do not change any Azure resource.

A. Equipment alarms (sre-demo-05-bearing-vibration, or OneGrid paging you through the onegrid-equipment-alarm trigger):
1. Call get_active_alarms to see the alarm, the asset and the current readings.
2. Call get_sensor_trend for that asset (15 minutes). Quantify how fast each sensor is rising, which sensors moved together, and how far they are from their 6-hour baseline.
3. Call get_asset_context for root cause, failure predictions and open work orders.
4. Diagnose: state the failure mode, your confidence, and the consequence. Estimate time to trip at the current rate of rise.

B. Sensor faults (sre-demo-04-sensor-fault: the sensor-health check found a flatlined sensor):
1. Call get_sensor_health to identify the faulty sensor, its asset, the flat value and since when.
2. Call get_sensor_trend for that asset (60 minutes) to confirm the flatline and check whether companion sensors are still live (a single dead channel versus a whole-feed stall).
3. Call get_asset_context: what risk is the dead sensor hiding (root cause, failure predictions, open work orders)?
4. Diagnose the instrument failure (transducer, cabling, signal conditioner or control-system channel) and what is now unmonitored.

Then, for both:
5. Propose exactly ONE corrective work order with propose_work_order: a one-line problem statement, priority (emergency, urgent, high or routine), the recommended work including interim measures (for example reduce load, portable or manual readings, increased monitoring), and the key evidence. Always submit it, even if older work orders exist for the asset; if it reports a duplicate, report that work order instead.
6. Do NOT ask for approval in this conversation. The proposal appears on the OneGrid SRE page as "Pending approval", where a human approves or rejects it; it becomes a real work order only when they approve.
7. Report the work order id and tell the user it is waiting for their decision on the OneGrid SRE page (it then shows in OneGrid Maintenance and the executive brief).

Keep the report short and plain: what we see, what it means, what it costs if ignored, what to do.
'@
$null = Invoke-Agent PUT '/api/v2/extendedAgent/agents/onegrid-maintenance' @{
  name = 'onegrid-maintenance'; type = 'ExtendedAgent'; tags = @(); owner = ''
  properties = @{
    instructions           = $prompt
    handoffDescription     = 'Use for OneGrid equipment-condition alarms (turbine vibration, bearing temperature) and sensor faults (flatlined sensors), and for proposing maintenance work orders.'
    tools                  = @()
    mcpTools               = @('onegrid/*')
    handoffs               = @()
    allowParallelToolCalls = $true
    enableSkills           = $true
  }
}

# 3. Response plans -------------------------------------------------------------
Write-Host '3. Response plans'
$plans = @(
  # Demo 05 is paged directly by OneGrid through the HTTP trigger below, so its alert plan is
  # off to avoid a second investigation (the Azure alert still fires and shows on the page).
  @{ id = 'sre-demo-05-equipment'; name = 'OneGrid equipment alarms (demo 05)'; titleContains = 'sre-demo-05'; handlingAgent = 'onegrid-maintenance'; isEnabled = $false }
  @{ id = 'sre-demo-01-storage';  name = 'Storage access (demo 01)';  titleContains = 'sre-demo-01'; handlingAgent = '' }
  @{ id = 'sre-demo-02-deploy';   name = 'Bad deployment (demo 02)';  titleContains = 'sre-demo-02'; handlingAgent = '' }
  @{ id = 'sre-demo-03-capacity'; name = 'Fabric capacity (demo 03)'; titleContains = 'sre-demo-03'; handlingAgent = '' }
  @{ id = 'sre-demo-04-sensor';   name = 'Faulty sensor (demo 04)';   titleContains = 'sre-demo-04'; handlingAgent = 'onegrid-maintenance'; isEnabled = $false }
)
foreach ($p in $plans) {
  # No merging: every injection gets its own thread and a fresh investigation.
  $body = $p + @{ priorities = @('Sev0', 'Sev1', 'Sev2', 'Sev3', 'Sev4'); agentMode = 'review'; mergeEnabled = $false }
  # PUT creates a plan; an existing plan must be updated with POST.
  try { $null = Invoke-Agent PUT "/api/v1/incidentPlayground/filters/$($p.id)" $body }
  catch { if ([int]$_.Exception.Response.StatusCode -ne 409 -and $_.ErrorDetails.Message -notmatch 'already exists') { throw }
          $null = Invoke-Agent POST "/api/v1/incidentPlayground/filters/$($p.id)" $body }
  Write-Host "   $($p.id) -> $(if ($p.handlingAgent) { $p.handlingAgent } else { 'default agent' })"
}

# 4. HTTP triggers ---------------------------------------------------------------
# OneGrid calls these the moment it detects the problem (demo 05: the live alarm trips; demo
# 04: the sensor-health check finds the flatline), so the investigation starts in seconds
# instead of waiting for Azure Monitor (~2 minutes for 05, 5+ minutes for 04's availability
# test). Each call opens a new thread. Callers need SRE Agent Standard User (grant-access.ps1).
function Set-Trigger([string]$Name, [string]$Description, [string]$Prompt) {
  $body = @{ name = $Name; description = $Description; agentPrompt = $Prompt; agent = 'onegrid-maintenance'; agentMode = 'review' }
  $existing = @(Invoke-Agent GET '/api/v1/httptriggers' $null) | Where-Object { $_.name -eq $Name } | Select-Object -First 1
  if ($existing) {
    try { $null = Invoke-Agent PUT "/api/v1/httptriggers/$($existing.id)" $body }
    catch { Write-Warning "   could not update trigger $Name ($($_.Exception.Message)); keeping it as is" }
    return $existing.triggerUrl
  }
  return (Invoke-Agent POST '/api/v1/httptriggers/create' $body).triggerUrl
}
$common = 'Do not ask for approval in this conversation: a human approves or rejects the proposal on the OneGrid SRE page. Do not change any Azure resource. Keep the report short: what we see, what it means, what it costs if ignored, what to do.'

Write-Host '4. HTTP triggers'
$alarmUrl = Set-Trigger 'onegrid-equipment-alarm' 'OneGrid pages the agent the moment a live equipment alarm trips (SRE demo 05).' (@'
OneGrid has raised a live equipment alarm (scenario sre-demo-05). The JSON payload in this request has the asset, the sensor readings, thresholds and when the alarm tripped.
Investigate it as the OneGrid maintenance reliability specialist: call get_active_alarms, then get_sensor_trend (15 minutes) and get_asset_context for the asset, diagnose the failure mode with your confidence and time to trip, then submit exactly ONE corrective work order with propose_work_order.
'@ + $common)
$sensorUrl = Set-Trigger 'onegrid-sensor-fault' 'OneGrid pages the agent the moment its sensor-health check finds a flatlined sensor (SRE demo 04).' (@'
OneGrid's sensor-health check has found a faulty (flatlined) sensor (scenario sre-demo-04). The JSON payload in this request has the sensor tag, the asset, the flat value and how many readings.
Investigate it as the OneGrid maintenance reliability specialist, following your sensor-fault procedure: call get_sensor_health (if it does not list the sensor yet, the scan can lag a few seconds: use the payload and check again), then get_sensor_trend (60 minutes) and get_asset_context for the asset, diagnose the instrument failure and what is now unmonitored, then submit exactly ONE repair work order with propose_work_order.
'@ + $common)
Write-Host "   onegrid-equipment-alarm: $alarmUrl"
Write-Host "   onegrid-sensor-fault:    $sensorUrl"
Write-Host "   set them on each site running the demo (pcpro: az webapp config appsettings set ...; live site: az containerapp update --set-env-vars ...):"
Write-Host "     SRE_DEMO_AGENT_TRIGGER_URL=$alarmUrl"
Write-Host "     SRE_DEMO_SENSOR_TRIGGER_URL=$sensorUrl"

# Verify ------------------------------------------------------------------------
Start-Sleep 10
$c = Invoke-Arm GET "$agentId/DataConnectors/onegrid"
Write-Host "Connector state: $($c.properties.provisioningState) $($c.properties.status)"
(Invoke-Agent GET '/api/v1/incidentPlayground/filters' $null) | ConvertTo-Json -Depth 5 -Compress | Write-Host
