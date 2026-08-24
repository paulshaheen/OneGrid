#!/usr/bin/env bash
set -euo pipefail
cd /Users/taacs/planetary-computer-pro-poc/aurora
source .venv/bin/activate

ACCT=pcprozjezw42rrllpg; RG=pcpro-poc-rg; WS=pcpro-aml-zjezw42r; EP=pcpro-aml-zjezw42r-gbjxj

export AURORA_ENDPOINT_TOKEN=$(az ml online-endpoint get-credentials -n "$EP" -g "$RG" -w "$WS" --query primaryKey -o tsv)
KEY=$(az storage account keys list --account-name "$ACCT" -g "$RG" --query '[0].value' -o tsv)
az storage container create --name aurora-channel --account-name "$ACCT" --account-key "$KEY" -o none
EXP=$(date -u -v+8H '+%Y-%m-%dT%H:%MZ')
CH_SAS=$(az storage container generate-sas --name aurora-channel --permissions racwdl --account-name "$ACCT" --account-key "$KEY" --expiry "$EXP" --https-only -o tsv)
OUT_SAS=$(az storage container generate-sas --name model-outputs --permissions rcwl --account-name "$ACCT" --account-key "$KEY" --expiry "$EXP" --https-only -o tsv)

export AURORA_BLOB_CHANNEL_URL="https://$ACCT.blob.core.windows.net/aurora-channel?$CH_SAS"
export OUTPUT_SAS_URL="https://$ACCT.blob.core.windows.net/model-outputs?$OUT_SAS"
export AURORA_ENDPOINT="https://$EP.westeurope.inference.ml.azure.com/score"
export INITIAL_CONDITION_SOURCE=gfs
export ANALYSIS_TIME=2021-08-29T00:00
export AURORA_NUM_STEPS=12
export DETECTION_BBOX="-100,15,-70,35"
export STORM_NAMES="Hurricane Ida"
export OUTPUT_BLOB_NAME=weather-events.json

echo "=== RUNNING AURORA — Hurricane Ida 2021-08-29 00Z (sweeps LA asset field) ==="
python -m aurora_pipeline.run
echo "=== EXIT $? ==="
