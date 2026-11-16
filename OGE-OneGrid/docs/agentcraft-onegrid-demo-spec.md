# AgentCraft × OneGrid demo: spec

Status: draft 2026-11-16 · Owner: Paul Shaheen · AgentCraft repo: `han-microsoft/agentcraft` (private, read via a local clone)

## 1. The demo in one line

AgentCraft builds the agent; OneGrid is the governed operational data under it.

- **Act 1, "Build it":** start from AgentCraft and craft a Foundry agent whose tools are OneGrid's MCP tools. It answers
  questions about transformer T2 at Riverside from OneGrid's Eventhouse and proposes a work order.
- **Act 2, "Make it real":** open AgentCraft's Asset Health demo (`?view=assets`), which today replays a scripted agent over
  fixtures. Flip a **Live: OneGrid** toggle and the same UI is driven by the Act 1 agent. The Design Proposal lens shows that
  the sources it labels as simulated (historian, EAM, work orders) are now answered by OneGrid. The proposed work order
  lands in OneGrid for a person to approve.

## 2. Decisions

| # | Decision | Source |
| --- | --- | --- |
| D1 | Build Acts 1 and 2 together as one storyline | User, 2026-11-16 |
| D2 | Add transformer T2 at Riverside to OneGrid's data, rather than retargeting Asset Health to a Fairview asset | User |
| D3 | Keep OneGrid's MCP auth as is (static `SRE_MCP_KEY`); no Entra hardening in this scope | User |
| D4 | **Localhost first.** Every phase passes on localhost before anything is deployed; deploys only on explicit approval | User |
| D5 | AgentCraft's generated T2 scenario is the source of truth for T2's facts. OneGrid loads those rows, so both apps tell the same story | Proposed |
| D6 | T2 data lives in its own Eventhouse tables (`Riverside_*`, dropped by `load_riverside.py --clear`); no existing table and not the Fabric semantic model is changed in the first pass | Proposed: no risk to the live OneGrid demos |
| D7 | AgentCraft changes stay on a local branch `onegrid-live` in our clone. Nothing is pushed to `han-microsoft/agentcraft` without the owner's agreement | Proposed |
| D8 | The agent model runs in `onegrid-app-0801e1-foundry` (East US 2, `gpt-4.1`). Alternative: `ai-account-qys3utd6tvyjy` in `rg-hosted-agent-eastus2` (gpt-4o only today) | Proposed |

## 3. What exists today

**AgentCraft (Asset Health)** — `agentcraft-showcase-app/src/asset-health/`
- `chat/agent.ts`: a scripted agent that replays recorded tool calls. Six tools: `query_area`, `search_knowledge_base`,
  `read_scada`, `get_maintenance_history`, `get_configuration`, `get_components`.
- The chat is wired with `useAgentChat({ agent: createAssetAgent() })` in `chat/AgentChat.tsx`. That is the seam: a live
  agent with the same signature can replace it.
- The scenario: `data/scenario/*.toml` plus generators `data/generators/gen_*.py` produce SCADA, trends, tickets, work
  orders, documents, components and the area. "Now" is 2026-10-21 08:00; T2 tripped on 20 Oct on the OTI top-oil contact.
- `reality/reality.json` maps each fixture to its real source: D2 SCADA → historian, D3 tickets → EAM/CMMS, D4 work
  orders → EAM; the agent → Foundry hosted agent.
- The live pattern to copy: Retail Region / Caldova Live — `src/retail-region/assistant/liveAgent.ts` (client) and
  `server/retail_live/` (`/api/caldova-live`, turn API, SSE), with the agent package `agent/crafted/caldova-live/`
  (`configuration.yaml`, prompts, Python tool module, `host/main.py` running the `foundry_ops` Responses host).
- Local modes: `npm run dev:all` (replay, no model), `npm run dev:local` (agent on :8088 with `az` login, backend and Vite).

**OneGrid**
- MCP server at `/mcp` (`report-app/server/mcp.js`), key `SRE_MCP_KEY`. Tools: `get_active_alarms`, `get_sensor_health`,
  `get_sensor_trend`, `get_asset_context`, `list_work_orders`, `propose_work_order`.
- Local run: `.\start-local.ps1 -SreDemo -Build`, all on `http://localhost:7700`; the MCP server reads pcpro's Eventhouse.
- Proposed work orders go to the Eventhouse table `AgentWorkOrders` as "Pending approval", approved in OneGrid's UI.

## 4. Tool mapping

| Asset Health tool (scripted) | Live tool on OneGrid MCP | Change in OneGrid |
| --- | --- | --- |
| `read_scada` | `get_sensor_trend` (asset `RS_T2`) | Route `RS_*` assets to the Riverside telemetry table |
| `get_maintenance_history` | `list_work_orders` (asset `RS_T2`) | Return Riverside tickets and work orders with their history rows |
| `get_configuration`, `get_components` | `get_asset_context` (asset `RS_T2`) | Add configuration, components and condition for `RS_*` assets |
| `search_knowledge_base` | **new** `search_documents` | Search the Riverside documents (manuals, specs, incident report, tickets) |
| `query_area` | **new** `get_area_status` | Neighbouring substations and lines with rolled-up health |
| (none) | `propose_work_order` | Accept `RS_T2`; the row shows in OneGrid's Maintenance and SRE views |

