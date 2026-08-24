# 🧩 Data Plane — Bring Your Own Data (optional bolt-on)

The core accelerator ships with a **bundled historical dataset and a synthetic real‑time
seed**, so every model, dashboard and 3D twin lights up the moment you deploy. The **Data
Plane** is the optional bolt‑on that swaps that synthetic feed for **your own operational
data** — streamed live into the exact same Fabric landing zone the accelerator already
provisions.

> **Nothing here is required to run the accelerator.** It's an additive layer you turn on when
> you're ready to connect a real source. The core deploy path is untouched.

---

## Why this is (almost) free

When you deploy the accelerator it already creates the entire real‑time lane:

```
your source ──▶  Eventstream  ──▶  Eventhouse            ──▶  update policy  ──▶  PiEvents
              (Custom Endpoint)   (PiEventsRaw landing)                            (curated)
              "PIForwarderEndpoint"
```

The Eventstream (`fabric/eventstream/pi-events-stream/`) is provisioned with a **Custom
Endpoint source named `PIForwarderEndpoint`** whose only job is to accept events from an
outside producer and land them in `PiEventsRaw`. The synthetic seed publishes to that
endpoint; **so does every Data Plane connector.** Turning on the Data Plane is therefore just:

1. Stand up a connector that reads your source.
2. Point it at the accelerator's `PIForwarderEndpoint`.
3. Real data replaces synthetic — no schema changes, no report rewiring.

---

## The connector contract

A Data Plane connector is **anything that emits the canonical event shape to the Eventstream
custom endpoint.** That's the entire contract. Match this and every downstream model,
semantic measure, KQL dashboard and 3D twin works unchanged.

### 1. Transport
Publish JSON events to the accelerator's **Eventstream Custom Endpoint** (`PIForwarderEndpoint`).
The endpoint is **Event Hub–compatible**, so any Event Hubs / AMQP 1.0 client works
(the reference connector uses the Azure Event Hubs SDK over AMQP‑WebSockets on 443).

### 2. Payload — the `PiEventsRaw` shape
One JSON object per reading. Field names are case‑sensitive and map 1:1 to the
`PiEventsRaw` table + `PiEventsRawMapping` in `fabric/eventhouse/schema.kql`:

