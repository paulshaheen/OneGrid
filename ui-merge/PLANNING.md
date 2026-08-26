# OneGrid — UI Merge Planning

> Branch: `ui-merge-explore` · Scope: **UI only** — merge the two web apps into one
> seamless product experience. No backend/data changes in this phase; we iterate on the
> shell, information architecture (IA), and design language using a lightweight localhost
> prototype (`ui-merge/prototype/`).

---

## 1. What we are merging

| | **App A — `report-app`** (OGE-OneGrid) | **App B — `webapp`** (planetary-computer-pro-poc) |
|---|---|---|
| Product name today | **OneGrid** | **Asset Weather Ops** |
| Purpose | Deep Fabric intelligence: 3D digital twin, ontology/knowledge graph, failure simulation, chat-with-your-data | Weather + asset **risk** ops: live map, exposure scoring, response posture, alerts, forecast timeline; plus the marketing front door + Azure deploy |
| Framework | React 18, **Vite 5**, plain SPA (no router — persona state) | React 19, **Vite 8**, **TanStack Router/Start** (SSR), TanStack Query |
| Styling | Tailwind **3**, custom theme objects, framer-motion | Tailwind **4**, **shadcn/ui + Radix**, CSS design tokens (`--background`, `--foreground`, …) |
| Heavy deps | **Three.js** (react-three-fiber/drei), recharts, zustand, WebSocket | **maplibre-gl**, recharts, react-hook-form, zod |
| Auth | none in UI (managed identity server-side) | **Entra / MSAL** (`window.__APP_CONFIG__`) |
| Server | Node `server/index.js` (:7700 dev / :8080), serves SPA + `/api` + `/ws`, spawns chatagent | `server.mjs` (srvx/nitro), SSR, sample-data mode |
| Navigation surfaces | Personas: Executive · Control-Room (3D) · Maintenance · Ontology · Explorer · Governance | Marketing: `/`, `/solution`, `/architecture`, `/security` · Console `/app/*`: Overview · Live Map · Weather Events · Asset Risk · Forecast Timeline · Response Posture · Thresholds · Alerts · Operations Assistant · Asset Management · Deployment |
| Fonts / feel | System sans, "Fabric & Foundry" accent | **IBM Plex Sans/Mono**, energy-ops dark |

**They are the same domain** (energy/industrial asset intelligence) from two angles:
App B is the polished *front door + weather-risk operations*; App A is the *deep
Fabric-powered twin/ontology/predictive* layer. They are complementary, not competing.

## 2. Where the merge stands today (the existing seam)

A composition seam already exists and works:

- `report-app` is the **host shell** (persona tabs).
- `webapp` is surfaced as the **"Explorer" persona** — an `<iframe src="/webapp/">`
  (`report-app/src/personas/Explorer.jsx`).
- The report server **reverse-proxies** `webapp` under `/webapp`, so it all ships as
  **one origin / one deployment**. `webapp`'s router honors `basepath = /webapp`.

This proves "one app, one deploy" is achievable. The problem is it is **not seamless**:
two headers, two theme toggles, two design systems, nested chrome, no shared nav/auth/state.

## 3. Design goal

One product — **OneGrid** — where a user never perceives "two apps." Single top-level
identity, one nav model, one theme, one auth, consistent components. Weather/Risk and
Digital-Twin/Ontology are just *areas* of the same product.

### Proposed unified information architecture (IA)

```
OneGrid
├── (public) Landing / marketing front door        ← from B
├── Overview            exec KPIs + ops overview     ← A.Executive + B.Overview
├── Weather & Risk                                   ← B
│   ├── Live Map · Weather Events · Asset Risk
│   ├── Forecast Timeline · Response Posture
│   └── Thresholds · Alerts
├── Digital Twin                                     ← A
│   ├── Control Room (3D) · Maintenance · Simulation
├── Knowledge Graph      ontology                    ← A.Ontology
├── Assets               asset management            ← A + B
├── Copilot              one assistant               ← A.chatagent + B.Operations Assistant
├── Governance & Security                            ← A.Governance
└── Deployment           Azure / Fabric              ← B.Deployment
```

