# Unified OneGrid Web App — Shape 1 Design (for App Dev)

**Status:** proposal for the app team to review
**Audience:** engineers who own the application (business) logic
**Scope:** how to merge the two existing web apps into ONE web app that calls the
infrastructure (Fabric / GeoCatalog / Foundry / Blob) via APIs. Infrastructure is
already stood up by the single Deploy-to-Azure button; this document is only about
the application layer.

---

## 1. The two apps today

### App A — PCP web app (`planetary-computer-pro-poc/webapp`)
*The forward-looking risk / geospatial plane.*

- **Stack:** TanStack Start (**SSR**), **React 19 + TypeScript**, MSAL (Entra) sign-in,
  MapLibre GL, Radix UI + Tailwind v4, TanStack Query/Router, Zod. Production host is
  `server.mjs` (srvx) serving the SSR `fetch` handler.
- **Key strength — a clean service seam:** `PlatformServices` interface
  (`src/lib/services/interfaces.ts`) with two interchangeable implementations selected in
  `src/lib/services/index.ts`:
  - **Mock** providers (synthetic sample estate, offline dev), and
  - **Azure** providers (`src/lib/services/azure/providers.ts`) that call **TanStack server
    functions** in `src/lib/services/azure/server.ts` (managed-identity tokens; GeoCatalog
    STAC, Aurora weather in Blob, uploaded assets, Foundry copilot).
- **Pure domain logic** (shared client/server): `risk-engine.ts` (`scoreAsset`),
  `posture.ts` (`derivePosture`), `thresholds.ts`. Risk = asset x weather event over a
  horizon -> posture gates / shut-in decisions.
- **Views:** map, risk, assets, events, alerts, posture, thresholds, timeline, copilot.

### App B — OneGrid report-app + chatagent (`OGE-OneGrid/report-app`, `OGE-OneGrid/chatagent`)
*The present / historical operations plane.*

- **Stack:** Vite + **React 18 (SPA, JS)**, **three.js / react-three-fiber** 3D twin,
  framer-motion, recharts, zustand, WebSocket. Backend is a **raw Node http server**
  (`report-app/server/index.js`) exposing `/api/*` + static SPA + a WebSocket.
- **Backend business logic** (`report-app/server/`):
  - `fabric.js` — token ladder **SP -> managed identity (IMDS) -> az CLI**; **DAX** via
    Power BI `executeQueries` + **KQL** via Eventhouse; capacity-paused detection.
  - `dataApi.js` — read-only API over the semantic model + Eventhouse (TTL-cached):
    status, fleet-health, fleet-assets, facility-model, watchlist, anomalies, work-orders,
    outages, predictions, asset detail, tag-values/trend, narrative, realtime-pulse.
  - `governance.js` (OneLake-security review plane), `manuals.js` (Foundry IQ manuals),
    `realtime.js` (WebSocket pulse), `target.js` (workspace/dataset resolution),
    `chat.js` (SSE proxy to the chat agent), `ontology.json`.
- **Frontend** (`report-app/src/App.jsx`): **persona-driven** dashboards —
  Executive / ControlRoom (3D twin) / Maintenance / Ontology / Governance + ChatPanel + Tour.
- **chatagent** (separate Node service): NL chat grounded via **Fabric Data Agent (MCP)**
  over KQL/DAX; AI provider = Azure AI Foundry (customer) or GitHub Copilot (dev); SSE stream.

### They compose, they don't overlap
- **App A** answers *"what is my forecasted exposure?"* (weather -> risk -> posture).
- **App B** answers *"what is my current condition?"* (telemetry, health, maintenance, twin, chat).
- The join key across both is **`asset_id`** — the same key the Fabric
  `geo_point_in_polygon` composite-risk tables already use. Merging them yields one
  **Asset-360** view neither app can produce alone.

---

## 2. Shape 1 = the chosen target

> One SSR host (App A) + a unified typed API contract + App B's backend ported into server
> functions behind new services + App B's UI ported as feature modules, joined on `asset_id`.

App A is the host because it already has the newer stack (React 19, TS, SSR, MSAL) **and**
the interchangeable provider registry — the exact seam a merge needs. App B becomes
providers + feature modules inside it. Do **not** create a third project.

