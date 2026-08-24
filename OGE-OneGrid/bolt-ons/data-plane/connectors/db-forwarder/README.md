# db-forwarder — SQL Server & Oracle → Fabric (data-plane connector)

A generic **relational connector** for the [data plane](../../README.md): it polls a
**SQL Server** or **Oracle** table and streams rows into the accelerator's Eventstream
**custom endpoint** (`PIForwarderEndpoint`) using the shared **[Forwarder.Core](../../core/Forwarder.Core/)**
reliability core — the same durable SQLite queue, AMQP publisher, cert auth, and heartbeat as
the PI connector. One connector handles **both** databases via an ADO.NET provider abstraction;
the provider is chosen per source in `sources.json`.

```
SQL Server / Oracle ──(watermark poll)──▶ db-forwarder ──(SQLite WAL queue)──▶ Fabric Eventstream ──▶ Eventhouse (PiEventsRaw → PiEvents)
```

Because every row is mapped to the canonical [`PiEventsRaw` shape](../../README.md#the-connector-contract),
nothing downstream changes — the same models, dashboards and 3D twins light up on your data.

---

## How it works

| Piece | Role |
|---|---|
| `SourceRegistry` | Loads `sources.json` (the `tags.json` analog) at startup. |
| `RelationalPoller` | Per source: runs the watermark query → maps each row to a `SourceEvent` → enqueues a batch. |
| `WatermarkStore` | Durable per-source high-watermark (SQLite). Advances **only after** a successful enqueue → at-least-once. |
| `RelationalPollLoop` | One independent poll task per source, each on its own interval; provides the heartbeat's source-health count. |
| `Forwarder.Core` `PublisherLoop` | Drains the queue to the custom endpoint (delete-after-ack). |
| `Forwarder.Core` `HealthLoop` | Emits the `forwarder.heartbeat` event. |

### Change capture (watermark polling)
Each source declares a **`watermarkColumn`** and **`watermarkType`**:

- **`Long`** *(recommended)* — a monotonic identity/sequence/rowversion column. Strict `>`
  comparison; effectively no gaps or re-reads.
- **`DateTime`** — a timestamp column. Each poll re-reads from `watermark − overlapSeconds`
  to catch boundary/late-arriving rows; the small overlap is de-duplicated downstream
  (at-least-once). Set `initialWatermark` to avoid a full-history backfill on first run.

The watermark advances **only after** the batch is safely enqueued, so a crash replays at most
one batch.

> Advanced change-capture (SQL Server Change Tracking / CDC, Oracle SCN/`ORA_ROWSCN`) can be
> layered on by adjusting the source query; the watermark engine already supports a numeric
> (`Long`) high-water value for those cursors.

---

## Configuration

### `sources.json` (copy from `sources.sample.json`)
An array of sources. Key fields:

| Field | Description |
|---|---|
| `name` | Logical id (also the event `host` label). |
| `provider` | `SqlServer` or `Oracle`. |
| `connectionName` | Key to resolve the connection string from the environment (see [Auth](#authentication--secrets)). |
| `pollIntervalSeconds` | Poll cadence. |
| `query` | `SELECT` returning new rows. Reference the watermark param: **`@watermark`** (SQL Server) or **`:watermark`** (Oracle). `ORDER BY` the watermark column. |
| `watermarkColumn` | Result column whose max advances the watermark. |
| `watermarkType` | `Long` or `DateTime`. |
| `initialWatermark` | Starting value (ISO-8601 for DateTime, integer for Long). |
| `overlapSeconds` | DateTime only: re-read window (default 2s). |
| `shape` | `Narrow` (tag,ts,value per row) or `Wide` (unpivot measurement columns). |
| `map` | Column → canonical field map (`tag`,`ts`,`value`,`plant`,`quality`,`webId`). |
| `measures` | Wide only: `[{ column, tag, webId }]` — one event per measurement column. |
| `plant` / `source` | Default plant label / producer label. |

See `sources.sample.json` for SQL (narrow), Oracle (narrow, sequence watermark), and SQL
(wide/unpivot) examples.

### `appsettings.json`
Same `Fabric` / `Queue` / `Health` blocks as the PI connector (all `REPLACE-ME`), plus a
`DbForwarder` section pointing at `sources.json`. The accelerator's deploy wizard can emit a
pre-filled `appsettings.generated.json` (see the [data-plane README](../../README.md#turnkey-wiring-from-the-deploy-wizard)).

---

## Authentication & secrets

**Nothing sensitive lives in the repo.** Two layers:

1. **Fabric publish** — X.509 **client certificate** on an Entra app granted
   `Azure Event Hubs Data Sender` on the Eventstream custom endpoint (only the thumbprint is in
   config). Identical to the PI connector.
2. **Database connections** — resolved at runtime by `connectionName` from the environment
   variable **`DBFWD_CONN_<NAME>`** (name upper-cased, non-alphanumerics → `_`). For example
   `connectionName: "PLANT1_SQL"` reads `DBFWD_CONN_PLANT1_SQL`.

   Prefer **secret-free** connection strings:
   - **SQL Server** — Entra / Managed Identity:
     `Server=...;Database=...;Authentication=Active Directory Managed Identity;Encrypt=True`
     (or `Active Directory Default` / integrated auth). Avoid SQL logins.
   - **Oracle** — an **Oracle Wallet** / external auth (`/@tns_alias`) so no password is stored;
     if a password is unavoidable, keep it only in the environment variable, never in the repo.

   An inline `connectionString` field exists for first-day testing only — **do not commit a
   real value** (`sources.json`, `appsettings.generated.json`, and `*.local.json` are git-ignored).

---

## Build & run

```powershell
# from this folder
dotnet build -c Release
dotnet publish -c Release -r win-x64 --self-contained false -o .\publish

# dev run (with appsettings.json + sources.json filled, and DBFWD_CONN_* env vars set)
$env:DBFWD_CONN_PLANT1_SQL = "Server=...;Database=...;Authentication=Active Directory Managed Identity;Encrypt=True"
dotnet run -c Release
```

Install as a Windows Service the same way as the PI connector (adapt the PI connector's
`Install/` scripts — service name `DbFabricForwarder`, ProgramData folder
`C:\ProgramData\DbFabricForwarder`).

## Operations

- **Heartbeat** — `forwarder.heartbeat` flows through the same Eventstream with `queue_depth`,
  `active_channels` (here = healthy source count), and `publish_failures_total`.
- **Windows Event Log** — source `DbFabricForwarder`.
- **Watermarks** — inspect `watermark.db` (beside the queue) to see each source's cursor; delete
  a row to force a re-read from `initialWatermark`.