## 4. Integration options (pick a direction to iterate on)

### Option 1 — Composed shell over two origins *(harden what exists)*
One OneGrid chrome (top bar + left rail) wraps both; each app renders where it's strongest,
the "other" area embeds via the existing `/webapp` reverse-proxy iframe. A tiny
`postMessage` bridge syncs **theme + auth + active-route** so the seams disappear visually.

- ✅ Least work; ship in days. Both stacks stay as-is (React 18 vs 19, Tailwind 3 vs 4).
- ✅ Reuses the reverse-proxy + Explorer iframe already in place.
- ❌ Iframe seams (scroll, deep-linking, focus), two bundles (heavier), auth/theme bridged not shared, limited cross-area interaction.

### Option 2 — Unified SPA on one stack *(consolidate onto `webapp`)*
Make **`webapp` the single host** (it already has router, shadcn design system, Entra auth,
marketing, SSR). Port App A's Three.js twin, ontology graph, simulation, chat as **native
routes** restyled to the shadcn tokens. One design system, one router, one auth, one bundle.

- ✅ Truly seamless; one design language; shared state + deep-linking; single artifact.
- ✅ Best long-term UX and maintainability.
- ❌ Most effort: React 18→19, Tailwind 3→4, rewrap Three.js views, move App A's Node
  data API (KQL/DAX/WS) behind `webapp`'s server. Highest short-term risk.

### Option 3 — Shared shell + incremental federation *(recommended path)*
Extract a small **OneGrid Shell** contract — top bar, left rail, **design tokens**, theme,
auth context — consumed by *both* apps so they look identical **now**. Mount each app's
areas into one host (Vite module federation / a thin route host). Then migrate area-by-area
from iframe (Opt 1) to native (Opt 2) with **no big-bang rewrite**.

- ✅ Instant visual unity via shared tokens/chrome; independent deploys keep momentum.
- ✅ Clear, low-risk migration path toward the Option 2 end-state.
- ❌ Module-federation/Vite config work; need a shared design-token contract; some
  transitional duplication.

### Recommendation
**Adopt Option 3 as the path, Option 2 as the destination.** Immediately unify the *chrome
and tokens* (shared shell) so it looks like one product; keep the heaviest view (3D twin)
behind the reverse-proxy (Opt 1) only until it's ported natively. The prototype in this
folder lets us lock the shell/IA before touching real code.

## 5. Shell-layout choices to decide (prototype toggles these)

The prototype (`prototype/index.html`) renders the unified shell with **three switchable
layouts** so we can feel the tradeoffs with real content density:

- **A · Left-rail workspaces** — grouped left nav (webapp style). Best for many areas.
- **B · Top workspace tabs** — persona-style top tabs + contextual subnav (report-app style).
- **C · Hybrid** — top workspace switcher + contextual left rail (scales best).

Plus: light/dark theme toggle, unified OneGrid branding, one Copilot dock, mock panels for
every area so we can judge IA and density before implementing.

## 6. How to run the prototype

```powershell
cd ui-merge/prototype
# any static server; e.g. Python:
python -m http.server 5177
# open http://localhost:5177
```
No build, no dependencies — pure HTML/CSS/vanilla JS. Iterate here first.

## 8. DECISION: full Option 2 — one app, one backend

Target: a **single deployable** — one React 19 SPA (TanStack Start) + **one server** +
one origin + one identity. No iframes, no reverse-proxy, no second Node process.

### 8a. Auth decision (investigated)

Findings from `webapp/src/lib/auth/*` + `services/azure/server.ts`:
- Entra/MSAL in the browser is **identity-only** (`openid profile email`) — it establishes
  *who* the user is, not *what data* they can read.
- **All data-plane calls use server-side Managed Identity**, never the user token
  (`azure-config.ts`: "Tokens are never in the browser"). So auth ≠ data authorization today.
- The console gate is **soft**: `_authenticated/route.tsx` is `ssr:false` + `<Outlet/>` with
  **no redirect guard**; the `/auth` page exists but nothing forces it. Unconfigured →
  sample data + no auth (the public demo).