The agent sees only these tools. It never holds a Fabric token; OneGrid queries Fabric with its own identity.

## 5. Phases and localhost gates

Each phase ends with its gate passing on localhost. Evidence (command output, screenshots) is saved under the session
folder. No deploy happens before Phase 5, and Phase 5 needs the user's go-ahead.

### Phase 0: both apps run locally
- OneGrid: `.\start-local.ps1 -SreDemo -Build` with `SRE_MCP_KEY` set.
- AgentCraft: local clone on branch `onegrid-live`; `npm run dev:all` from `agentcraft-showcase-app/`.
- **Gate:** `POST http://localhost:7700/mcp` `tools/list` returns 6 tools; `http://localhost:4181/?view=assets` renders the
  Asset Health view with the scripted agent answering the first starter.

### Phase 1: T2 Riverside in OneGrid (D2, D5, D6)
- Run AgentCraft's Asset Health generators to produce the T2 tables.
- `data/riverside/load_riverside.py` copies the 20 generated tables unchanged into `Riverside_*` Eventhouse tables
  (SCADA points, series and events, tickets and history, work orders, story events, assets, specs, configuration,
  components, area, documents). `--clear` drops them.
- `report-app/server/riverside.js` serves them; `mcp.js` routes `RS_*` asset ids to it and adds `get_area_status`,
  `search_documents` and `get_document`. Riverside proposals are tagged with scenario `agentcraft-riverside`.
- **Gate:** `p1_gate.py` calls every tool for `RS_T2` and checks key facts against the generated rows: trip at 14:32 on
  20 Oct, winding hot spot about 112 °C against a 115 °C trip, ticket T-2041 deferred, work order WO-901, procedure
  M-DEFER-4 found and opened. Fairview tools keep their shape and content (no regression). **Passed 20/20 on 2026-11-16.**

### Phase 2 (Act 1): the agent, run locally
- New agent package in the clone: `agentcraft-showcase-app/agent/crafted/onegrid-asset/` — `configuration.yaml` (model
  from D8, limits like Caldova Live), `prompts/agent.md`, and a tool module `onegrid_tools` that calls OneGrid's MCP over
  HTTP (JSON-RPC, `x-api-key` from an environment variable, never committed).
- Built with AgentCraft's own agent-crafting skill, to show the "agent within an hour" claim.
- Run locally with the `foundry_ops` host on :8088 against the local OneGrid (`http://localhost:7700/mcp`).
- **Gate:** the five Asset Health starters each produce tool calls to OneGrid and an answer containing the expected facts
  (≥ 4 of 5 on two runs); "propose a fix" writes one pending work order for `RS_T2`, visible in OneGrid at
  `http://localhost:7700/webapp/app/maintenance`.

### Phase 3 (Act 2): Asset Health goes live, locally
- `src/asset-health/chat/liveAgent.ts`: same signature as `createAssetAgent()`, modelled on `retail-region/assistant/liveAgent.ts`.
- `server/onegrid_live/`: a small turn API route (`/api/onegrid-live`) modelled on `server/retail_live/turns_api.py`,
  forwarding to the agent on :8088.
