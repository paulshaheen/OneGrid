<#
  OneGrid — Foundry IQ equipment-manuals knowledge base (bolt-on) deploy.
  ---------------------------------------------------------------------------
  Provisions the manuals knowledge base and wires it into a deployed OneGrid app:

    1. Deploys a text-embedding model on the Foundry account (first-party, no marketplace).
    2. Creates an Azure AI Search service (Basic) — region fallback if capacity-constrained.
    3. Generates the synthetic manual corpus and indexes it (chunk + embed + upload).
    4. Sets MANUALS_* env vars on the OneGrid container app so /api/manuals/* light up
       and the chat 'search_manuals' tool + work-order "Resolve" UX turn on.

  Opt-in bolt-on: NOT part of the main wizard. Run on top of a deployed OneGrid app.
  Prereqs: az login, Node.js, and the Foundry account + container app from the main deploy.

    ./deploy.ps1 -FoundryAccount onegrid-app-75033e-foundry -FoundryResourceGroup rg-onegrid-75033e `
                 -AppName onegrid-app-75033e-chat -AppResourceGroup rg-onegrid-75033e
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string] $FoundryAccount,
  [Parameter(Mandatory = $true)][string] $FoundryResourceGroup,
  [string] $AppName,
  [string] $AppResourceGroup,
  [string] $SearchName,
  [string] $Location = 'eastus2',
  [string] $EmbedModel = 'text-embedding-3-large',
  [string] $IndexName = 'onegrid-manuals'
)
$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
function Log($m, $c = 'Cyan') { Write-Host $m -ForegroundColor $c }

$foundryEndpoint = az cognitiveservices account show -n $FoundryAccount -g $FoundryResourceGroup --query "properties.endpoint" -o tsv
if (-not $foundryEndpoint) { throw "Foundry account $FoundryAccount not found." }
Log "Foundry endpoint : $foundryEndpoint"

# ---- 1) embedding model ----------------------------------------------------
Log "`n[1/4] Deploying embedding model '$EmbedModel' ..."
$exists = az cognitiveservices account deployment show -n $FoundryAccount -g $FoundryResourceGroup --deployment-name $EmbedModel --query name -o tsv 2>$null
if (-not $exists) {
  $ver = (az cognitiveservices account list-models -n $FoundryAccount -g $FoundryResourceGroup --query "[?name=='$EmbedModel'].version | [0]" -o tsv)
  az cognitiveservices account deployment create -n $FoundryAccount -g $FoundryResourceGroup `
    --deployment-name $EmbedModel --model-name $EmbedModel --model-version $ver --model-format OpenAI `
    --sku-name Standard --sku-capacity 50 -o none
  Log "  deployed $EmbedModel ($ver)"
} else { Log "  embedding model already deployed" }

# ---- 2) Azure AI Search service (region fallback) --------------------------
Log "`n[2/4] Azure AI Search service ..."
if (-not $SearchName) { $SearchName = 'onegrid-manuals-' + [guid]::NewGuid().ToString('N').Substring(0, 8) }
$existing = az search service show -n $SearchName -g $FoundryResourceGroup --query name -o tsv 2>$null
if (-not $existing) {
  $ok = $false
  foreach ($loc in @($Location, 'eastus', 'centralus', 'westus3', 'westus2')) {
    Log "  creating '$SearchName' (Basic) in $loc ..."
    az search service create -n $SearchName -g $FoundryResourceGroup -l $loc --sku Basic --partition-count 1 --replica-count 1 -o none 2>$null
    if ($LASTEXITCODE -eq 0) { $ok = $true; break }
    Log "  $loc unavailable, trying next region" 'Yellow'
  }
  if (-not $ok) { throw "Could not create the Search service in any region." }
} else { Log "  reusing search service $SearchName" }
$searchEndpoint = "https://$SearchName.search.windows.net"
$searchKey = az search admin-key show --service-name $SearchName -g $FoundryResourceGroup --query primaryKey -o tsv
Log "  search endpoint: $searchEndpoint"

# ---- 3) generate + index the corpus ----------------------------------------
Log "`n[3/4] Generating corpus and building the index ..."
Push-Location $Here
node scripts/gen_manuals.js
$env:SEARCH_ENDPOINT = $searchEndpoint
$env:SEARCH_KEY = $searchKey
$env:SEARCH_INDEX = $IndexName
$env:AOAI_ENDPOINT = $foundryEndpoint.TrimEnd('/')
$env:AOAI_EMBED = $EmbedModel
$env:AOAI_TOKEN = (az account get-access-token --resource "https://cognitiveservices.azure.com" --query accessToken -o tsv)
node scripts/index_manuals.js
Pop-Location
# Keep the servable corpus copy in the app in sync.
Copy-Item (Join-Path $Here 'corpus/manuals.json') (Join-Path $Here '..\..\report-app\server\manuals.json') -Force -ErrorAction SilentlyContinue

# ---- 4) wire the container app ---------------------------------------------
if ($AppName -and $AppResourceGroup) {
  Log "`n[4/4] Setting MANUALS_* env vars on $AppName ..."
  az containerapp update -n $AppName -g $AppResourceGroup --set-env-vars `
    "MANUALS_SEARCH_ENDPOINT=$searchEndpoint" "MANUALS_SEARCH_KEY=$searchKey" "MANUALS_SEARCH_INDEX=$IndexName" `
    "MANUALS_AOAI_ENDPOINT=$($foundryEndpoint.TrimEnd('/'))" "MANUALS_EMBED=$EmbedModel" -o none
  Log "  container app updated (new revision rolling out)"
  Log "  NOTE: rebuild the image if report-app/server/manuals.json changed so the bundled corpus matches." 'Yellow'
} else {
  Log "`n[4/4] Skipped app wiring (pass -AppName + -AppResourceGroup to set env vars)." 'Yellow'
}

Log "`n==================== DONE ====================" 'Green'
Log "Search service : $SearchName ($searchEndpoint)" 'Green'
Log "Index          : $IndexName" 'Green'
Log "Embedding      : $EmbedModel on $FoundryAccount" 'Green'
Log "The app now serves /api/manuals/*, the chat 'search_manuals' tool, and the work-order Resolve UX." 'Green'