- **App A has no user auth** — pure Managed Identity, internal Container App.

**Decision for the merge:**
1. Adopt **App B's Entra as the single front-door identity** (App A gains a real sign-in) —
   but **wire it up LAST** (see P5). Everything before it is built on the no-auth /
   sample-data path so auth never blocks progress.
2. Keep **Managed Identity for every data-plane call** (Fabric KQL/DAX, GeoCatalog, Foundry) —
   works for both apps unchanged, independent of user sign-in.
3. **Harden the gate only at the end**: add a `beforeLoad` guard on `/_authenticated` that
   redirects to `/auth`. Kept soft (optional) until P5.
4. **Per-user data authorization (row-level) is out of scope** unless required later — that
   needs an On-Behalf-Of token flow to Fabric/GeoCatalog, which neither app has today.
5. Auth stays **optional/degradable**: no Entra config → sample-data demo, same as now.

### 8b. Target topology (one backend)

```
OneGrid (single App Service / Container App, one origin)
└── server.mjs  (TanStack Start / nitro)   ← the ONE server
    ├── SSR + static  (marketing + console SPA)
    ├── /auth/*        Entra sign-in (MSAL redirect)   [identity only]
    ├── /api/*         data plane, Managed Identity server-side
    │   ├── weather/risk/geocatalog   (from App B server.ts)
    │   ├── fleet/asset/anomaly/prediction  (ported from App A server/dataApi.js — KQL+DAX)
    │   └── chat/models               (ported from App A chatagent — Foundry)
    └── /ws            realtime fleet pulse  (ported from App A server/realtime.js)
```
App A's separate Node server and the spawned `chatagent` process are **absorbed** into this
one server as route handlers. One set of env vars, one Managed Identity, one deploy.

### 8c. Front-end consolidation — pin these versions

React-19 line for the 3D stack (rendering is Three.js, so **no visual change**):

| Package | From (App A) | To (React 19) |
|---|---|---|
| `react` / `react-dom` | 18.3 | **19.2** (match App B) |
| `@react-three/fiber` | ^8.17 | **^9** |
| `@react-three/drei` | ^9.114 | **^10** |
| `@react-three/postprocessing` | ^2.16 | **^3** |
| `three` | ^0.169 | keep (compatible) |
| styling | Tailwind 3 + theme objects | **Tailwind 4 tokens / shadcn** |
| state/anim | zustand, framer-motion | keep (both React-19 OK) |

### 8d. Phased plan (cheapest → riskiest; ship continuously)

- **P0 — Shell & tokens.** Build the unified OneGrid shell (top bar + rail + one theme) in
  App B; map App A's theme objects to the shadcn CSS variables. *(No data.)*
- **P1 — Native port of the light App-A views** (Executive, Governance, Ontology graph —
  SVG/DOM, no Three.js): re-mount as `/app/*` routes, restyled. Low risk.
- **P2 — Backend absorb.** Move App A's `dataApi.js` (KQL/DAX), `realtime.js` (WS) and the
  chatagent into `server.mjs` as `/api` + `/ws` handlers on Managed Identity. Unify the two
  Copilots into one. *(Backend seam removed here.)*
- **P3 — The 3D views last** (Control Room, Simulation, Maintenance): upgrade to
  `fiber@9 / drei@10 / postprocessing@3`, mount as **client-only** routes (`ssr:false`),
  re-verify bloom/postprocessing settings and WebGL context under React 19 StrictMode.
- **P4 — Retire** the App A Node server, the reverse-proxy, and the `Explorer` iframe.
  One artifact remains.
- **P5 — Entra auth, LAST.** With the whole product working on Managed Identity + the
  sample-data path, wire the single Entra front door and (if required) harden the gate:
  add the `beforeLoad` guard on `/_authenticated` → `/auth`, unify sign-in/out in the shell,
  confirm the no-config demo still degrades gracefully.

### 8e. Risk register
- **3D upgrade (P3)** — highest risk; isolate behind a client-only route so a regression
  can't blank the app. Snapshot before/after frames to confirm parity.