### Target layout
```
webapp/                          # the ONE deployable (TanStack Start SSR host)
  src/
    lib/
      domain/types.ts            # extend: Asset gains ops/condition fields (Asset-360)
      services/
        interfaces.ts            # extend PlatformServices with B's domains
        index.ts                 # provider registry (seam unchanged)
        azure/
          token.ts               # NEW: unified token ladder (MI -> SP -> az)  [from B fabric.js]
          fabric.ts              # NEW: dax()/dax1()/kql()/capacity-state       [port of B fabric.js]
          providers.ts           # add Operations/Twin/Ontology/Gov/Manuals/Chat providers
          server.ts              # add server functions wrapping fabric.ts
    routes/
      _authenticated/
        control-room.tsx         # 3D twin  (ssr:false)
        ontology.tsx             # graph    (ssr:false)
        maintenance.tsx
        governance.tsx
    features/                    # NEW: ported B UI (three.js twin, ontology graph, chat)
```

---

## 3. Extend the seam (the core work)

Add App B's capabilities as new interfaces in `interfaces.ts`, so the UI still only ever
talks to `PlatformServices`. Each new service gets an **Azure provider** (calls server
functions) *and* a **Mock provider** (keeps sample mode + offline dev working).

| New service | Methods (-> current B endpoint) |
|---|---|
| `OperationsService` | `status()` -> `/api/status`; `fleetHealth()`; `fleetAssets()`; `watchlist()`; `anomalies()`; `outages()`; `realtimePulse()` |
| `MaintenanceService` | `workOrders()`; `workOrdersSummary()`; `assetWorkOrders(id)`; `predictions()` |
| `TwinService` | `facilityModel()` -> `/api/facility-model`; `tagValues(tags)`; `tagTrend(tag,h,bin)` |
| `OntologyService` | `graph()` -> `/api/ontology` |
| `GovernanceService` | `posture / principals / resources / changes / tests / explain` (read-only) |
| `ManualsService` | `search(q)`; `resolve(workOrder)` (Foundry IQ) |
| `ChatService` | `ask(stream)` — replaces App A's thin `CopilotService` |

This preserves App A's biggest strength: the interchangeable registry in `index.ts`.

---

## 4. Port App B's backend into server functions

- **`token.ts`** — App A already has the managed-identity half
  (`getManagedIdentityToken`). Add App B's **SP** and **az-CLI** fallbacks so one module
  works in-container (MI) and in local dev (az). One ladder for all audiences (GeoCatalog
  `geocatalog.spatio.azure.com`, Power BI `analysis.windows.net/powerbi/api`, the Kusto
  cluster, Cognitive, Storage).
- **`fabric.ts`** — near-verbatim TS port of B's `fabric.js` (`dax`, `dax1`, `kql`,
  `getCapacityState`, `isCapacityPausedError`).
- **`server.ts`** — wrap each `dataApi.js` function in a `createServerFn` (keep the TTL
  cache). This deletes B's raw-http router: routing becomes TanStack routes + server functions.

---

## 5. The two long-lived exceptions (design for these early)

Server functions are request/response — they **cannot hold a socket**. Two pieces need a
persistent process:

1. **Realtime** (`report-app/server/realtime.js` — `ws` on `/ws/realtime` + an
   Ornstein-Uhlenbeck tick simulator for smooth per-second motion): attach a
   `WebSocketServer` to the **underlying Node server srvx creates** inside `server.mjs`.
   Keep `realtime.js` almost unchanged. *Alternative:* convert to SSE if WebSockets on App
   Service are unwanted — but the OU simulator is the smooth-motion feature, so keeping WS
   is recommended.
