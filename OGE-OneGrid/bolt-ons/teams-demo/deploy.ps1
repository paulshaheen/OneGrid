<#
  OneGrid — Microsoft Teams demo bolt-on deploy.
  ---------------------------------------------------------------------------
  Provisions everything needed to talk to the OneGrid assistant from Teams:

    1. An Entra app registration (bot identity) + client secret.
    2. A Container App running the Microsoft 365 Agents SDK bot (this folder's
       bot/), which proxies questions to your deployed OneGrid app.
    3. An Azure Bot resource wired to the container's /api/messages endpoint,
       with the Microsoft Teams channel enabled.
    4. A ready-to-sideload Teams app package (appPackage.<botId>.zip).

  This bolt-on is intentionally NOT part of the main wizard (deploy.ps1). It is
  a self-contained demo you run on top of an already-deployed OneGrid app.

  Prereqs: Azure CLI (az login), permission to create app registrations, and an
  existing OneGrid app URL. Run:

    ./deploy.ps1 -OneGridAppUrl "https://<your-onegrid-app>" -ResourceGroup rg-onegrid-teams
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $OneGridAppUrl,
  [string] $ResourceGroup = "rg-onegrid-teams",
  [string] $Location = "eastus2",
  [string] $BotName = "onegrid-teams-bot",
  [string] $AppName = "onegrid-teams-bot",
  [string] $SubscriptionId
)

$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
function Log($m, $c = "Cyan") { Write-Host $m -ForegroundColor $c }

if ($SubscriptionId) { az account set --subscription $SubscriptionId | Out-Null }
$sub = (az account show --query id -o tsv)
$tenantId = (az account show --query tenantId -o tsv)
$OneGridAppUrl = $OneGridAppUrl.TrimEnd('/')
Log "Subscription : $sub"
Log "Tenant       : $tenantId"
Log "OneGrid app  : $OneGridAppUrl"

# Ensure extensions
if (-not (az extension show -n containerapp 2>$null)) { az extension add -n containerapp --only-show-errors | Out-Null }
az provider register -n Microsoft.App --wait 2>$null | Out-Null
az provider register -n Microsoft.BotService --wait 2>$null | Out-Null

az group create -n $ResourceGroup -l $Location -o none

# ---- 1) Bot identity: Entra app registration + secret ----------------------
Log "`n[1/5] Entra app registration ..."
$appId = az ad app list --display-name $BotName --query "[0].appId" -o tsv
if (-not $appId) {
  $appId = az ad app create --display-name $BotName --sign-in-audience AzureADMyOrg --query appId -o tsv
  Log "  created app $appId"
} else { Log "  reusing app $appId" }
# The bot authenticates via client credentials, which requires a service principal
# (enterprise app) for the registration — 'az ad app create' does not create one.
az ad sp create --id $appId 2>$null | Out-Null
Log "  service principal ensured"
$secret = az ad app credential reset --id $appId --append --display-name "onegrid-teams" --years 1 --query password -o tsv
Log "  client secret generated"

# ---- 2) Build the bot image via ACR ---------------------------------------
Log "`n[2/5] Building bot image ..."
$acr = 'acrteams' + [guid]::NewGuid().ToString('N').Substring(0, 12)
$tag = 'v' + (Get-Date -f 'yyyyMMddHHmmss')
az acr create -n $acr -g $ResourceGroup -l $Location --sku Basic --admin-enabled true -o none
$image = "$acr.azurecr.io/$AppName`:$tag"
# az acr build streams a Unicode glyph that can crash the CLI on Windows (cp1252);
# run it in a background job and poll the ACR run status instead.
$log = Join-Path $env:TEMP "teamsbot_$tag.log"
$job = Start-Job -ScriptBlock {
  param($acr, $app, $tag, $ctx, $log)
  $env:PYTHONUTF8 = '1'; $env:PYTHONIOENCODING = 'utf-8'
  az acr build --registry $acr --image ($app + ':' + $tag) $ctx *> $log 2>&1
} -ArgumentList $acr, $AppName, $tag, (Join-Path $Here 'bot'), $log
$built = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep 15
  $st = az acr task list-runs --registry $acr --top 1 --query "[0].status" -o tsv 2>$null
  if ($st -eq 'Succeeded') { $built = $true; break }
  if ($st -in @('Failed', 'Canceled', 'Error')) { break }
}
Stop-Job $job -ErrorAction SilentlyContinue; Remove-Job $job -Force -ErrorAction SilentlyContinue
if (-not $built) { throw "ACR build did not succeed (log: $log)" }
Log "  image built: $image"
$acrUser = az acr credential show -n $acr --query username -o tsv
$acrPass = az acr credential show -n $acr --query "passwords[0].value" -o tsv

