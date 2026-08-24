# Web App (`report-app` + `chatagent`)

The interactive front end of the accelerator: a **React + Three.js** dashboard served by a
Node backend that also spawns the **chat agent** as a child process. The repo-root
[`Dockerfile`](../Dockerfile) bundles both into a single always-on Azure Container App.

## What it does

- **3D digital twins** — per-asset 3D models (turbine, boiler, pump, generator) that run in
  real time, stream live historian values, and pin anomaly / root-cause / watchlist signals
  to the exact physical zone.
- **Failure simulation** — fast-forwards an asset up to 14 days, drives a real breakdown from
  the short-term stop model + long-term survival model, projects the degrading sensors, and
  pauses at each predicted failure with its root cause and a thumbs-up/down feedback prompt.
- **Knowledge graph (ontology)** — a force-directed graph of the whole data model, generated
  from the Fabric semantic model; click any entity for its columns/relationships or ask the AI.
- **Chat with your data** — grounded in the Eventhouse (KQL) and the semantic model (DAX) via
  Azure AI Foundry, with a model selector.
- Three personas (Executive / Control-Room / Maintenance), light / dark / **Fabric & Foundry**
  themes, and a guided tour.

## Architecture

```
report-app/
├── src/                 React SPA (personas, three/ 3D, components/, lib/)
├── server/
│   ├── index.js         HTTP server: serves the built SPA + data API + realtime WebSocket
│   ├── dataApi.js       fleet/asset/watchlist/anomaly/prediction endpoints (KQL + DAX)
│   ├── realtime.js      per-second live-value simulator + fleet pulse over WS
│   ├── fabric.js        Fabric auth (SP → managed identity → az CLI) + query helpers
│   ├── chat.js          spawns ../chatagent as a child, proxies /api/chat + /api/models
│   └── target.js        resolves which workspace/dataset/eventhouse to query
└── vite.config.js
chatagent/               natural-language agent (server.js) — reasons with Foundry, queries KQL/DAX
```

The report server (`index.js`) listens on `REPORT_PORT` (**8080** in the container, 7700 in
dev) and spawns the chat agent on an internal port, passing it the same resolved connection
targets. So both the dashboard and the chat use one set of env vars.

## Run locally (against a deployed workspace)

```powershell
cd report-app
npm install
npm run build          # builds the SPA into dist/
node server/index.js   # http://localhost:7700  (SPA + /api + /ws)
```

Connection targets resolve in this order:
1. **Env vars** — `PBI_WORKSPACE`, `PBI_DATASET`, `KUSTO_CLUSTER`, `KUSTO_DATABASE`
2. `../last-deploy-state.json` (written by `deploy.ps1`)
3. `server/target.json` (local dev fallback — git-ignored in the image)

AI provider env (for chat): `AZURE_AI_ENDPOINT`, `AI_DEFAULT_MODEL`, and
`AZURE_AI_SUBSCRIPTION_ID` / `AZURE_AI_RESOURCE_GROUP` / `AZURE_AI_ACCOUNT` (to enumerate the
Foundry model deployments). Auth uses the container's managed identity in Azure.

## In the accelerator

You don't build this by hand for a normal deploy — `deploy.ps1` (phase `chatagent`) builds
the image via `az acr build` and creates the Container App with all the env vars wired to the
freshly provisioned Fabric + Foundry resources.
