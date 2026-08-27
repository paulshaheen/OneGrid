<#
================================================================================
 Preflight quota check for the Planetary Computer Pro + OneGrid deployment.
================================================================================
 Both of the quota failures you can hit on a fresh subscription happen at ARM
 resource-create time (before the in-template provisioner runs), so they can't be
 caught from inside the deployment. Run this ONCE with your own credentials before
 clicking the portal Deploy button:

   ./preflight-quota.ps1 -SubscriptionId <sub> -Location <region>

 It:
   1. Registers the Microsoft.Fabric + Microsoft.Quota resource providers
      (a zero Fabric regional quota is usually an unregistered provider).
   2. Checks your Fabric Capacity-Unit quota for the region + requested SKU.
   3. Checks your GPU (A100) VM-family core quota for the region.
   4. Prints a clear PASS/FAIL with the exact portal links to request more.

 Fabric CU quota cannot be requested through ARM (Fabric is not a Microsoft.Quota
 provider) — use the Quotas portal blade (self-serve, approved in minutes). GPU
 core quota CAN be requested programmatically; pass -RequestGpuQuota to submit a
 Microsoft.Quota request for the A100 family (best-effort; may route to review).

 Requires: az CLI, logged in (az login) as a user/SP with Reader on the sub and,
 for -RequestGpuQuota, Quota Request Operator.
================================================================================
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $SubscriptionId,
  [Parameter(Mandatory)] [string] $Location,
  # Fabric SKU you intend to create (F2..F2048). CU = the numeric part (F2 = 2 CU).
  [string] $FabricSku = 'F2',
  # A100 VM family the Aurora endpoint uses. Standard_NC24ads_A100_v4 = 24 cores.
  [string] $GpuVmFamily = 'standardNCADSA100v4Family',
  [int]    $GpuCoresNeeded = 24,
  # Opt-in: submit a Microsoft.Quota request to raise the A100 family core quota.
  [switch] $RequestGpuQuota,
  [int]    $GpuCoresTarget = 48
)

$ErrorActionPreference = 'Stop'
function Log($m, $c = 'Cyan') { Write-Host "[$(Get-Date -f HH:mm:ss)] $m" -ForegroundColor $c }
$quotasBlade = 'https://portal.azure.com/#view/Microsoft_Azure_Capacity/QuotaMenuBlade/~/myQuotas'
$fabricQuotaDoc = 'https://learn.microsoft.com/fabric/enterprise/fabric-quotas'
$fail = $false

& az account set --subscription $SubscriptionId --only-show-errors | Out-Null

# --- 1. Register the resource providers (idempotent) -------------------------------
foreach ($ns in @('Microsoft.Fabric', 'Microsoft.Quota')) {
  $state = (& az provider show --namespace $ns --query registrationState -o tsv 2>$null)
  if ($state -ne 'Registered') {
    Log "registering $ns (current: $state)..."
    & az provider register --namespace $ns --only-show-errors 2>$null | Out-Null
  } else { Log "$ns already registered" }
}

# --- 2. Fabric Capacity-Unit quota -------------------------------------------------
$fabricCuNeeded = 0
if ($FabricSku -match '^F(\d+)$') { $fabricCuNeeded = [int]$Matches[1] }
Log "checking Fabric CU quota in $Location (need $fabricCuNeeded CU for $FabricSku)..."
try {
  $uri = "https://management.azure.com/subscriptions/$SubscriptionId/providers/Microsoft.Fabric/locations/$Location/usages?api-version=2023-11-01"
  $resp = (& az rest --method get --url $uri --only-show-errors 2>$null) | ConvertFrom-Json
  $cap = $resp.value | Where-Object { $_.name.value -eq 'CapacityQuota' } | Select-Object -First 1
  if ($cap) {
    $available = [int]$cap.limit - [int]$cap.currentValue
    if ($available -ge $fabricCuNeeded) {
      Log "  PASS Fabric: limit=$($cap.limit) used=$($cap.currentValue) available=$available CU" 'Green'
    } else {
      Log "  FAIL Fabric: limit=$($cap.limit) used=$($cap.currentValue) available=$available CU (< $fabricCuNeeded)" 'Red'
      Log "    Request more Fabric CU (self-serve, ~minutes): $quotasBlade  |  docs: $fabricQuotaDoc" 'Yellow'
      $fail = $true
    }
  } else {
    Log "  Fabric CapacityQuota usage not returned; if you just registered the provider, wait a few minutes and re-run. Portal: $quotasBlade" 'Yellow'
  }
} catch {
  Log "  Fabric quota check errored: $($_.Exception.Message). Portal: $quotasBlade" 'Yellow'
}

# --- 3. GPU (A100) VM-family core quota --------------------------------------------
Log "checking GPU core quota for $GpuVmFamily in $Location (need $GpuCoresNeeded cores)..."
try {
  $usage = (& az vm list-usage --location $Location --only-show-errors -o json 2>$null) | ConvertFrom-Json
  $fam = $usage | Where-Object { $_.name.value -eq $GpuVmFamily } | Select-Object -First 1
  if ($fam) {
    $availC = [int]$fam.limit - [int]$fam.currentValue
    # Managed online endpoints reserve ~20% extra for upgrades: ceil(1.2 * needed).
    $effectiveNeed = [math]::Ceiling(1.2 * $GpuCoresNeeded)
    if ($availC -ge $effectiveNeed) {
      Log "  PASS GPU: limit=$($fam.limit) used=$($fam.currentValue) available=$availC cores (need ~$effectiveNeed incl. 20% endpoint reserve)" 'Green'
    } else {
      Log "  FAIL GPU: limit=$($fam.limit) used=$($fam.currentValue) available=$availC cores (< ~$effectiveNeed incl. 20% endpoint reserve)" 'Red'
      Log "    Request more $GpuVmFamily cores: $quotasBlade" 'Yellow'
      $fail = $true
      if ($RequestGpuQuota) {
        Log "  submitting Microsoft.Quota request: $GpuVmFamily -> $GpuCoresTarget cores..." 'Cyan'
        $qUri = "https://management.azure.com/subscriptions/$SubscriptionId/providers/Microsoft.Compute/locations/$Location/providers/Microsoft.Quota/quotas/$($GpuVmFamily)?api-version=2023-02-01"
        $qBody = @{ properties = @{ limit = @{ limitObjectType = 'LimitValue'; value = $GpuCoresTarget }; name = @{ value = $GpuVmFamily } } } | ConvertTo-Json -Depth 6
        try {
          & az rest --method put --url $qUri --headers 'Content-Type=application/json' --body $qBody --only-show-errors 2>$null | Out-Null
          Log "  request submitted. Check status in the Quotas blade; specialized GPU SKUs may route to manual review." 'Green'
        } catch {
          Log "  GPU quota request failed (likely needs manual approval / support ticket): $($_.Exception.Message)" 'Yellow'
        }
      }
    }
  } else {
    Log "  GPU family '$GpuVmFamily' not found in $Location usage (region may not offer A100, or name differs). Portal: $quotasBlade" 'Yellow'
  }
} catch {
  Log "  GPU quota check errored: $($_.Exception.Message). Portal: $quotasBlade" 'Yellow'
}

Write-Host ''
if ($fail) {
  Log 'PREFLIGHT: one or more quotas are insufficient. Resolve the FAIL items above before deploying (or leave the Aurora model / Fabric capacity options off).' 'Red'
  exit 1
} else {
  Log 'PREFLIGHT: quota checks passed.' 'Green'
}
