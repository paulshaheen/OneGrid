# OGE OneGrid on Microsoft Fabric

An end-to-end **OneGrid solution accelerator** built on **Microsoft Fabric**
and **Azure AI Foundry**. The **accelerator** — the thing you clone and deploy — has three parts:

1. **The accelerator** — a complete Fabric solution (lakehouse, real-time eventhouse, ML
   models, semantic model, reports) plus the historical data, that deploys into *your* tenant.
2. **The web app** — an interactive React dashboard: **3D digital twins**, a **failure
   simulation**, a **knowledge graph / ontology**, and **chat-with-your-data**.
3. **A one-click localhost deploy wizard** — a local browser tool that provisions the whole
   solution into your Fabric capacity and streams live progress.

---

## ⚡ Quick start — no terminal, just double-click (Windows)

1. **Download one file:** **[`OneGrid-Wizard.cmd`](https://github.com/paulshaheen/OGE-OneGrid/releases/latest/download/OneGrid-Wizard.cmd)**.
2. **Double-click it.** It downloads the wizard, installs Node.js + the Azure CLI for you if they're missing (a Windows approval prompt may appear), opens your browser, and starts the wizard at `http://localhost:7333`.
3. In the wizard: **Sign in to Azure** (a button) → choose targets → prerequisite checks → **Deploy**.

That's it — **no git, no clone, no `npm`, nothing to type.** The wizard writes `config.json`, runs
`deploy.ps1`, and seeds the ~532 MB demo data **cloud-to-cloud** straight into your Fabric
workspace (your laptop never downloads it). When it finishes you get a **🖥️ Launch Web App** button.

**You need:** a Windows machine and an existing **Microsoft Fabric capacity** (F-SKU or Trial).
Node.js and the Azure CLI are installed for you. No local Docker — the app image builds in the cloud.

> 🍎 **macOS support is coming soon.** A double-click `.command` launcher (Homebrew-based) is on
> the way; until then, Mac users can use the command-line path below.

<details>
<summary>Prefer the command line, or contributing? (full clone)</summary>

```powershell
# Full clone includes the local data/ bundle (Git LFS), so deploy uploads it
# directly instead of cloud-seeding.
git lfs install
git clone https://github.com/paulshaheen/OGE-OneGrid.git
cd OGE-OneGrid
az login
node deploy-ui/server.js          # or:  ./deploy-ui/launch.ps1
#    → http://localhost:7333
```

See [Option B — Config file + CLI](#option-b--config-file--cli).

**Maintainers — publishing the download:** run `./tools/package-wizard.ps1` (~48 MB `OneGrid-Wizard.zip`)
and `./tools/package-data.ps1` (`onegrid-data.zip`), then attach **three** assets to the latest release:
`OneGrid-Wizard.cmd` (the one-file launcher), `OneGrid-Wizard.zip`, and `onegrid-data.zip`. The launcher
pulls `deploy-ui/bootstrap-online.ps1` from `main`, which downloads the zip and starts the wizard.
</details>

---

## 📁 Repository structure (the sections)

**The accelerator** (what you clone & deploy):

| Section | Path(s) | What it is |
|---|---|---|
| 🚀 **Accelerator** | `fabric/`, `data/`, `infra/` | Fabric item definitions (notebooks, semantic model, eventhouse, pipeline…), the bundled historical **data** (Git LFS), and IaC. |
| 🖥️ **Web app** | `report-app/`, `chatagent/`, `Dockerfile` | The React dashboard + Node data API + realtime WebSocket, which spawns the **chat agent**. Built into one container image. |
| 🧭 **Deploy tool** | `deploy-ui/`, `deploy.ps1`, `config.sample.json` | The localhost **wizard** and the underlying phase-based deploy script. |
| 🧩 **Data plane** *(optional bolt-on)* | `bolt-ons/data-plane/` | Bring‑your‑own‑data layer: stream **your** historian/operational data into the accelerator's Eventstream custom endpoint instead of the synthetic seed. Ships a production PI→Fabric forwarder + connector contract (see [Data plane](#-data-plane--bring-your-own-data-optional-bolt-on)). |

**Documentation site** *(separate repo)*: the public capabilities site and trailer video now live
in [**paulshaheen/OneGrid-Site**](https://github.com/paulshaheen/OneGrid-Site) — versioned and
auto-deployed there, not part of this accelerator.

```
OGE-OneGrid/
├── deploy.ps1                 # phase-based deploy orchestrator (workspace→…→chatagent)
├── deploy-ui/                 # local web wizard (server.js, index.html, launch.ps1)
├── config.sample.json         # copy → config.json and fill in (git-ignored)
├── Dockerfile                 # builds the web-app image (report-app SPA + chat agent)
├── fabric/                    # exported Fabric item definitions
│   ├── notebooks/             #   Spark notebooks (ingest, ML, scoring, ontology…)
│   ├── semanticmodel/         #   Import + Direct Lake models
│   ├── eventhouse/            #   KQL schema, mappings, functions
│   ├── pipelines/ eventstream/ report/ kqldashboards/
├── data/                      # bundled historical parquet (Git LFS)
├── report-app/                # React dashboard + Node backend (data API + realtime WS)
├── chatagent/                 # natural-language chat agent (spawned by the report server)
├── infra/                     # foundry.bicep (Entra-only AI Foundry account)
├── bolt-ons/                  # optional add-ons (not required to run the accelerator)
│   └── data-plane/            #   bring-your-own-data
│       ├── core/              #     Forwarder.Core — shared durable-queue + publisher
│       └── connectors/        #     pi-forwarder (PI) + db-forwarder (SQL Server/Oracle)
└── tools/                     # packaging scripts (build the wizard + data downloads)
```

---

## 🚀 Section 1 — The accelerator

`deploy.ps1` provisions the **entire** solution into your own tenant:

```
   deploy.ps1 → ┌──────────────────────────────────────────────────────────┐
                │  Fabric workspace                                        │
                │   • Lakehouse (lh_poc)   • Eventhouse + KQL DB           │
                │   • Eventstream          • Spark notebooks + pipeline    │
                │   • Import semantic model + Power BI report              │
                │   + bundled historical data (PiEvents + gold/ml tables)  │
                └──────────────────────────────────────────────────────────┘
                ┌──────────────────────────────────────────────────────────┐
                │  Azure AI Foundry account (+ model deployments)          │
                │  Azure Container App: the web app (managed identity)     │
                └──────────────────────────────────────────────────────────┘
```

The web app reasons with **Azure AI Foundry** (unified inference + model selector), queries
**real-time** sensor data from the **Eventhouse (KQL)** and **curated** data from the
**Import semantic model (DAX)** — no per-user secrets.

### What gets created

| Layer | Items |
|---|---|
| **Fabric** | Workspace, Lakehouse, Eventhouse + KQL DB, Eventstream, notebooks, pipeline, Import semantic model, report |
| **Data** | Full `PiEvents` history + all `gold`/`ml`/`dbo` curated tables + a 30-day window of the fact tables |
| **Azure** | AI Foundry account + model deployments; Container App (the web app) with a system-assigned identity |
| **Grants** | App identity → Eventhouse DB viewer, Power BI workspace member (or **least-privilege** Viewer + dataset ReadWrite when `governance.leastPrivilegeApp` is on), Foundry `Cognitive Services User` + `Reader` |

---

## 🧭 Section 2 — Deploy it

### Prerequisites
1. **Azure CLI** logged in (`az login`) with rights to create resources and Fabric admin/member access.
2. **An existing Microsoft Fabric capacity** (F-SKU or Trial) — a workspace can't be created without one.
3. Tenant setting **"Service principals can use Fabric / Power BI APIs"** enabled.
4. **Node** to run the wizard. **No local Docker** — the container image builds in the cloud (ACR).
5. **Git LFS** so the bundled data materializes: `git lfs install` before cloning.

### Option A — Guided web wizard (recommended)
A local browser wizard discovers your subscriptions/capacities, runs a **prerequisite check**,
writes `config.json`, and streams live deploy progress. Every deploy gets **unique resource
names** (resource group, workspace, Foundry account) so runs never collide.

```powershell
node deploy-ui/server.js      # or: ./deploy-ui/launch.ps1  (also opens the browser)
# then open http://localhost:7333
```
Steps: **Azure sign-in → Choose targets → Prerequisite checks → Deploy** (live phase tracker +
log). On success it shows a **🖥️ Launch Web App** button plus Power BI / real-time / demo links.

### Option B — Config file + CLI
```powershell
cp config.sample.json config.json      # then edit: subscriptionId, location, fabric.capacityId, names
./deploy.ps1 -ConfigPath ./config.json
```
Run a subset of phases with `-Only`, or skip the slow data load with `-SkipData`:
```powershell
./deploy.ps1 -ConfigPath ./config.json -Only workspace,core,semantic,foundry,chatagent,permissions
./deploy.ps1 -ConfigPath ./config.json -SkipData
```
Phases (in order): `workspace → core → artifacts → data → semantic → oge → governance → foundry → chatagent → permissions`. The `governance` phase is a no-op unless `governance.enabled` is set.
On completion the web-app URL + workspace link are printed and written to `last-deploy-state.json`.

### Tear down
The wizard has a teardown picker; or `./deploy.ps1 -ConfigPath ./config.json -Teardown`.
It removes the created Fabric workspace + Azure resource groups. **Your Fabric capacity is left untouched.**

---

## 🖥️ Section 3 — The web app

`report-app/` is a **React + Three.js** dashboard served by a Node backend
(`report-app/server`) that also spawns the `chatagent/` as a child process. The
repo-root **`Dockerfile`** bundles both into one always-on Container App.

Highlights:
- **3D digital twins** of each asset that stream live historian values and pin faults to physical zones.
- A **failure simulation** that fast-forwards an asset up to 14 days, drives a real breakdown from
  the short-term stop + long-term survival models, and shows root cause + feedback.
- A **knowledge graph** (ontology) of the whole data model, generated from the semantic model.
- **Chat-with-your-data** grounded in the Eventhouse (KQL) and semantic model (DAX) via Foundry.

Run locally against a deployed workspace:
```powershell
cd report-app
npm install
npm run build
node server/index.js          # serves the SPA + API + WS on http://localhost:7700
```
Connection targets resolve from env (`PBI_WORKSPACE`, `PBI_DATASET`, `KUSTO_CLUSTER`,
`KUSTO_DATABASE`) → `last-deploy-state.json` → `server/target.json` (local dev fallback).

---

## 📚 Appendix — The documentation site *(moved to its own repo)*

The public documentation site and trailer video now live in
[**paulshaheen/OneGrid-Site**](https://github.com/paulshaheen/OneGrid-Site). They are **not** part
of the accelerator — you don't clone, deploy, or run them to stand up the solution. See that repo's
README for build/deploy details (Azure Static Web Apps + the `AZURE_STATIC_WEB_APPS_API_TOKEN` secret).

---

## 📊 Telemetry & privacy

To help the OGE team see adoption, the wizard reports a **one-time install event** to a
Microsoft **Application Insights** when you deploy. It records: your Azure **tenant** and
**signed-in user**, **subscription**, **region**, chosen **workspace name**, **wizard version**,
and the **deploy outcome** (success / issues / duration). **Nothing from inside your workspace or
data is sent.**

It is **on by default** and easy to opt out — any one of:
- **uncheck** the "Share an install event" box on the wizard's config screen, or
- set `"telemetry": { "enabled": false }` in `config.json`, or
- set the environment variable `ONEGRID_TELEMETRY=0` before deploying.

The send is fire-and-forget and never blocks or fails a deployment. To point it at **your own**
Application Insights, set `telemetry.connectionString` in `config.json` (or env
`ONEGRID_TELEMETRY_CONNSTR`).

---

## 📦 The historical-data bundle (Git LFS)

The bundled parquet under `data/` travels **with the repo** via Git LFS (`.gitattributes`
tracks `*.parquet` and `data/**`). A customer just clones and
deploys — no external storage:
```powershell
git lfs install
git clone <repo-url>
cd OGE-OneGrid
./deploy.ps1 -ConfigPath ./config.json
```
`deploy.ps1` (phase `data`) uploads `data/lakehouse/**` and `data/eventhouse/**` to the new
Lakehouse via OneLake and runs `_load_data` to rebuild the Delta tables. Set `fabric.siteCount`
(0–12) in `config.json` to fan the reference site out into extra synthetic sites.

> Authoring/refreshing the bundle: run `fabric/notebooks/_export_data` in the source workspace,
> download to `data/lakehouse/`, export the Eventhouse with `fabric/eventhouse/_export_eventhouse.kql`
> into `data/eventhouse/`, then commit (LFS stores the binaries).

---

## 🧩 Data plane — Bring your own data (optional bolt-on)

The accelerator runs on bundled synthetic data out of the box. The **data plane** is an
optional, additive module that streams a customer's **own** operational data into the *same*
Fabric landing zone the accelerator already provisions — so the models, dashboards and 3D
twins light up on real data with **no schema or report changes**.

**Why it's nearly free:** the deploy already creates an Eventstream with a **Custom Endpoint
source** (`PIForwarderEndpoint`) that lands events in `PiEventsRaw` → (update policy) →
`PiEvents`. The synthetic seed and any data-plane connector are just interchangeable producers
into that endpoint. Turning it on = point a connector at that endpoint.

- **Connector contract** — emit the canonical `PiEventsRaw` JSON shape to the custom endpoint
  (Event Hub–compatible / AMQP). Match it and everything downstream works. Full spec:
  [`bolt-ons/data-plane/README.md`](bolt-ons/data-plane/README.md).
- **Shared core** — `bolt-ons/data-plane/core/Forwarder.Core/` is the source-agnostic
  reliability core (durable SQLite outbox, AMQP publisher + cert auth, drain/heartbeat loops)
  reused by every connector; a connector adds only a source-read loop.
- **PI connector** — `bolt-ons/data-plane/connectors/pi-forwarder/` streams **OSIsoft/AVEVA
  PI** data (WebSocket + poll).
- **SQL Server + Oracle connector** — `bolt-ons/data-plane/connectors/db-forwarder/` streams
  either relational database via watermark polling (durable per-source high-watermark;
  narrow or wide/unpivot shapes; DB creds from env, not the repo).
- **Extensible** — the same pattern generalizes to other historians, OPC-UA/MQTT, and
  GADS/work-order feeds (see the connector contract).

**Wire it up after a deploy** (opt-in — never part of the default deploy path):
```powershell
./deploy.ps1 -ConfigPath ./config.json -DataPlane          # after a full deploy
./deploy.ps1 -ConfigPath ./config.json -Only dataplane     # standalone (workspace already exists)
```
…or click **“Set up Data Plane (optional)”** on the wizard's launch screen. This resolves the
deployed custom-endpoint namespace and writes a pre-filled
`bolt-ons/data-plane/connectors/pi-forwarder/appsettings.generated.json` (tenant + FQDN + stream
filled; you supply the Entra app, client certificate, and PI host). The base accelerator keeps
running on synthetic data regardless.

---

## OGE Power BI add-on module

A self-contained Power BI module is layered onto the accelerator lakehouse: 8 tables in a new
`oge` schema inside `lh_poc` and a Direct Lake `semantic-oge` model. Build reports directly
against the `semantic-oge` model in the Fabric service.
```powershell
./deploy.ps1 -ConfigPath ./config.json -Only core,data,oge   # or a full run
# then build OGE reports against the 'semantic-oge' model in the Fabric service
```

The `oge` phase also deploys a **native Fabric ontology** — a **Digital Twin Builder** item
(`OneGridOntology`) over `lh_poc` modeling the domain (Plant → Unit → Asset → Sensor, plus
WorkRequest, Advisory, Outage, Prediction) as first-class entity types + relationships. It lives
alongside the notebook-derived knowledge graph the web app renders (`fabric/digitaltwinbuilder/`).

---

## 🔐 Data governance & OneLake security

A governance/security **control plane** layered onto the accelerator to demonstrate
**OneLake security** — "who can access what, and why." Fabric / OneLake / Power BI remain the
**authoritative enforcement** layer; the accelerator adds an **inventory + explanation + review**
experience on top (it is never an enforcement point).

**What the `governance` phase provisions** (opt-in — `governance.enabled: true` in `config.json`):
- **OneLake data-access roles** on `lh_poc`, table/folder-scoped and mapped to persona **Entra
  security groups** — `ExecutiveCuratedReader` (curated Gold only), `ControlRoomSiteReader`
  (site-level RLS), `MaintenanceReader` (commercial columns hidden — CLS), `OntologyReader`.
- A **governance manifest** (`governance-manifest.json`, git-ignored) consumed by the review plane.
- A flag to move the Lakehouse **SQL endpoint to user-identity mode** so SQL queries honour
  OneLake row/column security per-user.

**Least-privilege app identity** — set `governance.leastPrivilegeApp: true` and the `permissions`
phase grants the container-app identity **workspace Viewer + semantic-model ReadWrite** instead of
**workspace Member**, so the runtime identity can never bypass model RLS or manage the workspace.

**The review plane** — a **shield** button in the app header opens a read-only `/governance`
experience (also surfaced as a posture badge on the Executive page):
- **Posture** — findings (excessive app grant, memberless roles, direct-user grants, missing
  reviewers group…), collector status, and totals.
- **Who has access** — principal → resources, with the granting role, row filter, allowed columns,
  group-vs-direct inheritance, and a **Why?** grant-path explanation.
- **Who can see this** — resource → principals.
- **Changes** — snapshot-to-snapshot access diffs.
- **Policy tests** — declared positive/negative persona expectations to verify with native queries.
- **Native controls** — deep links to the OneLake Secure editor, workspace access, and Purview Audit.

Config lives under `governance` in `config.sample.json` (supply **existing** Entra security-group
object IDs — never distribution lists; no secrets belong in this block). Backend collectors are
best-effort and degrade gracefully when admin/OneLake APIs are preview/unavailable in a tenant. In
production, gate the review APIs by setting `GOVERNANCE_REQUIRE_AUTH=1` (requires a Container Apps
EasyAuth principal carrying the `Governance.Reader` app role or membership in the reviewers group).

```powershell
./deploy.ps1 -ConfigPath ./config.json -Only core,data,semantic,oge,governance,permissions
```

---

## Notes & limits
- **Parameterization:** exported artifacts contain source workspace/lakehouse/SQL/Kusto IDs
  that are **string-replaced** with the new target IDs during deploy (`$SRC` + `BuildDefinition`
  in `deploy.ps1`). Re-export with `tools/export-artifacts.ps1`.
- **Eventstream / dataflow / KQL-dashboard** external bindings may need a one-time reconnect in
  the portal after deploy.
- **Adding models** (Claude / GPT-5 / Llama…): deploy them to the Foundry account and they appear
  in the chat agent's model selector automatically.
- **Secrets:** `config.json`, `last-deploy-state.json` and deploy logs are **git-ignored** — never
  commit them. Use `config.sample.json` as the template.