- **SSR vs client-only** — Three.js + `maplibre` + WebSocket views must be `ssr:false`.
- **StrictMode double-invoke (React 19)** — audit WebGL/WS setup for idempotent init.
- **Tailwind 3→4** — theme-object → CSS-var remap is the biggest mechanical surface.
- **One Managed Identity** — must be granted every role both apps needed (Fabric, GeoCatalog, Foundry).

## 8f. Navigation IA — cleaned rail (research-backed)

Left rail (**Layout A**) is the chosen model; **Hybrid C stays on the table** as the
simplest way to reduce rail busyness (see below). Both are wired in the prototype.

**UX research applied** (NN/g *Left-Side Vertical Navigation*; SaaS sidebar UX 2026):
- Vertical nav *can* hold many items **only if** grouped + progressively disclosed.
- Group related links; **separate primary work areas from utility/admin** (top vs bottom).
- **Progressive disclosure**: collapsible groups; auto-collapse the non-active group.
- **Badges sparingly** — only on core destinations; here they **roll up** to the pillar.
- Icons support (never replace) labels; clear active/hover state; rail 200–280px.
- Offer a **collapse-to-icons** toggle (tooltips) to reclaim canvas.

**Overlaps combined (13 raw items → 4 pillars + Admin; Alerts to the top bar):**

| Raw items (A/B) | → Combined |
|---|---|
| Executive Overview (A) + Operations Overview (B) | **Overview** (one, bold) |
| Weather Events (B) + Forecast Timeline (B) | **Forecast** (tabs) |
| Asset Mgmt (A/B) + Ontology (A) | **Ontology** pillar → *Graph* + *Assets* |
| Operations Assistant / Copilot (B route) | **removed from rail → the chat dialog** |
| Alerts (B) | **top-right bell + badge** (out of the rail) |
| Thresholds + Governance + Deployment (B/A) | **Admin** (secondary, collapsed by default) |
| Control Room + Simulation + Maintenance (A) | **Digital Twin** pillar |
| Live Map + Forecast + Asset Risk + Response Posture (B) | **Weather** pillar |

**Final rail structure (refined):**
```
top bar ……………………  ! Alerts [badge:5]  (near top-right, bell + count)
PRIMARY            ⌂ Overview            (bold)
                   ≈ Weather        [badge:3]  (Live Map · Forecast · Asset Risk · Response Posture)
                   ◧ Digital Twin   [badge:2]  (Control Room · Simulation · Maintenance)
                   ❖ Ontology                  (Graph · Assets)
── divider ──
SECONDARY          ⚙ Admin (collapsed)         (Thresholds · Governance & Security · Deployment)
```
- **"Weather"** (dropped "& Risk" — the pillar's contents make risk obvious; shorter scans better).
- **Alerts** promoted to the **top-right bell** (with the roll-up count) instead of a rail row —
  keeps the "counts where there are alerts" signal while de-cluttering the rail.
- **Ontology** (renamed from "Knowledge Graph") now owns **Assets** (Graph + Registry are the
  same entity model from two views).
- **Overview** rendered **bold** as the anchor/home item.
- Groups **expand/collapse with a smooth animation** (CSS `grid-template-rows 0fr↔1fr` +
  opacity; class toggled in place so it animates), non-active groups auto-collapse.
- **Simulation** icon = alembic ⚗ in the prototype → **lucide `FlaskConical`** in the real
  build (the play/▶ glyph read as "video", wrong affordance).
- **Layout C (hybrid)** remains available as the simplest-rail fallback if options grow.

## 8g. Chat / Copilot — use OneGrid's dialog (not App B's)

Decision: adopt **App A's `ChatPanel`** as the single assistant (it's cleaner and richer),
retire App B's `/copilot` route (removing it from the rail). Features to carry over:
- **Model selector** grouped by vendor (Azure OpenAI / Anthropic / …), persisted.
- **Provider toggle**: Azure Foundry ↔ Copilot.
- **Data-Agent mode**: answer from the published **Fabric Data Agent** grounded in the
  OneGrid semantic model.
- **Follow-up suggestion chips**, persona-aware context, `Ask the data` docked launcher.
Backend: unify onto App A's `/api/chat` + `/api/models` (folded into the one server in P2).

