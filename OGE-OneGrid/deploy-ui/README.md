# Deploy Wizard (`deploy-ui`)

A tiny **localhost web wizard** that provisions the entire accelerator into your tenant and
streams live progress — a friendly front end over [`../deploy.ps1`](../deploy.ps1).

## Run it

```powershell
node deploy-ui/server.js       # or: ./deploy-ui/launch.ps1  (also opens the browser)
# then open http://localhost:7333
```

## The flow

1. **Azure sign-in** — confirms `az login` (offers a sign-in button if needed).
2. **Choose your targets** — subscription, Fabric capacity, region, workspace name, web-app
   hosting, resource-group / base names, default model, and synthetic-site count. Resource
   names (resource group, workspace, Foundry / app base) are **auto-uniquified per deploy**
   so runs never collide with a prior deployment or a soft-deleted resource.
3. **Prerequisite checks** — validates the Azure CLI + sign-in, PowerShell, the `containerapp`
   extension, Fabric API access, the `Microsoft.CognitiveServices` provider, and that the
   Git LFS **data bundle is materialized** (not pointer stubs). Deploy unlocks only when every
   check passes.
4. **Deploy** — runs `deploy.ps1` with a live phase tracker and a streaming log console.
5. **Launch** — on success, a prominent **🖥️ Launch Web App** button plus links for the Power
   BI report, the real-time dashboard, and a one-click **Launch Demo** (backfill + stream live
   data for all sites).

It also has a **Tear down** picker to remove a previous deployment's workspace + resource
groups (your Fabric capacity is left untouched).

## Files

```
deploy-ui/
├── server.js     small Node HTTP server: discovery, prereq checks, config write, run/stream, teardown
├── index.html    the wizard UI (single page)
└── launch.ps1    convenience launcher (starts the server + opens the browser)
```

The server writes your choices to `../config.json` (git-ignored) and spawns
`powershell ../deploy.ps1 -ConfigPath ../config.json`, relaying its output to the browser over
Server-Sent Events. Nothing leaves your machine except the Azure/Fabric API calls the deploy
itself makes.
