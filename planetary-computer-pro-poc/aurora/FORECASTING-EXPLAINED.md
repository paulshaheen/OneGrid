# Aurora Weather Forecasting — Demystified

A complete, plain-language explanation of how OneGrid produces a live weather
forecast: what is real, what is computed, and exactly what every moving part does.
Nothing here is a black box.

---

## 0. The one-sentence mental model

> **A forecast is `future = model(present)`.**
> You feed the current state of the atmosphere into a trained model, and it predicts
> the state 6 hours later. Do that 20 times in a row and you have a 5-day forecast.

Only **two** things can never be produced by code and are the real inputs you supply:

1. **The present state of the atmosphere** (the *initial condition*) — real observations.
2. **A trigger** to run a cycle (a button click or a schedule).

Everything else — finding the storms, calling the model, tracking each storm,
shaping the result for the map — is automated by this pipeline.

---

## 1. What is real vs. computed (the honesty contract)

| Thing | Source | Real or synthetic? |
|---|---|---|
| Current atmosphere (initial condition) | **NOAA GFS** public archive (or ECMWF HRES/ERA5) | **Real observations** |
| Which storms exist "now" | Genesis detection scanning the real analysis | **Real** (found, not invented) |
| The forecast (track, intensity, cone) | **Aurora** foundation model on an A100 GPU | **Real model output** |
| Storm *names* | Operator-supplied labels (`STORM_NAMES`) | Cosmetic label only |
| The **Synthetic** map toggle | A hand-authored demo hurricane | **Fake** (clearly labeled `modelSource: "Synthetic"`) |

**Key guarantee:** the pipeline *never invents weather*. If no cyclone is present in
the analysis for your region, it detects zero storms, skips the model entirely, and
publishes an empty list — the map stays honestly empty. (That is exactly what a
real-time Gulf-only run did earlier: 0 storms → empty.)

---

## 2. The end-to-end flow (7 stages)

```
 (1) TRIGGER  ──►  (2) BUILD INITIAL CONDITION  ──►  (3) GENESIS DETECTION
                                                              │
                                                              ▼
 (7) PUBLISH  ◄──  (6) NORMALIZE  ◄──  (5) TRACK  ◄──  (4) AURORA ENDPOINT (GPU)
```

Each stage below names the real code file (`aurora_pipeline/…`) that does it.

### (1) Trigger — `runAuroraNow()` in `report-app/server/aurora.js`
- The map's **"Run forecast cycle"** button → `POST /api/aurora/run` → starts the
  **Azure Container Apps Job** (`aurora-pipeline-job`) via the ARM `/start` API.
- "Empty body" on that call means *"run with the job's configured parameters"* —
  the parameters live as **environment variables on the job**, not in the request.
- The same job can also run on a cron schedule (hands-off operational forecasting).

### (2) Build the initial condition — `initial_conditions.py`
- Downloads the **real** atmospheric state for the chosen `ANALYSIS_TIME` and packs
  it into an `aurora.Batch`. A Batch contains, on a 0.25° global grid (1440×721):
  - **Surface variables:** 2 m temperature, 10 m wind (u/v), mean-sea-level pressure.
  - **Atmospheric variables at 13 pressure levels** (1000→50 hPa): temperature,
    wind (u/v), specific humidity, geopotential.
  - **Static variables:** land-sea mask, orography/geopotential, soil type.
- Data sources (pick with `INITIAL_CONDITION_SOURCE`):
  - `gfs` — **real-time public NOAA GFS** (AWS Open Data, no credentials, refreshed
    every 6 h, back to 2021-02-26). This is the operational/live path.
  - `hres_t0` — public WeatherBench2 HRES archive (historical 2016–2022).
  - `era5` — ECMWF Copernicus CDS (needs a free account).
- **Analysis time selection:** if `ANALYSIS_TIME` is set (e.g. `2021-08-29T00:00`),
  it forecasts *from that historical moment*. If it is **empty**, the code picks the
  most recent synoptic cycle (00/06/12/18 UTC) with a 6 h latency buffer — i.e.
  "now." Synoptic hours are the only valid analysis times.