```json
{
  "webId":        "F1DPxxxx…",        // stable unique id for the point/signal (string)
  "tag":          "PLANT1:BEARING_TEMP.PV",  // human-readable point name (string)
  "ts":           "2026-08-16T04:59:00.000Z", // reading timestamp, ISO-8601 UTC (datetime)
  "value":        123.45,             // the reading — number, bool, or string (dynamic)
  "valueType":    "Double",           // optional CLR/type hint (string)
  "questionable": false,              // quality flag (bool)
  "substituted":  false,              // quality flag (bool)
  "plant":        "PLANT1",           // asset-group / site label carried through (string)
  "source":       "channel",          // producer mode label, e.g. channel|poll|batch (string)
  "host":         "PI-JUMP-01"        // emitting host / connector id (string)
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `webId` | string | ✅ | Stable identifier joined to asset metadata. Use any unique per‑signal key. |
| `tag` | string | ✅ | Display name. |
| `ts` | datetime (ISO‑8601 UTC) | ✅ | Event time of the reading. |
| `value` | number \| bool \| string | ✅ | Landed as `dynamic`. |
| `valueType` | string | ⬜ | Optional type hint. |
| `questionable` / `substituted` | bool | ⬜ | Quality flags; default `false`. |
| `plant` | string | ✅ | Site / asset‑group label used for filtering and roll‑ups. |
| `source` | string | ⬜ | Free‑form producer label. |
| `host` | string | ⬜ | Producer/host id for observability. |

Downstream, an Eventhouse **update policy** folds `PiEventsRaw` into the curated `PiEvents`
table (`Ts, WebId, Tag, Plant, Value, ValueType, Questionable, Substituted, Source, Host,
IngestedAt`) — you never write to `PiEvents` directly.

### 3. Delivery expectations
- **At‑least‑once** is fine — the models tolerate duplicate/late points.
- Prefer a **durable local buffer** so a Fabric outage or capacity pause never drops data
  (the reference connector uses a crash‑safe SQLite WAL queue with delete‑after‑ack).
- Emit a periodic **heartbeat** event so you can alert if a feed goes silent.

---

## Shared core + connectors

The bolt-on is a small .NET solution (`DataPlane.sln`):

| Project | Path | Role |
|---|---|---|
| **Forwarder.Core** | `core/Forwarder.Core/` | Source-agnostic reliability core: durable SQLite outbox, Fabric AMQP publisher (cert auth), drain + heartbeat loops, canonical `SourceEvent`, shared options, and the `ISourceHealth` abstraction. **Every connector reuses this.** |
| **pi-forwarder** | `connectors/pi-forwarder/` | Reference connector — OSIsoft/AVEVA **PI System** (WebSocket + poll). |
| **db-forwarder** | `connectors/db-forwarder/` | Generic **SQL Server + Oracle** connector (watermark polling). |

A connector adds only a **source-read loop** that maps to the canonical shape and enqueues;
the queue → publisher → endpoint path is entirely `Forwarder.Core`.

## Reference connector — `connectors/pi-forwarder/`

**[PIFabricForwarder](connectors/pi-forwarder/README.md)** is the production‑grade reference
implementation of the contract: a .NET 8 Windows Service that streams **OSIsoft / AVEVA PI
System** data (WebSocket channels + HTTP polling) into the accelerator's custom endpoint with
a durable SQLite queue, certificate‑based Entra auth (no secrets in config), and built‑in
metrics/heartbeats.

- **Reads:** PI Web API (`/streamsets/channel` push + `/streamsets/value` poll).
- **Buffers:** durable SQLite WAL outbox (survives crashes / multi‑day outages).
- **Publishes:** AMQP 1.0 → `PIForwarderEndpoint` → `PiEventsRaw`.
- **Auth:** X.509 client cert on an Entra app granted `Azure Event Hubs Data Sender`.

See its [README](connectors/pi-forwarder/README.md) for build / configure / install. The
accelerator's deploy wizard can emit a pre‑filled `appsettings.json` for it (see
[Wiring](#turnkey-wiring-from-the-deploy-wizard)).

## Relational connector — `connectors/db-forwarder/`

**[db-forwarder](connectors/db-forwarder/README.md)** streams **SQL Server** *or* **Oracle**
tables into the same custom endpoint — one connector, both databases, selected per source via
an ADO.NET provider abstraction. It reuses `Forwarder.Core` and adds only a relational read
loop:

- **Reads:** a configurable `SELECT` per source, polled on an interval.
- **Change capture:** durable per-source **high-watermark** (`Long` sequence or `DateTime`
  with an overlap re-read window); advances only after a successful enqueue → at-least-once.
- **Shapes:** `Narrow` (tag,ts,value per row) or `Wide` (unpivot measurement columns).
- **Auth:** Fabric cert as above; DB connection strings from env (`DBFWD_CONN_<NAME>`) —
  prefer Entra/Managed Identity (SQL) or Oracle Wallet, no secrets in the repo.

Configure sources in `sources.json` (see `connectors/db-forwarder/sources.sample.json`).

---

## Adding a new source

Because the contract is just "emit the shape to the endpoint," new sources are
straightforward. Pick the pattern that fits:

| Source type | Suggested approach |
|---|---|
| **SQL Server / Oracle** table | Use the shipped **[db-forwarder](connectors/db-forwarder/README.md)** — just add a source to `sources.json`. |
| **Other historian** (PI AF, Aspen IP.21, Wonderware/AVEVA Historian, Canary) | New `connectors/<name>/` referencing `Forwarder.Core`; implement a read loop + `ISourceHealth`, reuse the queue/publisher. |
| **OPC‑UA / OPC‑DA server** | OPC‑UA subscription → map node updates to the payload → enqueue. |
| **MQTT / Sparkplug B** | Subscribe to topics → decode → enqueue. |
| **GADS / outage & work‑order feeds** | Batch/ETL job emits records with `source:"batch"`; lands in `PiEventsRaw` (or a sibling raw table) for availability analytics. |
| **CSV / file drop / API pull** | Scheduled job reads + publishes; use `source` to tag provenance. |

**Recommended layout for a new connector:** add a folder under `connectors/<your-source>/`
that **references `Forwarder.Core`** (the reliable transport) and implement only the
source‑read loop + `ISourceHealth`. Keep all secrets out of the repo (`REPLACE-ME`
placeholders + git‑ignored local overrides), exactly like the shipped connectors.

---

## Turnkey wiring from the deploy wizard

After the accelerator is deployed, open the wizard's **Set up Data Plane** panel (post‑deploy,
step 3). Tick any of **PI Server**, **SQL Server**, **Oracle** — each is independent — fill the
connection fields, choose the Eventstream auth (paste the custom‑endpoint **SAS connection
string**, or an Entra app **ClientId + cert thumbprint**), and click **Build &amp; run locally**.
The wizard (`deploy.ps1 -Only dataplane`) then, for each opted‑in source:

1. auto‑resolves the Eventstream **custom‑endpoint FQDN / stream name** and writes
   `appsettings.generated.json` (+ `tags.json` for PI, `sources.json` for SQL/Oracle);
2. sets each DB connection string into a local `DBFWD_CONN_<NAME>` environment variable
   (never written to disk);
3. **`dotnet publish`** es the connector and **runs it on this machine** — installed as an
   auto‑start Windows service (`PIFabricForwarder` / `DbFabricForwarder`) when the wizard is
   run **as administrator**, otherwise started as a background process for the current session.

All generated files (`appsettings.generated.json`, `tags.json`, `sources.json`, `publish-output/`)
are git‑ignored. Requires the **.NET 8 SDK** on the machine. You can also run
`deploy.ps1 -Only dataplane` directly with a `dataPlane` block in `config.json`.

> Prefer secret‑free connections (Entra / Managed Identity for SQL, an Oracle Wallet for Oracle,
> and the client‑certificate path for Fabric) for anything beyond first‑day testing.

---

## What lands where

| Fabric item | Provisioned by accelerator | Role in the Data Plane |
|---|---|---|
| Eventstream `pi-events-stream` (`PIForwarderEndpoint`) | ✅ core deploy | Ingest endpoint every connector publishes to |
| Eventhouse `pi-realtime-db` → `PiEventsRaw` | ✅ core deploy | Raw landing table (matches the payload shape) |
| Update policy → `PiEvents` | ✅ core deploy | Curates raw → the table models/reports read |
| Connector (e.g. PI forwarder) | 🧩 this bolt‑on | Reads your source, publishes the contract |