## 8h. Theme / design tokens — align to OneGrid design system

The unified theme adopts the **OneGrid design system** palette (`onegrid.css`, the
darker-feel reference site) instead of the earlier lighter slate+teal:
- Backgrounds (deep navy): `--bg #06080d` · `--surface #0a1020` · `--card #111827` · `--elev #16203a`
- Text: `--fg #f5f8fd` · `--muted #aeb9cd` · `--faint #7d89a1`
- **Borders**: deep blue-grey hairlines `#223149` / `#18233a` (the earlier periwinkle
  `rgba(120,160,255,…)` read as "light blue" on panels — replaced).
- **Primary = Microsoft/Fluent Communication Blue** `#0078D4` (themeDark `#005A9E`,
  themeDarker `#004578`), accent `#2b88d8`, white foreground — deeper and on-brand vs the
  earlier bright azure.
- Status: ok `#3fd08a` · caution `#f0b429` · critical `#ff5a5f`.
These become the shadcn CSS-variable contract in P0 so both apps' surfaces match instantly.

## 8i. Coverage audit + Asset Risk decision

**Coverage (both sources → merged UI): console is 100% propagated.**
- App A personas (Executive, Control-Room, Maintenance, Simulation, Ontology, Governance,
  Chat) and Explorer (absorbed — the webapp is native now) → all present.
- App B console routes (Overview, Live Map, Weather Events, Asset Risk, Forecast Timeline,
  Response Posture, Thresholds, Alerts, Operations Assistant, Asset Management, Deployment)
  → all present.
- **Not propagated (deferred):** public **marketing** pages (Home/Solution/Architecture/
  Security — stripped from the merged webapp, live only on pcp-marketing) and the **guided
  tour**. Front-door concern; out of scope for now per user.

**Asset Risk — resolved the Weather/Twin overlap (Option A).** There are two distinct risk
engines: *weather exposure* (App B `/risk`: forecast × fragility × exposure) and *reliability/
failure* (App A twin: survival/stop models). Decision:
- New top-level **Assets** pillar = **Asset Risk** (unified) + **Registry**.
- **Asset Risk** = per-asset view with three tabs: **Total** (blended), **Weather exposure**,
  **Reliability** — the single asset-centric risk home.
- **Weather** keeps the exposure analysis, retitled **Storm Exposure** (feeds Total).
- **Digital Twin ▸ Maintenance** keeps reliability (survival models).
- **Ontology** is now just the **Graph** (Assets moved up to its own pillar).
- Rail: **Overview · Weather · Digital Twin · Assets · Ontology · Admin**.

## 9. Decisions locked & remaining questions

**Locked (this session):**
- ✅ Direction = **Option 2**, full-stack: one SPA, **one backend**, one origin, one deploy.
- ✅ Navigation = **left rail (Layout A)**, cleaned per §8f (5 pillars + Alerts + Admin,
  grouped with progressive disclosure, alert badges rolled up to the pillar). **Hybrid C
  stays on the table** as the simplest-rail option.
- ✅ Copilot = **OneGrid's `ChatPanel` dialog** (model selector, provider toggle, Data-Agent
  mode, suggestions); App B's `/copilot` route retired.
- ✅ Identity = **Entra/MSAL** (App B) as the single front door, **wired up LAST (P5)**;
  **Managed Identity** for all data. Everything is built on the no-auth/sample-data path
  first so auth never blocks progress. Per-user row-level authorization out of scope unless
  later required.

**Still to confirm with @paulshaheen:**
1. Product **name** everywhere = **OneGrid** (retire "Asset Weather Ops" as a title)?
2. Is a **public marketing landing** in scope, or console-only?
3. **Harden the auth gate** (force sign-in on `/app/*`), or keep it soft with sample-data demo?
4. Final call: **Layout A** (grouped rail) vs **Layout C** (hybrid) — compare in the prototype.
5. Does the **Assets hub** (Registry/Risk/Maintenance as lenses) feel right, or keep Risk under
   Weather and Maintenance under Twin only?