2. **Chat SSE**: expose one `/api/chat` streaming route in the host that forwards to the
   **chatagent** (grounded Fabric Data Agent MCP). Keep the chatagent as-is (it is already
   container-deployed by the Deploy button's `chatagent` phase); the host just proxies.
   `ChatService.ask` streams from that one endpoint.

Merged runtime = **SSR host (functions) + WS attach + chat proxy**, all in one deploy.

---

## 6. Authentication — two planes, one app

- **User plane:** MSAL / Entra (App A's model) for sign-in and per-user authorization
  (personas, governance reader).
- **Service plane:** the `token.ts` ladder (managed identity in Azure) for **all**
  Fabric / Power BI / Kusto / GeoCatalog / Foundry calls — no user tokens touch the data
  plane. This matches how the data-plane roles are granted in `main.bicep`.

---

## 7. The product payoff: Asset-360 join

Extend `Asset` in `domain/types.ts` so one asset carries both planes, and make the
per-asset route fan out in parallel:

```ts
// asset.$id route loader
const [risk, posture, health, workOrders, twin] = await Promise.all([
  services.risk.scoreOne(id),         // App A (forecast)
  services.posture.listPostures(),    // App A
  services.operations.fleetHealth(),  // App B (condition)
  services.maintenance.assetWorkOrders(id),
  services.twin.facilityModel(),
]);
```

Joined on **`asset_id`** (the composite-risk key). This is the single view neither app can
produce alone: forecasted hazard risk fused with live condition + maintenance + twin.

---

## 8. Information architecture

Adopt App B's **persona-first IA** (Executive / ControlRoom / Maintenance / Ontology /
Governance) as the top level; fold App A's map / risk / events / posture views into
Executive + ControlRoom. Keep App B's **capacity-paused banner** as a global concern driven
by `OperationsService.status()`.

---

## 9. Sequencing (each milestone independently shippable)

- **M0 — Contract freeze.** Write the typed seam (interfaces + OpenAPI) covering both
  domains. This is the API the app team codes against and the seam the infra button already
  stands up. **Do this first.**
- **M1 — Token + fabric port.** `token.ts` + `fabric.ts` + one server function (`status`)
  proving MI -> Fabric works in-container. Wire the capacity-paused banner.
- **M2 — Operations / Maintenance providers.** Port `dataApi.js` read endpoints -> server
  functions + Azure/Mock providers. App A's existing views light up with real fleet data.
- **M3 — Twin + Ontology.** Bring three.js ControlRoom + ontology graph as `ssr:false`
  lazy routes (bump react-three-fiber to v9 for React 19).
- **M4 — Chat.** One `/api/chat` SSE in the host -> chatagent; replace `CopilotService`
  with the grounded `ChatService`.
- **M5 — Realtime.** Attach `ws` to the host's Node server; keep the OU simulator.
- **M6 — Governance + Manuals + Asset-360.** Read-only governance plane, Foundry IQ
  manuals, and the fused per-asset view.

---

## 10. Shape-1-specific gotchas

- **React 18 -> 19 / JS -> TS:** App B is React 18 + JSX; standardize on 19 + TS.
  `@react-three/fiber` must go to **v9** (v8 is React 18). Migrate incrementally
  (`allowJs` during the transition).
- **SSR vs client-only:** three.js / WebGL and the ontology graph must be `ssr:false` —
  do not server-render them.
- **WebSockets on App Service:** enable Web Sockets on the plan; confirm srvx exposes the
  Node server (it does) so `attachRealtime(server)` works unchanged.
- **Two chat brains:** delete App A's shallow Foundry copilot path; converge on App B's
  grounded agent so chat reasons over risk *and* operations data.
- **Token audiences:** one ladder, many resources — keep them as named constants.

---

## 11. What infra already provides (the seam you build against)

The single Deploy-to-Azure button stands up, with selectable components:

- **Geospatial plane** (native Bicep): GeoCatalog / STAC + Tiler, geo ingestion, Aurora GPU
  model, refresh loop.
- **Operational plane** (Fabric): workspace, lakehouse, eventhouse / KQL, eventstream,
  semantic model, the `geo_point_in_polygon` hazard join + composite-risk tables, OneLake
  shortcut to `model-outputs`.
- **App plane** (optional): AI Foundry account + the chat/report Container App.

Deployment outputs expose the endpoints the merged app consumes: GeoCatalog URI, Tiler,
Eventhouse / KQL query URI, OneLake path, Foundry endpoint, sample storage / blob endpoint.
Those outputs ARE the API contract M0 formalizes.
