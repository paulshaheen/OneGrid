"""Deployment: what the baseline template creates and where it lives.

Drawn like the Azure Virtual Desktop landing zone accelerator's baseline: the customer
subscription is a filled box with its governance strip, Microsoft-managed services sit
outside it, and a dashed red scale unit marks what you repeat per environment or region.
Every Azure resource comes from planetary-computer-pro-poc/deploy/azure/main.bicep; the
Fabric items and Entra apps come from the provisioner (deploy.ps1) that its deployment
scripts run. Dashed outlines are components the portal's default selection leaves off.

Layout: one column grid for the resource group. Six columns on the left (pitch P) and two
on the right (LC, RC) under the web app; a group never shares a column boundary with its
neighbour, so neighbouring groups skip a column. Arrows from the web app run down into the
icon tops of their targets through one channel under the first row."""

from diagram_engine import Sheet

LABEL = "Deployment"
SUMMARY = ("What main.bicep deploys into one resource group, what its provisioner creates in the "
           "Fabric workspace, and the stamp you repeat per environment or region")

P, NW = 144, 122                                  # node pitch and width inside a group
COL = [170 + i * P for i in range(6)]             # left block columns 1-6
LC, RC = 1086, 1230                               # right block columns (web app above, Foundry below)
GAP = 16                                          # between stacked rows
S1, S1H = 420, 150                                # row 1 is taller for two-line names
S2 = 630                                          # after the channel under row 1
S3 = S2 + 136 + GAP
S4 = S3 + 136 + GAP
TOP = 40                                          # icon top inside a group
TRACK_B, TRACK_A = 590, 610                       # channel tracks under row 1


def group(s, id, first, n, y, title, h=136, cols=COL):
    """A function group over n grid columns starting at index first."""
    cx = cols[first:first + n]
    s.boundary(id, cx[0] - P / 2 - 8, y, n * P + 16, h, title)
    return cx


