# Foundry IQ — Equipment Manuals knowledge base (bolt-on)

Grounds the OneGrid assistant and the maintenance work-order experience in a corpus of
**~100 equipment manuals** (boilers, feed pumps, steam turbines, generators, condensers,
economizers, air preheaters, feedwater heaters, control valves, heat exchangers) using an
**Azure AI Search** vector + semantic knowledge base and the Foundry text-embedding model.

```
Question / Work order ─► embed ─► Azure AI Search (vector + semantic) ─► grounded, cited passages
                                                        │
        chat search_manuals tool ───────────────────────┤
        work-order "Resolve with manual" UX ─────────────┘
```

## Corpus & licensing

The corpus is **synthetically generated** (`scripts/gen_manuals.js`) with **fictional
manufacturers** and original text — it mimics the structure of real O&M manuals without
copying any OEM content, so there is **zero copyright/IP risk** for demos. Each manual has
specifications, operating limits, startup/shutdown, a rich fault → cause → resolution
troubleshooting library, and preventive-maintenance tasks, tagged with an
`equipment_category` aligned to the OneGrid ontology.

To bring your own manuals instead, drop documents in and adapt `index_manuals.js` chunking;
keep the same index schema and the app works unchanged.

## What's here

| Path | Purpose |
| --- | --- |
| `scripts/gen_manuals.js` | Generate the synthetic corpus → `corpus/manuals.json`. |
| `scripts/index_manuals.js` | Create the Azure AI Search index and chunk + embed + upload. |
| `deploy.ps1` | Provision embedding + Search, build the index, and wire the app. |
| (`corpus/` is git-ignored — regenerate with the script) | |

The runtime pieces live in the app:
- **`report-app/server/manuals.js`** + routes `/api/manuals/{health,search,resolve,category,item}`.
- **`report-app/src/components/Manuals.jsx`** — the "Resolve with manual" modal + manual viewer.
- **`chatagent`** — the `search_manuals` tool.
- **`report-app/server/manuals.json`** — the servable corpus copy (for full-manual viewing).

## Deploy (one command)

```powershell
# from bolt-ons/foundry-iq-manuals
./deploy.ps1 -FoundryAccount <foundry-acct> -FoundryResourceGroup <rg> `
             -AppName <container-app> -AppResourceGroup <rg>
```

It deploys the embedding model, creates the Search service (with region fallback if a SKU
is capacity-constrained), generates + indexes the corpus, and sets the `MANUALS_*` env vars
on the container app. If you regenerate the corpus, rebuild the app image so the bundled
`report-app/server/manuals.json` matches the index.

## Configuration (app env)

| Variable | Meaning |
| --- | --- |
| `MANUALS_SEARCH_ENDPOINT` / `MANUALS_SEARCH_KEY` | Azure AI Search service + key. |
| `MANUALS_SEARCH_INDEX` | Index name (default `onegrid-manuals`). |
| `MANUALS_AOAI_ENDPOINT` | Foundry endpoint for embeddings (defaults to `AZURE_AI_ENDPOINT`). |
| `MANUALS_EMBED` | Embedding deployment (default `text-embedding-3-large`). |

Embeddings use the container's **managed identity** (Cognitive Services User) — no key in the
serving tier. When the vars are unset, the feature stays cleanly hidden (no manual column,
no chat tool).

## How it shows up

- **Maintenance persona:** every open work order gets a **📖 Resolve** button. It resolves the
  right manual by the asset's equipment category, shows **grounded guidance with citations**,
  opens the full manual, and can hand the problem to the assistant.
- **Chat:** ask "how do I resolve… / what's the limit / what's the procedure" and the assistant
  calls `search_manuals` and answers with manual + section citations.
