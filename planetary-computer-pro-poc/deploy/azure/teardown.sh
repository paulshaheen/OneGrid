#!/usr/bin/env bash
# =====================================================================================
# Tear down the Planetary Computer Pro POC by deleting its resource group.
#
# Usage: ./teardown.sh <resource-group-name>
# Example: ./teardown.sh pcpro-poc-rg
# =====================================================================================
set -euo pipefail

RESOURCE_GROUP="${1:-}"

if [[ -z "${RESOURCE_GROUP}" ]]; then
  echo "Usage: $0 <resource-group-name>" >&2
  exit 1
fi

echo "This will delete resource group '${RESOURCE_GROUP}' and everything in it,"
echo "including the GeoCatalog and all ingested data. This cannot be undone."
read -r -p "Type the resource group name to confirm: " CONFIRM

if [[ "${CONFIRM}" != "${RESOURCE_GROUP}" ]]; then
  echo "Confirmation did not match. Aborting." >&2
  exit 1
fi

echo "Deleting resource group '${RESOURCE_GROUP}'..."
az group delete --name "${RESOURCE_GROUP}" --yes

echo "Done. Resource group '${RESOURCE_GROUP}' deletion initiated."