- A **Live: OneGrid** toggle in the Asset Health header (off by default; the scripted agent stays the default).
- Update `reality/reality.json`: when live, D2/D3/D4 and the agent show "OneGrid (live)" as their source.
- **Gate:** `npm run dev:local`; a Playwright walk at 1440×900 toggles Live, asks the primary question ("Brief me on
  Transformer T2 before we re-energise it"), sees OneGrid tool cards and a grounded answer, proposes the work order, then
  approves it in OneGrid. Scripted mode still passes AgentCraft's own Asset Health check (`npm run asset-health:check`).

### Phase 4: rehearsal on localhost
- A presenter script (about 15 minutes): Act 1 build (pre-baked, with a live tweak), Act 2 toggle and approval.
- **Gate:** two clean end-to-end runs in a row on localhost, timed.

### Phase 5: deploy (only with approval)
- Deploy the agent as a Foundry hosted agent (D8), pointing at pcpro's MCP endpoint. The MCP key goes into the agent's
  environment or Key Vault, never into the repo.
- The AgentCraft showcase change stays local or runs from our own environment unless the AgentCraft owner agrees to merge.
- Load the Riverside tables into pcpro's Eventhouse (already the case if Phase 1 used it) and confirm no change to the
  Fairview demos.

## 6. Risks

| Risk | Mitigation |
| --- | --- |
| The local OneGrid reads pcpro's shared Eventhouse, so Phase 1 writes there | Separate `Riverside*` tables, `Tier` marker, `--clear` flag; no change to existing tables |
| Static MCP key (D3) used by a cloud agent | Key only in environment variables or Key Vault; rotate after demos; Entra hardening stays a follow-up |
| AgentCraft is private and fast-moving | Local branch only (D7); rebase before each rehearsal |
| AgentCraft's packages resolve only through `packagefeedproxy.microsoft.io` | Run installs on the corporate network or VPN |
| Hosted agents cap input at 32,000 characters | MCP tools return compact tables and downsampled series |
| AgentCraft chat can't yet hand a tool approval back to the agent | Approval happens in OneGrid's UI by design |
| Model answers vary | Gates use fact checks over two runs; the scripted agent remains the fallback |

## 7. Open questions

1. Do we want T2 visible in OneGrid's own Asset Explorer? That needs a later change to the semantic model (not in this scope).
2. Who on the AgentCraft side should see this before Phase 5?
3. Move the AgentCraft clone out of `%TEMP%` to a stable folder before any real presentation.

## 8. Status (2026-11-16)

| Phase | Result on localhost |
| --- | --- |
| 0 Both apps run | Passed. AgentCraft on Windows needed Python 3.12 (wheels), UTF-8 mode, Git Bash as npm's script shell, a built library workspace, and one signal-handler patch (`server/main.py`) |
| 1 T2 in OneGrid | Passed 20/20 (`p1_gate.py`): Riverside facts match, Fairview tools unchanged |
| 2 Act 1 agent | Passed: starters 5/5 and 4/5 on two runs; T3 proposal appears and is approved in OneGrid |
| 3 Act 2 live UI | Passed 8/8 (`p3_gate.py`), three times in a row; AgentCraft's `npm run asset-health:check` still passes |
| 4 Rehearsal | Launcher `agentcraft-demo.ps1` starts everything; end-to-end run 61–104 s |
| 5 Deploy | Not started (needs approval) |

Changes from the plan:
- **D8:** the model runs in `foundryOGE/proj-default` (gpt-4.1); `onegrid-app-0801e1-foundry` has no project.
- The agent serves on **:8089** (the showcase's own chat agent keeps :8088), wired through `SHOWCASE_ONEGRID_LOCAL_URL`
  and `POST /api/onegrid/chat`, the same pattern the showcase uses for Seafooder v3.
- Riverside proposals are approved in OneGrid's **SRE page → Agent proposals** panel (new); approved ones become real
  work orders like any agent work order.
- The Design Proposal lens (`reality.json`) is not changed yet: the live state is shown by the **Live: OneGrid** toggle.
  Changing the lens needs AgentCraft's `making-it-real` schema check; left for a later pass.
- When an approved work order already covers the work (T2: WO-901), the agent declines to propose a duplicate. The
  demo's approval moment therefore uses **T3**, whose fix (WO-902) is only a draft.

## 9. Runbook

```powershell
cd OGE-OneGrid
.\agentcraft-demo.ps1            # OneGrid :7700 (if not running), agent :8089, AgentCraft :4181; clears Riverside proposals
.\agentcraft-demo.ps1 -Reset     # between run-throughs: clear Riverside proposals only
.\agentcraft-demo.ps1 -Stop      # stop the agent and the showcase
```

If OneGrid was started without `SRE_MCP_KEY`, its `/mcp` answers 404: restart it through the launcher (stop :7700 first).

### Talk track (about 15 minutes)

**Act 1, build it (6–7 min)**
1. In VS Code, open the AgentCraft repo at `agentcraft-showcase-app/agent/crafted/onegrid-asset/`: `configuration.yaml`
   (7 tools, gpt-4.1, limits), `prompts/agent.md`, `tools/onegrid.py`. "Every tool is one call to OneGrid's MCP server.
   The agent never holds a Fabric token; OneGrid reads its Eventhouse with its own identity."
2. Show OneGrid's MCP tool list (9 tools: the Fairview operations tools plus Riverside area, documents and search).
3. Optional live tweak: change one line of the prompt and rerun a question, to show the build → run → refine loop.

**Act 2, make it real (6–8 min)**
4. `http://127.0.0.1:4181/?view=assets`: AgentCraft's Asset Health. Ask "Why did T2 trip?" on the scripted agent:
   this is the design, replayed over fixtures.
5. Turn on **Live: OneGrid** (the chat resets). Ask "Brief me on Transformer T2 before we re-energise it". Open
   **Evidence** to show the OneGrid tool calls. Same UI, now answered from OneGrid's live data: WO-901, Buchholz gas,
   DGA, sign-off under M-REST-6.
6. Ask "Is T3 heading the same way?", then "Propose a work order for T3 now, with the evidence." The agent cites draft
   WO-902 and proposes the work into OneGrid.
7. Switch to `http://localhost:7700/webapp/app/sre`: **Agent proposals** shows it awaiting approval. Approve it; it
   becomes a real work order ("Ready to schedule").
8. Close: "AgentCraft built the agent in an hour. OneGrid grounds every answer in governed data, and a person approves
   every action."

Fallbacks: if the model is slow or unavailable, turn Live: OneGrid off and continue on the scripted agent. If a proposal
says a duplicate exists, run `.\agentcraft-demo.ps1 -Reset`.