### (3) Genesis detection — `tracking.py` (`find_centres`)
- Aurora's official tracker can *propagate* a storm but **cannot find one on its own**.
  So we first locate the storms present in the analysis:
  - Scan the initial condition for **mean-sea-level-pressure minima** (low-pressure
    centres) coincident with **10 m wind-speed maxima** — the physical signature of a
    cyclone.
  - Restrict the search to `DETECTION_BBOX` (`minLon,minLat,maxLon,maxLat`) so you
    only track storms in your operating region.
- Output: a list of **seeds** (each a lat/lon + detected intensity). `Seeded N
  cyclone tracker(s)` in the logs is this count.
- **If N = 0, the endpoint is never called** — no storms, no forecast, empty publish.

### (4) Aurora endpoint inference — `inference.py` + the deployed GPU endpoint
- For each 6 h step, the model needs the *entire* atmospheric tensor (hundreds of MB).
  That is far too large for an HTTP body, so Aurora uses a **blob-storage channel**:
  the client writes the input to a blob, the endpoint reads it, runs the A100, writes
  the predicted state back, the client reads it. (`blob_sas.py` mints a short-lived
  read/write SAS on the `model-outputs` container using the job's managed identity.)
- The endpoint is an **Azure ML managed online endpoint** (`aurora-og`) backed by one
  **A100 GPU** running the **Aurora foundation model** (checkpoint
  `aurora-0.25-finetuned` = "Aurora 1.0", the model this pipeline is built for).
- Auth is the endpoint **key** (`AURORA_ENDPOINT_TOKEN`); the job stores it as a secret.
- This is the only GPU-cost step, and it runs **once per forecast cycle**.

### (5) Tracking — `inference.py` (`run_and_track`) using `aurora.Tracker`
- One **`aurora.Tracker`** (the algorithm from Aurora's *Nature* paper — Microsoft's
  own code, not a heuristic) is created per seed, initialised at the storm's analysis
  position.
- As each predicted 6 h state streams back, every tracker `.step()`s forward,
  following its storm's centre. A tracker that loses its storm stops without aborting
  the others.
- Output: one **track** per surviving storm — a time series of centre position +
  intensity out to the horizon (`AURORA_NUM_STEPS × 6 h`, e.g. 12 steps = 72 h).

### (6) Normalize — `normalize.py`
- Converts each raw track into the app's domain object (`WeatherEvent`, defined in
  `webapp/src/lib/domain/types.ts`): current category/wind/pressure, movement,
  the forecast points (lat/lon/wind/**cone radius**/category per hour), the past
  track (history), and optional ensemble spread.
- `modelSource` is set to the real model (e.g. `"Aurora 1.5"`/`"Aurora"`), which is
  how the UI distinguishes a real forecast from the `"Synthetic"` demo.

### (7) Publish — `publish.py`
- Writes the `WeatherEvent[]` array to
  `model-outputs/weather-events.json` in Blob Storage (via managed identity).
- `Published N event(s)` is the final log line.

---

## 3. How the app consumes it (map side)

- The webapp's server function **`listAuroraWeatherEvents`**
  (`webapp/src/lib/services/azure/server.ts`) reads `weather-events.json` from the
  `model-outputs` container and returns the `WeatherEvent[]` to the map.
- A **weather-source mode** (sidecar blob `weather-source.json`) chooses what the map
  shows and is authoritative over the default Fabric demo storms:
  - `fabric` — the built-in unified-model sample storms (default).
  - `synthetic` — the hand-authored demo hurricane (no GPU).
  - `aurora` — the pipeline's real published forecast (this document).
- `getDataPlaneStatus` flips the Deployment page to **"Adapter connected"** when a
  recent `weather-events.json` exists — the honest signal that the pipeline is live.

---

## 4. The deployed infrastructure (what actually runs)