def build():
    s = Sheet(
        "onegrid-reference-deployment",
        "OneGrid · deployment",
        "OneGrid deployment architecture",
        "What the baseline template deploys into one resource group, what its provisioner creates in "
        "Microsoft Fabric and Entra ID, and the stamp you repeat per environment or region.",
        width=1800, height=1300, style="learn",
    )
    s.footnote = ("Dashed outlines are off in the portal's default selection and deploy only when enabled. "
                  "The icon strip is governance inherited from the platform landing zone.")

    # ----- Top band: deployment source and Microsoft Entra ID ------------------------------
    s.zone("source", 40, 100, 700, 136, "Deployment source (GitHub)")
    for id, cx, name, caption in (("package", 160, "App package", "GitHub release zip"),
                                  ("provisioner", 390, "Provisioner", "deploy.ps1 and content"),
                                  ("template", 620, "Bicep template", "main.bicep as ARM JSON")):
        s.node(id, cx, 142, name, caption, "glyph:document", w=170)
    s.zone("entra", 780, 100, 980, 136, "Microsoft Entra ID", icon="entra-id")
    for id, cx, name, caption, icon, optional in (
        ("deployer", RC - 360, "Deployer", "workspace admin", "users", False),
        ("graph", RC - 180, "Graph permission", "if Graph grant on", "entra-id", True),
        ("users", RC, "OneGrid users", "browser sign-in", "users", False),
        ("signin", RC + 180, "Sign-in app", "if Graph grant on", "entra-id", True),
        ("refresh", RC + 360, "Refresh principal", "if Graph grant on", "entra-id", True),
    ):
        s.node(id, cx, 142, name, caption, icon, w=150, optional=optional)

    # ----- Containers ---------------------------------------------------------------------------
    rg_bottom = S4 + 136 + 86
    s.subscription("sub", 40, 272, 1304, rg_bottom + 100 - 272, "OneGrid workload subscription",
                   note="workload landing zone")
    s.zone("fabric", 1380, 272, 380, rg_bottom + 100 - 272, "Microsoft Fabric (Microsoft-managed)",
           icon="fabric")
    s.boundary("stamp", 56, 326, 1688, rg_bottom + 16 - 326, "OneGrid stamp",
               note="repeat per environment or region", accent=True)
    s.boundary("rg", 74, 370, 1252, rg_bottom - 370, "Resource group", note="you choose the name",
               icon="resource-group")
    s.boundary("ws", 1398, 370, 332, rg_bottom - 370, "OneGrid workspace", note="by the provisioner",
               icon="fabric")

    # ----- Row 1: weather | web ---------------------------------------------------------------
    y = S1 + TOP
    wx = group(s, "g-weather", 0, 6, S1, "Weather", h=S1H)
    for cx, id, name, caption, icon in (
        (wx[0], "acr", "Container Registry", "if forecast job", "container-registry"),
        (wx[1], "cae", ["Container Apps", "environment"], "if forecast job", "container-apps-env"),
        (wx[2], "job", "Container Apps job", "if forecast job", "container-apps-job"),
        (wx[3], "aml", ["Azure ML", "workspace"], "if Aurora enabled", "machine-learning"),
        (wx[4], "endpoint", "Online endpoint", "if Aurora enabled", "machine-learning"),
        (wx[5], "aurora", "Aurora deployment", "if model asset set", "machine-learning"),
    ):
        s.node(id, cx, y, name, caption, icon, w=NW, optional=True)
    group(s, "g-web", 0, 2, S1, "Web", h=S1H, cols=[LC, RC])
    s.node("plan", LC, y, "App Service plan", "Linux, B1 default", "app-service", w=NW)
    s.node("web", RC, y, "OneGrid web app", "App Service", "app-service", w=NW)

    # ----- Row 2: security | sample storage (rows 2-3) | AI -------------------------------------
    y = S2 + TOP
    sx = group(s, "g-security", 0, 3, S2, "Security")
    s.node("kv", sx[0], y, "Key Vault", "if Aurora enabled", "key-vault", w=NW, optional=True)
    s.node("job-id", sx[1], y, "Aurora job identity", "if forecast job", "managed-identity", w=NW, optional=True)
    s.node("fabric-id", sx[2], y, "Fabric-plane identity", "runs the provisioner", "managed-identity", w=NW + 8)
    st = group(s, "sample", 4, 2, S2, "Sample storage", h=2 * 136 + GAP)
    for id, cx, top, name, caption, optional in (
        ("c-sample", st[0], S2 + TOP, "sample-assets", "imagery and uploads", False),
        ("c-package", st[1], S2 + TOP, "onegrid-app-package", "private app package", False),
        ("c-outputs", st[0], S3 + TOP, "model-outputs", "forecast outputs", False),
        ("c-channel", st[1], S3 + TOP, "aurora-channel", "if forecast job", True),
    ):
        s.node(id, cx, top, name, caption, "blob-storage", w=NW + 8, optional=optional)
    group(s, "g-ai", 0, 2, S2, "AI", cols=[LC, RC])
    s.node("model", LC, y, "Model deployment", "gpt-5-mini", "ai-foundry", w=NW)
    s.node("foundry", RC, y, "Microsoft Foundry", "language models", "ai-foundry", w=NW)

    # ----- Row 3: geospatial | (sample storage) | data ------------------------------------------------
    y = S3 + TOP
    gx = group(s, "g-geo", 0, 2, S3, "Geospatial")
    s.node("ingest", gx[0], y, "Ingestion identity", "reads sample storage", "managed-identity", w=NW)
    s.node("geocatalog", gx[1], y, "GeoCatalog", "Planetary Computer Pro", "geocatalog", w=NW + 8)
    group(s, "g-data", 0, 2, S3, "Data", cols=[LC, RC])
    s.node("script-st", LC, y, "Script storage", "if policy exempt", "blob-storage", w=NW, optional=True)
    s.node("ml-st", RC, y, "ML storage", "if Aurora enabled", "blob-storage", w=NW, optional=True)

    # ----- Row 4: deployment | monitoring | capacity ------------------------------------------------
    y = S4 + TOP
    dx = group(s, "g-deploy", 0, 3, S4, "Deployment")
    s.node("build", dx[0], y, "Image build script", "if forecast job", "glyph:document", w=NW, optional=True)
    s.node("app-script", dx[1], y, "App-plane script", "app wiring", "glyph:document", w=NW)
    s.node("fabric-script", dx[2], y, "Fabric-plane script", "Fabric items", "glyph:document", w=NW)
    mx = group(s, "g-monitor", 4, 2, S4, "Monitoring")
    s.node("logs", mx[0], y, "Log Analytics", "if forecast job", "log-analytics", w=NW, optional=True)
    s.node("appi", mx[1], y, "Application Insights", "if Aurora enabled", "application-insights",
           w=NW + 8, optional=True)
    group(s, "g-capacity", 1, 1, S4, "Capacity", cols=[LC, RC])
    s.node("capacity", RC, y, "Fabric capacity", "if capacity created", "fabric", w=NW, optional=True)

    # ----- Microsoft Fabric workspace items --------------------------------------------------------
    fx = (1488, 1636)
    for i, (id, name, caption, icon, optional) in enumerate((
        ("lakehouse", "Lakehouse", "lh_poc", "lakehouse", False),
        ("eventhouse", "Eventhouse", "pi-realtime-eventhouse", "event-house", False),
        ("notebooks", "Notebooks", "source prep to scoring", "notebook", False),
        ("kqldb", "KQL database", "pi-realtime-db", "kql-database", False),
        ("pipeline", "Pipeline", "Prediction_Pipeline", "pipeline", False),
        ("semantic", "Semantic model", "OneGridModelImport", "semantic-model", False),
        ("ontology", "Ontology", "OneGridOntology", "ontology", False),
        ("agent", "Data agent", "OneGridOntologyAgent", "data-agent", False),
        ("shortcut", "OneLake shortcut", "if connection set", "one-lake", True),
    )):
        s.node(id, fx[i % 2], 506 + (i // 2) * 124, name, caption, icon, w=148, optional=optional)
    s.bar("onelake", 1398, rg_bottom + 42, 332, 36, "OneLake", icon="one-lake")

    # ----- Governance strip on the subscription ------------------------------------------------------
    s.strip("gov", 392, rg_bottom + 38, [
        ("Cost Management", "cost-management"), ("Azure Policy", "policy"),
        ("Defender for Cloud", "defender-for-cloud"), ("Azure Monitor", "monitor"),
        ("Network Watcher", "network-watcher"), ("Role assignments", "managed-identity"),
    ], gap=120)

    # ----- Flows ---------------------------------------------------------------------------------------
    s.flow("deploy", "template", "rg", [s.port("template", "b"), (620, 370)], "request",
           label="ARM deployment", at=(646, 258), anchor="start")
    s.flow("browse", "users", "web", [s.port("users", "b"), s.port("web", "t")], "request")
    s.flow("signin-app", "users", "signin", sides=("r", "l"), kind="identity")
    s.flow("query", "web", "ws", [s.port("web", "r"), (1398, S1 + TOP + 22)], "request")
    s.flow("chat", "web", "foundry", [s.port("web", "b"), s.port("foundry", "t")], "request")
    s.flow("app-storage", "web", "c-package",
           [s.port("web", "b", -30), (RC - 30, TRACK_A), (st[1], TRACK_A), s.port("c-package", "t")], "request")
    s.flow("catalog", "web", "geocatalog",
           [s.port("web", "b", -50), (RC - 50, TRACK_B), (COL[3], TRACK_B), (COL[3], S3 + TOP + 22),
            s.port("geocatalog", "r")], "request")
    s.flow("ingest-id", "ingest", "geocatalog", sides=("r", "l"), kind="identity")
    s.flow("provision", "fabric-script", "ws",
           [s.port("fabric-script", "r"), (COL[3], S4 + TOP + 22), (COL[3], rg_bottom - 24), (1398, rg_bottom - 24)],
           "request", label="creates workspace items", at=(900, rg_bottom - 30))
    s.flow("hosts", "capacity", "ws", [s.port("capacity", "b"), (RC, rg_bottom - 46), (1398, rg_bottom - 46)],
           "control", label="hosts", at=(1290, rg_bottom - 52))

    # ----- Deployment sequence (numbers match the report list) -----------------------------------------
    s.step(1, 620, 254)
    s.step(2, 988, TRACK_A)
    s.step(3, COL[3], S4 + 90)
    s.step(4, 1362, S1 + TOP + 22)
    s.step(5, RC, 299)
    return s
