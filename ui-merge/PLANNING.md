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

## 7. Open questions for @paulshaheen
1. Confirm the **product name** everywhere = **OneGrid** (retire "Asset Weather Ops" as a title)?
2. Is a **public marketing landing** in scope for the merged app, or console-only?
3. **Auth**: standardize on **Entra/MSAL** (App B) for the whole product?
4. Preferred **end-state stack**: consolidate on `webapp` (TanStack + shadcn + Tailwind 4)?
5. Which **shell layout (A/B/C)** feels right after trying the prototype?
