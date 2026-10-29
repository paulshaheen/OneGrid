<#
 Grants the narrow access the OneGrid SRE demo needs. Safe to re-run.

  Azure SRE Agent identity (id-onegrid-sre-agent):
    read   : Reader + Monitoring Reader on rg-onegrid-test, Log Analytics Reader on the
             App Insights workspace  -> investigate alerts, logs, metrics, activity log
    write  : Website Contributor on the pcpro app, Storage Account Contributor on the
             OneGrid storage account, Contributor on the ogestu Fabric capacity
             -> apply the three fixes after a human approves them (Review mode)

  pcpro app identity (system-assigned): the same three write scopes plus read on the
  resource group and Tag Contributor on itself -> powers the in-app SRE demo page.
#>
$ErrorActionPreference = "Stop"
$Sub = "87bc8fc7-c4b7-4466-80b8-a7d5004b4f14"
$Rg  = "rg-onegrid-test"
$RgId       = "/subscriptions/$Sub/resourceGroups/$Rg"
$AppId      = "$RgId/providers/Microsoft.Web/sites/pcpro-onegrid-app-ujcb2qv6vi2ts"
$StorageId  = "$RgId/providers/Microsoft.Storage/storageAccounts/pcproujcb2qv6vi2ts"
$CapacityId = "/subscriptions/$Sub/resourceGroups/rgpoc/providers/Microsoft.Fabric/capacities/ogestu"
$Workspace  = az monitor app-insights component show -g $Rg -a pcpro-ai-ujcb2qv6 --query workspaceResourceId -o tsv
$AgentPrincipal = az identity show -g rg-onegrid-sre -n id-onegrid-sre-agent --query principalId -o tsv
$AppPrincipal   = az webapp identity show -n pcpro-onegrid-app-ujcb2qv6vi2ts -g $Rg --query principalId -o tsv

function Grant($principal, $role, $scope) {
  $existing = @(az role assignment list --assignee $principal --role $role --scope $scope --query "[].id" -o tsv | Where-Object { $_ })
  if ($existing.Count -gt 0) { Write-Host "  = $role on $($scope.Split('/')[-1])"; return }
  az role assignment create --assignee-object-id $principal --assignee-principal-type ServicePrincipal --role $role --scope $scope -o none
  Write-Host "  + $role on $($scope.Split('/')[-1])"
}

Write-Host "SRE Agent identity ($AgentPrincipal)"
Grant $AgentPrincipal "Reader"                       $RgId
Grant $AgentPrincipal "Monitoring Reader"            $RgId
Grant $AgentPrincipal "Log Analytics Reader"         $Workspace
Grant $AgentPrincipal "Website Contributor"          $AppId
Grant $AgentPrincipal "Storage Account Contributor"  $StorageId
Grant $AgentPrincipal "Contributor"                  $CapacityId

Write-Host "pcpro app identity ($AppPrincipal)"
Grant $AppPrincipal "Reader"                         $RgId
Grant $AppPrincipal "Monitoring Reader"              $RgId
Grant $AppPrincipal "Website Contributor"            $AppId
Grant $AppPrincipal "Tag Contributor"                $AppId
Grant $AppPrincipal "Storage Account Contributor"    $StorageId
Grant $AppPrincipal "Contributor"                    $CapacityId