# ---- 3) Container App running the bot --------------------------------------
Log "`n[3/5] Deploying bot container app ..."
$envName = "$AppName-env"
if (-not (az containerapp env show -n $envName -g $ResourceGroup 2>$null)) {
  az containerapp env create -n $envName -g $ResourceGroup -l $Location -o none
}
$envVars = @(
  "ONEGRID_APP_URL=$OneGridAppUrl",
  "clientId=$appId",
  "clientSecret=$secret",
  "tenantId=$tenantId",
  "authType=ClientSecret",
  "PORT=3978"
)
az containerapp create -n $AppName -g $ResourceGroup --environment $envName `
  --image $image --registry-server "$acr.azurecr.io" --registry-username $acrUser --registry-password $acrPass `
  --target-port 3978 --ingress external --min-replicas 1 --max-replicas 1 --cpu 0.5 --memory 1Gi `
  --env-vars @envVars -o none
$fqdn = az containerapp show -n $AppName -g $ResourceGroup --query properties.configuration.ingress.fqdn -o tsv
$messagingEndpoint = "https://$fqdn/api/messages"
Log "  bot endpoint: $messagingEndpoint"

# ---- 4) Azure Bot resource + Teams channel (via ARM REST) ------------------
# The 'botservice' az CLI extension has been retired, so we create the bot and enable
# the Microsoft Teams channel directly through the Microsoft.BotService ARM API.
Log "`n[4/5] Azure Bot + Teams channel ..."
$armTok = az account get-access-token --resource "https://management.azure.com" --query accessToken -o tsv
$armH = @{ Authorization = "Bearer $armTok"; 'Content-Type' = 'application/json' }
$botBase = "https://management.azure.com/subscriptions/$sub/resourceGroups/$ResourceGroup/providers/Microsoft.BotService/botServices/$BotName"
$botBody = @{
  location   = 'global'
  sku        = @{ name = 'F0' }
  kind       = 'azurebot'
  properties = @{
    displayName    = 'OneGrid Assistant'
    endpoint       = $messagingEndpoint
    msaAppId       = $appId
    msaAppType     = 'SingleTenant'
    msaAppTenantId = $tenantId
  }
} | ConvertTo-Json -Depth 8
$rb = Invoke-WebRequest -Method Put -Headers $armH -Uri "$botBase`?api-version=2022-09-15" -Body $botBody -SkipHttpErrorCheck
Log "  bot resource -> $($rb.StatusCode)"
$chanBody = @{
  location   = 'global'
  properties = @{ channelName = 'MsTeamsChannel'; properties = @{ isEnabled = $true } }
} | ConvertTo-Json -Depth 8
$rc = Invoke-WebRequest -Method Put -Headers $armH -Uri "$botBase/channels/MsTeamsChannel`?api-version=2022-09-15" -Body $chanBody -SkipHttpErrorCheck
Log "  Microsoft Teams channel -> $($rc.StatusCode)"

# ---- 5) Render + zip the Teams app package ---------------------------------
Log "`n[5/5] Building Teams app package ..."
$pkgSrc = Join-Path $Here 'appPackage'
$staging = Join-Path $env:TEMP "onegrid-teams-pkg-$tag"
New-Item -ItemType Directory -Force -Path $staging | Out-Null
Copy-Item (Join-Path $pkgSrc 'color.png')   $staging
Copy-Item (Join-Path $pkgSrc 'outline.png') $staging
$manifest = Get-Content (Join-Path $pkgSrc 'manifest.json') -Raw
$manifest = $manifest.Replace('__BOT_APP_ID__', $appId)
# Point validDomains at the real bot host + the OneGrid app host.
$oneGridHost = ([Uri]$OneGridAppUrl).Host
$manifest = $manifest.Replace('onegrid-app-75033e-chat.niceisland-20053c21.eastus2.azurecontainerapps.io', $oneGridHost)
Set-Content -Path (Join-Path $staging 'manifest.json') -Value $manifest -Encoding UTF8
$zip = Join-Path $Here "appPackage.$appId.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zip -Force
Log "  package: $zip"

Log "`n==================== DONE ====================" "Green"
Log "Bot app id     : $appId"
Log "Messaging URL  : $messagingEndpoint"
Log "Teams package  : $zip" "Green"
Log "`nTo demo in Teams:" "Yellow"
Log "  1. Teams > Apps > Manage your apps > Upload an app > Upload a custom app." "Yellow"
Log "  2. Select the package above ($([IO.Path]::GetFileName($zip)))." "Yellow"
Log "  3. Open the app and ask: 'What is the overall fleet health right now?'" "Yellow"
Log "     Use /ontology to ask the Fabric Data Agent, /assistant to switch back." "Yellow"
