# PIFabricForwarder

**Stream OSIsoft/AVEVA PI System data into Microsoft Fabric in real time** — a lightweight
.NET 8 Windows Service that reads PI tag values (WebSocket channels + HTTP polling), buffers
them in a durable local SQLite queue, and publishes them to a **Fabric Eventstream Custom
Endpoint** over AMQP 1.0 with **at‑least‑once delivery** and **zero data loss**.

```
🏭 PI Web API ──(WSS channels + HTTP poll)──▶ ⚡ PIFabricForwarder ──(SQLite WAL queue)──▶ 🌊 Fabric Eventstream ──▶ 📊 Eventhouse / 🗄️ Lakehouse
```

> Full design documentation lives in the solution `Docs/` folder and in the HTML docs site
> (`Doc/site_generic/`). This README is the quick reference for building, configuring, and
> operating the service.

---

## Table of contents

- [Key capabilities](#key-capabilities)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Build](#build)
- [Configuration](#configuration)
  - [appsettings.json reference](#appsettingsjson-reference)
  - [tags.json](#tagsjson)
- [Install as a Windows Service](#install-as-a-windows-service)
- [Run interactively (dev)](#run-interactively-dev)
- [Operations & monitoring](#operations--monitoring)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Related documentation](#related-documentation)

---

## Key capabilities

- **Dual‑mode PI reads** — WebSocket channels for low‑latency push; HTTP polling as a
  fallback for tags that don't support channels (calculated tags, lab values, totalizers).
- **Durable local queue** — SQLite WAL‑mode outbox survives process crashes, host reboots,
  and multi‑day Fabric outages with no data loss.
- **At‑least‑once delivery** — Events stay queued until the broker acknowledges receipt
  (delete‑after‑ack).
- **Certificate‑based auth** — Production‑grade Microsoft Entra ID authentication using an
  X.509 certificate. **No passwords or secrets in config files.**
- **Built‑in observability** — Heartbeat events, Windows Event Log integration, in‑memory
  metrics (queue depth, publish rate, channel health).
- **Horizontal tag scaling** — Hundreds to tens of thousands of tags across independent
  channel groups.

## Architecture

The service is a single .NET 8 Worker (`Host.CreateApplicationBuilder`) running **four
concurrent background loops** coordinated through the shared SQLite queue:

| Loop | Role | Frequency | Transport |
|------|------|-----------|-----------|
| **HotPathLoop** | Opens N WebSocket channels to PI Web API (`/streamsets/channel`); up to `ChannelGroupSize` tags per channel. Push‑based. | Real‑time (event‑driven) | `wss://` WebSocket |
| **PollPathLoop** | HTTP polls `/streamsets/value` for tags configured with `mode: "Poll"`. | Every `PollIntervalSeconds` (default 5s) | `https://` REST |
| **PublisherLoop** | Drains the SQLite queue into Fabric Eventstream via the Azure Event Hubs SDK (AMQP 1.0). Batches up to `MaxBatchEvents` / `MaxBatchBytes` per send. | Continuous (`FlushIntervalMs` idle) | AMQP 1.0 (over WebSockets by default) |
| **HealthLoop** | Emits a heartbeat event with queue depth, publish rate, and channel health. | Every `HeartbeatIntervalSeconds` (default 30s) | Same AMQP path |

The **SQLite WAL queue** is the reliability core: producers (Hot/Poll loops) enqueue events
to disk *before* any publish attempt; the PublisherLoop peeks a batch, sends it, and only
deletes rows after broker acknowledgment. If the process dies mid‑flight, those events are
re‑sent on restart.

See `Docs/05-Forwarder-Design.md` and `Docs/01-Architecture-Overview.md` for the full design.

## Repository layout

```
PIFabricForwarder/
├── Program.cs                     # DI bootstrap + hosted-service registration
├── Metrics.cs                     # In-memory metrics (queue depth, publish rate, ...)
├── TagRegistry.cs                 # Loads/validates tags.json, groups by mode
├── PIFabricForwarder.csproj       # net8.0, Worker SDK, Windows Service
├── Models/                        # Options.cs, QueuedEvent.cs, PiArchiveEvent.cs, PiTagConfig.cs
├── Pi/                            # PiClient.cs, PiChannelSubscriber.cs, PiStreamSetsPoller.cs
├── Queue/                         # ISqliteQueue.cs, SqliteQueue.cs, QueuedEventBatchItem.cs
├── Publish/                       # FabricPublisher.cs (Event Hubs / AMQP + cert auth)
├── Loops/                         # HotPathLoop, PollPathLoop, PublisherLoop, HealthLoop
├── Install/                       # Install-/Uninstall-PIFabricForwarder.ps1
├── appsettings.json               # Config template — all secrets are REPLACE-ME
├── tags.sample.json               # Example tag list (copy to tags.json and fill in)
├── .gitignore
└── README.md                      # This file
```

## Prerequisites

**Build machine**
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)

**Runtime host (the PI jump host / Windows Server)**
- Windows Server 2019+ (or Windows 10/11 for dev), x64.
- .NET 8 Runtime (or publish self‑contained — see [Build](#build)).
- Network line‑of‑sight to **PI Web API** (HTTPS, typically 443) and outbound **443** to
  Fabric (`*.servicebus.fabric.microsoft.com`).
- Runs as **`NT AUTHORITY\NetworkService`** (uses the computer account for Kerberos to PI).

**Microsoft Fabric**
- An **Eventstream** with a **Custom Endpoint** source, routed to an Eventhouse and/or
  Lakehouse destination.
- A Microsoft **Entra app registration** with a **client certificate**, granted
  `Azure Event Hubs Data Sender` on the Eventstream namespace. Install the certificate into
  `LocalMachine\My` on the host.

**PI System**
- PI Web API reachable, with Kerberos auth enabled for the host computer account.
- The webIds for the tags you want to forward (resolve via
  `GET /dataservers/{id}/points`) — see [tags.json](#tagsjson).

## Build

From this folder:

```powershell
# Restore + build
dotnet build -c Release

# Publish framework-dependent (requires .NET 8 Runtime on the host)
dotnet publish -c Release -r win-x64 --self-contained false -o .\publish

# …or publish self-contained (no runtime needed on the host)
dotnet publish -c Release -r win-x64 --self-contained true -o .\publish
```

The publish output folder is what you hand to `Install-PIFabricForwarder.ps1`.

## Configuration

Configuration is layered (standard .NET): `appsettings.json` → environment variables →
[.NET user‑secrets] (dev only). **No secrets are stored in the repo** — the committed
`appsettings.json` ships with `REPLACE-ME` placeholders that you fill in per environment
(or override via env vars / user‑secrets). Environment‑specific overrides
(`appsettings.Production.json`, `appsettings.*.local.json`) and the real `tags.json` are
git‑ignored.

### appsettings.json reference

| Section / key | Example / placeholder | Description |
|---|---|---|
| `PiWebApi.BaseUrl` | `https://REPLACE-ME-pi-web-api-host/piwebapi` | PI Web API base URL |
| `PiWebApi.DataServer` | `REPLACE-ME` | PI Data Server name |
| `PiWebApi.PollIntervalSeconds` | `5` | Poll cadence for `Poll`‑mode tags |
| `PiWebApi.ChannelGroupSize` | `250` | Max webIds per WebSocket channel |
| `PiWebApi.RequestTimeoutSeconds` | `60` | HTTP request timeout |
| `PiWebApi.MaxConcurrentChannels` | `8` | Upper bound on concurrent channels |
| `Fabric.FabricNamespaceFqdn` | `REPLACE-ME.servicebus.fabric.microsoft.com` | Eventstream custom‑endpoint namespace FQDN |
| `Fabric.StreamName` | `pi-events-stream` | Target stream / entity path |
| `Fabric.TenantId` | `REPLACE-ME` | Entra tenant ID |
| `Fabric.ClientId` | `REPLACE-ME` | Entra app (client) ID |
| `Fabric.CertThumbprint` | `REPLACE-ME` | Thumbprint of the client cert in `LocalMachine\My` |
| `Fabric.ConnectionString` | `null` | Optional; overrides cert auth if set (dev/testing only — **do not commit a real value**) |
| `Fabric.MaxBatchEvents` | `1000` | Max events per AMQP send |
| `Fabric.MaxBatchBytes` | `262144` | Max bytes per AMQP send (256 KB) |
| `Fabric.FlushIntervalMs` | `50` | Idle delay between drain cycles |
| `Fabric.UseAmqpWebSockets` | `true` | AMQP over WebSockets (443) vs. TCP (5671) |
| `Queue.Path` | `C:\ProgramData\PIFabricForwarder\queue.db` | SQLite queue file |
| `Queue.MaxSizeMB` | `20480` | Soft cap for the queue database |
| `Queue.BackpressureWarnDepth` | `50000` | Warn when queue depth exceeds this |
| `Queue.BackpressureStopDepth` | `500000` | Stop enqueue when depth exceeds this |
| `Tags.ConfigPath` | `C:\ProgramData\PIFabricForwarder\tags.json` | Path to the tag list |
| `Health.HeartbeatIntervalSeconds` | `30` | Heartbeat cadence |
| `Logging.*` | — | Standard .NET logging + Windows Event Log source |

> **Certificate auth is the recommended, secret‑free path.** Prefer leaving
> `Fabric.ConnectionString` as `null` and authenticating with `TenantId` + `ClientId` +
> `CertThumbprint`. If you must use a connection string for a quick test, supply it via an
> environment variable (`Fabric__ConnectionString`) or user‑secrets — never commit it.

### tags.json

The forwarder reads its tag list from `Tags.ConfigPath` (default
`C:\ProgramData\PIFabricForwarder\tags.json`). Copy `tags.sample.json`, fill in real tag
names and webIds, and deploy it to that path (the install script seeds it for you if absent).

```json
[
  { "tag": "PLANT1:EXAMPLE_TAG_01.PV",    "webId": "F1DP...", "plant": "PLANT1", "mode": "Channel" },
  { "tag": "PLANT1:EXAMPLE_TAG_02.PV",    "webId": "F1DP...", "plant": "PLANT1", "mode": "Poll"    },
  { "tag": "PLANT1:EXAMPLE_LAB_VALUE.AG", "webId": "F1DP...", "plant": "PLANT1", "mode": "Skip"    }
]
```

| Field | Description |
|---|---|
| `tag` | Human‑readable PI point name |
| `webId` | PI Web API webId (resolve via `GET /dataservers/{id}/points`) |
| `plant` | Plant / asset‑group label carried through to the event payload |
| `mode` | `Channel` (push, low latency), `Poll` (HTTP fallback), or `Skip` (exclude) |

## Install as a Windows Service

Run from an **elevated** PowerShell prompt on the host, pointing at your publish output:

```powershell
.\Install\Install-PIFabricForwarder.ps1 -PublishDir .\publish
```

The script copies binaries to `C:\Program Files\PIFabricForwarder`, creates
`C:\ProgramData\PIFabricForwarder` (queue, `tags.json`, logs), grants `NetworkService`
modify rights, registers the service via `sc.exe` under `NT AUTHORITY\NetworkService` with
auto‑start + restart‑on‑failure, and starts it.

Before it will publish successfully, edit `appsettings.json` in the install directory with
your Fabric namespace, tenant/client IDs, and certificate thumbprint, and populate
`C:\ProgramData\PIFabricForwarder\tags.json`.

To remove:

```powershell
.\Install\Uninstall-PIFabricForwarder.ps1
```

## Run interactively (dev)

```powershell
# From the project folder, with appsettings.json + a local tags.json filled in:
dotnet run -c Release
```

When not launched by the Service Control Manager the host runs as a console app, logging to
stdout — handy for debugging channel/auth issues.

## Operations & monitoring

- **Heartbeat** — every `HeartbeatIntervalSeconds`, a `forwarder.heartbeat` event flows
  through the same Eventstream with `queue_depth`, `queue_bytes`, `active_channels`,
  `publish_rate_per_sec`, and `publish_failures_total`. Alert in Fabric if it goes silent.
- **Windows Event Log** — errors/warnings are written under source `PIFabricForwarder`:
  ```powershell
  Get-WinEvent -LogName Application -ProviderName 'PIFabricForwarder' -MaxEvents 20
  ```
- **Service state**
  ```powershell
  Get-Service PIFabricForwarder
  Get-Content 'C:\ProgramData\PIFabricForwarder\logs\*.log' -Tail 50
  ```
- **Queue depth** — a growing `queue.db` / heartbeat `queue_depth` indicates Fabric‑side
  backpressure or an auth/connectivity problem on the publish path.

See `Docs/09-Operational-Runbook.md` for full monitor/recover/rotate procedures.

## Security

- **PI:** Kerberos using the host **computer account** (service runs as `NetworkService`).
  No PI password is stored.
- **Fabric:** X.509 **client‑certificate** auth to an Entra app registration. The cert lives
  in the Windows cert store (`LocalMachine\My`); only its **thumbprint** is referenced in
  config.
- **No secrets in the repo.** `appsettings.json` contains only `REPLACE-ME` placeholders;
  real values are supplied per environment (config file on the host, environment variables,
  or user‑secrets) and are git‑ignored. Rotate the client certificate per
  `Docs/04-Service-Identity-and-Auth.md`.

## Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| `Certificate with thumbprint '…' not found` at startup | Cert missing from `LocalMachine\My` or wrong thumbprint | Import the cert; verify `Fabric.CertThumbprint` |
| Publish fails, queue grows | Expired cert, wrong `FabricNamespaceFqdn`, missing `Data Sender` role, or Fabric capacity paused | Check Event Log; validate Entra role assignment and namespace; resume capacity |
| No channel data, only polls | PI Web API blocks channels, or tag point type unsupported | Set those tags to `mode: "Poll"` |
| Repeated reconnects on `wss://` | Kerberos/SPN or proxy issue to PI Web API | Verify computer‑account SPN and firewall/proxy for 443 |
| Service won't start after reboot | `appsettings.json`/`tags.json` still contain `REPLACE-ME` | Fill in real config on the host |

## Related documentation

- **Design docs (solution `Docs/`):** `00-README.md` (index), `01-Architecture-Overview.md`,
  `03-Transport-AMQP-to-Eventstream.md`, `04-Service-Identity-and-Auth.md`,
  `05-Forwarder-Design.md`, `06-PI-Read-Strategy.md`, `07-Fabric-Landing.md`,
  `09-Operational-Runbook.md`.
- **HTML docs site:** `Doc/site_generic/` (architecture, installation, configuration,
  sizing, operations, security).
- **Fabric‑side deployment:** `Deploy/Fabric/` (Eventstream/Eventhouse KQL + deploy scripts).
