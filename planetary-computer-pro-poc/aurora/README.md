# Aurora forecast pipeline

The web app renders **normalized `WeatherEvent` objects** (cyclone track, forecast
cone, intensity), not raw atmospheric grids. A live Azure ML **Aurora** endpoint
only produces atmospheric fields — it does not, on its own, populate the weather
map. This pipeline is the missing production business logic that connects the two:

```
HRES T0 initial conditions  (public WeatherBench2 + HuggingFace static — no creds)
        │  (Batch: surface + 13 pressure levels + static)
        ▼
Genesis detection  (MSL minima + 10 m wind maxima in the analysis → storm seeds)
        │
        ▼
Aurora online endpoint  ──(FoundryClient + BlobStorageChannel)──►  predicted Batches
        │  (msl, 10u, 10v, z@700 … on a lat/lon grid, every 6 h)
        ▼
aurora.Tracker  (Microsoft's own Nature-paper tracker, one per seed, stepped over the rollout)
        │
        ▼
Normalizer  ──►  WeatherEvent[]   (exact webapp/src/lib/domain/types.ts schema)
        │
        ▼
Publish  ──►  model-outputs/weather-events.json   (read by the App Service identity)
```

The web app's `getDataPlaneStatus` reports **"Adapter connected"** only when a
recent `weather-events.json` exists in the `model-outputs` container, so this job
running on a schedule is what flips the Deployment page from *"Adapter required"*
to a live, populated weather map.

## What this is (and is not)

- It **is** a real, runnable pipeline that calls the deployed Aurora endpoint and
  writes the domain objects the app consumes.
- Cyclone propagation uses **`aurora.Tracker`** — Microsoft's own tracker from the
  Aurora Nature paper — not a home-grown heuristic. The only bespoke step is
  *genesis detection* (finding which storms exist in the analysis), because the
  official tracker only propagates a storm you already located.
- It does **not** invent weather. When no tropical cyclone is present in the
  analysis, no endpoint call is made and an empty event list is published — the
  map stays honestly empty.

## Prerequisites

- Python 3.11+
- Access to the deployed Aurora endpoint (scoring URI + token).
- A blob container the endpoint can use as its transfer **channel** (Aurora
  passes large tensors via blob storage, not the HTTP body). Either provide a
  read/write SAS URL (`AURORA_BLOB_CHANNEL_URL`), or set
  `AURORA_BLOB_ACCOUNT_URL` + `AURORA_BLOB_CONTAINER` and let the job mint a
  short-lived user-delegation SAS with its managed identity.
- Initial conditions. Three supported sources:
  - **`hres_t0`** (default) — IFS HRES T0 from the **public** WeatherBench2 archive
    plus Aurora's static variables from HuggingFace. **No Copernicus/ECMWF
    account.** The public archive is historical (2016-2022 by default), so set
    `ANALYSIS_TIME` to a date in range (real-time needs a live IFS feed).
  - **`era5`** via the Copernicus CDS API — reference path; runs the *pretrained*
    checkpoint. Requires free CDS credentials in `~/.cdsapirc`.
  - **`hres`** — local ECMWF HRES GRIB files (operational path).
- Write access to the `model-outputs` container to publish the result. On Azure
  this uses the job's managed identity via `DefaultAzureCredential`; locally set
  `OUTPUT_SAS_URL` instead.

## Why any of this is needed (and what is automated)

A forecast is `future = model(present state)`. Two things can never be produced
by code alone and are the only real inputs you must supply:

1. **A present atmospheric state** (the initial condition). The default source
   removes the credential burden by reading the public WeatherBench2 archive and
   Aurora's HuggingFace static file — no accounts. A *real-time* state still needs
   a live IFS feed, which is a licensing decision, not a code one.
2. **A trigger** to run each cycle. The GPU inference already runs on your
   deployed endpoint; the pipeline itself is a light CPU job. Schedule it once
   (see below) and it is hands-off thereafter.

Everything else — the blob channel SAS, checkpoint selection, tracking, and
publishing — is automated here.

## Configure

Copy `.env.example` to `.env` and fill it in (or export the variables):

```bash
cp .env.example .env
```

## Install

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
python -m aurora_pipeline.run
```

This builds initial conditions, detects storms, runs the endpoint with
`aurora.Tracker`, and writes `weather-events.json` to the output container.

## Schedule it (no manual runs)

The scheduled trigger is **part of the main deployment**. Select **“Aurora
scheduled forecast job (Container Apps)”** in the portal wizard (or set
`deployAuroraSchedule=true`) and supply a prebuilt pipeline image. The template
then provisions an Azure Container Apps **Job** with a cron trigger, a managed
identity, and its role assignments — no separate module.

Build and push the image first (uses the `Dockerfile` in this folder), then
deploy with the image reference:

```bash
# Build & push the image to your registry.
az acr build -r <your-registry> -t aurora-pipeline:latest aurora

# Deploy (or redeploy) the environment with the scheduled job enabled.
az deployment group create -g pcpro-poc-rg \
  -f deploy/azure/main.bicep \
  -p deployAuroraModel=true deployAuroraSchedule=true \
     auroraJobImage=<your-registry>.azurecr.io/aurora-pipeline:latest
```

The job runs `python -m aurora_pipeline.run` on the ECMWF cycle cadence
(default cron `0 1,7,13,19 * * *`, ~1 h after each 00/06/12/18 UTC synoptic cycle
for data latency). It reads **real-time public NOAA GFS** initial conditions with
no `ANALYSIS_TIME` set, so each run targets the latest available cycle — genuinely
live forecasts.

The template grants the job’s managed identity **Storage Blob Data Contributor**
on the sample storage account (for the scratch channel and `model-outputs`) and
**AzureML Data Scientist** on the workspace automatically. The job authenticates
to the endpoint and storage with that identity — **no keys or `AURORA_ENDPOINT_TOKEN`**
(when the token is unset the pipeline mints an AAD token from the managed
identity). The one manual step is granting the identity **AcrPull** on your
registry so it can pull the image; its principal ID is in the deployment outputs
(`auroraJobIdentityPrincipalId`).

## Layout

| Module | Responsibility |
| --- | --- |
| `config.py` | Environment-driven configuration, checkpoint/source pairing, validation |
| `initial_conditions.py` | Build an `aurora.Batch` from WeatherBench2 HRES T0, ERA5 (CDS), or HRES GRIB |
| `blob_sas.py` | Mint a short-lived read/write channel SAS from the managed identity |
| `inference.py` | Detect storm seeds, call the endpoint, propagate with `aurora.Tracker` |
| `tracking.py` | Genesis detection (MSL minima + wind maxima) that seeds the tracker |
| `normalize.py` | Convert tracks to the app's `WeatherEvent` schema |
| `publish.py` | Write `weather-events.json` to the output container |
| `run.py` | Orchestrate the end-to-end cycle |
