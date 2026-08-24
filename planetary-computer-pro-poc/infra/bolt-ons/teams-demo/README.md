# OneGrid — Microsoft Teams demo (bolt-on)

Bring the OneGrid assistant into **Microsoft Teams**. Operators and executives can ask
about live fleet health, asset risk, anomalies, work orders and predictions from a Teams
chat — grounded entirely in your Microsoft Fabric workspace.

This is a **self-contained bolt-on**. It is not part of the main `deploy.ps1` wizard; it
runs *on top of* an already-deployed OneGrid app and simply forwards questions to it.

```
Teams  ──►  Azure Bot  ──►  Bot container (this folder)  ──►  OneGrid app /api/chat
                                                         └──►  OneGrid app /api/ask-ontology
```

## What's here

| Path | Purpose |
| --- | --- |
| `bot/` | Microsoft 365 Agents SDK bot (Node). Proxies Teams messages to the OneGrid app. |
| `bot/onegrid.js` | Thin client for the app's `/api/chat` and `/api/ask-ontology` SSE endpoints. |
| `appPackage/` | Teams app manifest + icons. |
| `deploy.ps1` | Provisions the bot identity, container, Azure Bot + Teams channel, and builds the sideloadable package. |

## How it works

- The bot uses the **Microsoft 365 Agents SDK** (`@microsoft/agents-hosting`). Teams posts
  activities to `/api/messages`; the bot forwards the user's text to the OneGrid app and
  returns the answer.
- **Two modes**, switchable in chat:
  - **/assistant** (default) — the tool-calling assistant (live KQL/DAX over Fabric).
  - **/ontology** — the published **Fabric Data Agent** (grounded in the OneGrid semantic
    model). Only offered when the OneGrid app reports it is configured (`/api/health`
    returns `dataAgent: true`).
- No data is stored in the bot; it is a stateless proxy plus a short rolling chat history
  kept in memory per conversation.

## Deploy (one command)

```powershell
# from bolt-ons/teams-demo
./deploy.ps1 -OneGridAppUrl "https://<your-onegrid-app-host>" -ResourceGroup rg-onegrid-teams
```

The script:
1. Creates an Entra app registration + secret (the bot identity).
2. Builds the bot image via ACR and deploys it as a Container App.
3. Creates an Azure Bot pointed at the container's `/api/messages` and enables the Teams channel.
4. Renders `appPackage/manifest.json` with the bot's app id and produces `appPackage.<botId>.zip`.

At the end it prints the Teams package path and sideload steps.

### Sideload into Teams

1. **Teams → Apps → Manage your apps → Upload an app → Upload a custom app.**
2. Choose the generated `appPackage.<botId>.zip`.
3. Open the app and try:
   - *"What is the overall fleet health right now?"*
   - *"Which asset is the biggest risk this week?"*
   - `/ontology` then *"How many rows are in the watchlist?"*

> Uploading custom apps must be allowed by your Teams admin
> (Teams admin center → Teams apps → Setup policies → *Upload custom apps*).

## Run locally (Bot Framework Emulator)

```powershell
cd bot
npm install
$env:ONEGRID_APP_URL = "https://<your-onegrid-app-host>"
npm start          # listens on http://localhost:3978/api/messages
```

Open the [Bot Framework Emulator](https://github.com/microsoft/BotFramework-Emulator),
connect to `http://localhost:3978/api/messages` (leave app id/password blank), and chat.

## Configuration

`bot/.env.sample` documents every setting:

| Variable | Meaning |
| --- | --- |
| `ONEGRID_APP_URL` | The deployed OneGrid app the bot forwards questions to. |
| `MicrosoftAppType` | `SingleTenant` (set by deploy). |
| `MicrosoftAppId` / `MicrosoftAppPassword` / `MicrosoftAppTenantId` | Azure Bot identity. Blank = local, no-auth mode. |
| `PORT` | Port for `/api/messages` (default `3978`). |

## Notes

- The bot calls the OneGrid app over HTTPS; the app sets permissive CORS and requires no
  key for these read-only demo endpoints.
- The Fabric Data Agent path uses the OneGrid app's identity end-to-end — the bot never
  needs Fabric credentials of its own.
- Icons in `appPackage/` are simple generated placeholders; swap in branded 192×192
  (`color.png`) and 32×32 transparent (`outline.png`) art for a polished demo.