| Component | Name / value | Role |
|---|---|---|
| Pipeline runner | Container Apps **Job** `aurora-pipeline-job` (rg-onegrid-test, env `cae-aurora-eus2`) | Runs `python -m aurora_pipeline.run`, manual trigger, 1 replica |
| Pipeline image | ACR `acronegridaurora8621` → `aurora-pipeline:latest` | Built from `aurora/Dockerfile` |
| Job identity | User-assigned MI `id-aurora-job` | AcrPull, Storage Blob Data Contributor + Delegator, AzureML Data Scientist |
| GPU model endpoint | `aurora-og` → deployment `aurora10` = `azureml/Aurora/4` (Aurora 1.0), 1× `Standard_NC24ads_A100_v4` | Runs the forecast on GPU |
| Output storage | `pcproujcb2qv6vi2ts` → container `model-outputs` → `weather-events.json` | Where forecasts + the blob channel live |
| App wiring | App Service `pcpro-onegrid-app-ujcb2qv6vi2ts` env `AURORA_JOB_NAME`/`AURORA_JOB_RESOURCE_GROUP`; app MI has **Container Apps Jobs Operator** on the job | Lets the "Run forecast cycle" button start the job |

Idle cost ≈ 0 (the job bills only while executing); the A100 bills only while a
forecast runs.

---

## 5. The parameters (the "knobs")

All are environment variables on the job (validated up front by `config.py`):

| Env var | Meaning | Example |
|---|---|---|
| `ANALYSIS_TIME` | The moment to forecast **from**. Empty = latest cycle ("now"). Must be a synoptic hour (00/06/12/18 UTC). | `2021-08-29T00:00` (Hurricane Ida) or empty |
| `INITIAL_CONDITION_SOURCE` | Data source for the present state. | `gfs` (real-time) |
| `DETECTION_BBOX` | Region to detect storms: `minLon,minLat,maxLon,maxLat`. | `-100,15,-70,35` (Gulf) or `-140,10,-50,55` (US-wide) |
| `AURORA_NUM_STEPS` | Forecast length in 6 h steps (1–60). | `20` = 120 h |
| `AURORA_MODEL_NAME` | Which Aurora checkpoint. | `aurora-0.25-finetuned` |
| `STORM_NAMES` | Optional labels for detected storms (strongest first). | `Hurricane Ida` |
| `AURORA_ENDPOINT` / `AURORA_ENDPOINT_TOKEN` | Endpoint URI + key. | scoring URI + secret |

**Historical vs. live:** pin `ANALYSIS_TIME` to a past date to reproduce a known storm
(great for demos — guaranteed a storm to show); leave it empty for a genuine
real-time forecast (shows storms only if any actually exist right now).

---

## 6. Why a single run takes ~10–20 minutes

- The forecast is **autoregressive**: step *N* needs step *N−1*'s output, so the 12–20
  GPU calls run **strictly in sequence** — they cannot be parallelised.
- Each step ships a multi-hundred-MB atmospheric tensor **through blob storage** to the
  GPU and back.
- Plus one-time overhead: container cold start, GFS download (~GB), and (if a storm is
  found) the model rollout. No storm → no GPU call → fast + free.

This sequential-GPU cost is exactly why runs are **manual/cron-triggered**, not on
every page load.

---

## 7. Failure modes & honest behaviours (not bugs)

- **Empty map on a calm day** — correct: no cyclone in the analysis → empty publish.
- **Real-time needs a recent cycle** — GFS cycles publish ~1 h after 00/06/12/18 UTC;
  the code adds a latency buffer.
- **A model-version mismatch fails loudly** — the pipeline is built for Aurora **1.0**
  (`aurora-0.25-finetuned`); pointing it at an Aurora **1.5** endpoint fails server-side
  (different variable set). The deployed endpoint is 1.0 to match.
- **Bad parameters fail cleanly** — `config.py` validates bbox format, synoptic hour,
  and step count before any Azure call, with an actionable message.

---

## 8. Proof it is real (observed this session)

- **Historical:** `ANALYSIS_TIME=2021-08-29T00:00`, Gulf box → detected **Hurricane Ida**
  from real GFS observations and published a real Aurora forecast (1 event).
- **Live, US-wide:** empty `ANALYSIS_TIME` (latest cycle), box `-140,10,-50,55` →
  detected and forecast **4 active storms** across the Eastern Pacific / CONUS /
  Atlantic and published them — all from the current real atmosphere.

Same code, same model, different inputs. That is the whole point: it is a real
forecasting system, and the only thing you choose is *what to forecast*.
