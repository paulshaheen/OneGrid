"""Baseline: the logical view, drawn in Azure Architecture Center style.

Icons with short names, grouped into stages (data sources, ingest, store, process, serve)
inside the Microsoft Fabric and Azure zones, and an application zone that opens up the web
app (UI, API, AI agent) and its AI services. Numbered markers match the Workflow list in the
README; dashed outlines are optional add-ons. Ports, roles and networking are on the other
sheets."""

from diagram_engine import Sheet

LABEL = "Logical view"
SUMMARY = ("Logical view: sources, ingest, store, process and serve in Fabric and Azure, "
           "ending in the web app, its AI agent and optional channels")

SRC, ING, STO, PRO, SRV = 140, 335, 545, 820, 1120
UI, API = 1560, 1690
A, B, B2, C, D = 272, 400, 512, 776, 910   # icon tops per row
MID = {r: r + 22 for r in (A, B, B2, C, D)}


def build():
    s = Sheet(
        "onegrid-reference-baseline",
        "OneGrid · logical view",
        "OneGrid logical architecture",
        "Operational, business, weather and geospatial data flow through Microsoft Fabric and Azure "
        "into one asset-intelligence web app and its AI agent.",
        width=1800, height=1190, style="learn",
    )
    s.footnote = ("Numbered steps match the Workflow list in the README. Dashed outlines are optional add-ons. "
                  "Ports, roles and networking are on the detailed sheets.")

    s.header(ING, 218, "Ingest")
    s.header(1545, 218, "Experience")

    # Containers
    s.stage("sources", 40, 230, 200, 790, "Data sources")
    s.zone("fabric", 410, 150, 880, 500, "Microsoft Fabric", icon="fabric")
    s.stage("f-store", 430, 230, 230, 376, "Store")
    s.stage("f-process", 700, 230, 240, 376, "Process")
    s.stage("f-serve", 980, 230, 280, 376, "Serve")
    s.bar("onelake", 430, 614, 830, 26, "OneLake", icon="one-lake")
    s.zone("azure", 410, 690, 880, 340, "Azure · weather and geospatial", icon="resource-group")
    s.stage("a-store", 430, 740, 230, 270)
    s.stage("a-process", 700, 740, 240, 270)
    s.stage("a-serve", 980, 740, 280, 270)
    s.zone("azure-app", 1320, 380, 460, 650, "Application and AI", icon="app-service")
    s.boundary("webapp", 1340, 430, 420, 300, "OneGrid web app", "App Service")

    # Data sources
    s.node("historian", SRC, A, "Historian and SCADA", "live via forwarder add-on", "glyph:gauge", w=180)
    s.node("business", SRC, B, "Asset and work systems", "AIMM · iCare · GADS · CMMS", "glyph:database", w=180)
    s.node("noaa", 92, C, ["NOAA GFS", "and NHC"], None, "glyph:globe", w=96)
    s.node("hf", 190, C, "Hugging Face", "static fields", "glyph:database", w=96)
    s.node("imagery", SRC, D, "Customer imagery", "COG and STAC", "glyph:document", w=180)

    # Ingest tools sit on the arrows
    s.node("eventstream", ING, MID[A] - 59, "Eventstream", None, "eventstream", w=120, size=32, optional=True)
    s.node("job", ING, MID[C] - 59, "Forecast job", None, "container-apps-job", w=120, size=32)

    # Microsoft Fabric
    s.node("eventhouse", STO, A, "Eventhouse", "KQL database", "event-house", w=140)
    s.node("policy", PRO, A, "Update policy", "events and outages", "kql-database", w=160)
    s.node("kql", SRV, A, "KQL queries", "spatial functions", "kql-queryset", w=160)
    s.node("lakehouse", STO, B, "Lakehouse", "conformed asset model", "lakehouse", w=140)
    s.node("notebooks", PRO, B, "Notebooks", "risk scoring", "notebook", w=160)
    s.node("semantic", SRV, B, "Semantic model", "Import mode", "semantic-model", w=160)
    s.node("ontology", PRO, B2, "Ontology", "Digital Twin Builder", "ontology", w=160)
    s.node("agent-fabric", SRV, B2, "Data agent", "grounded Q&A", "data-agent", w=160, optional=True)

    # Azure: weather and geospatial
    s.node("channel", STO, C, "Blob storage", "model exchange", "blob-storage", w=140)
    s.node("aurora", PRO, C, "Aurora", "Azure Machine Learning", "machine-learning", w=170)
    s.node("events", SRV, C, "Weather events", "published forecast", "blob-storage", w=160)
    s.node("landing", STO, D, "Blob storage", "imagery landing", "blob-storage", w=140)
    s.node("geocatalog", PRO, D, "GeoCatalog", "Planetary Computer Pro", "geocatalog", w=170)
    s.node("stac", SRV, D, "STAC and tiles", "search and render", "geocatalog", w=160)

    # Experience: people and channels
    s.node("basemap", 1420, A, "Map tiles", "Azure Maps, Esri", "azure-maps", w=100)
    s.node("users", UI, A, "OneGrid users", "browser", "users", w=100)
    s.node("teams", API, A, "Teams", "via Azure Bot", "bot-service", w=120, optional=True)
    # Application and AI
    s.node("webui", UI, 490, "Web UI", "React SSR", "glyph:window", w=110)
    s.node("api", API, 490, "API and BFF", "REST, WebSocket", "glyph:api", w=120)
    s.node("agent", API, 610, "AI agent", "tool calls", "glyph:chat", w=120)
    s.node("openai", UI, 820, "Microsoft Foundry", "language models", "ai-foundry", w=130)
    s.node("search", 1700, 820, "AI Search", "manuals knowledge", "ai-search", w=140, optional=True)

    # Platform row
    s.bar("platform", 40, 1060, 1740, 82, "Platform", align="left")
    for cx, name, icon in (
        (290, "Microsoft Entra ID", "entra-id"), (510, "Managed identities", "managed-identity"),
        (730, "Key Vault", "key-vault"), (950, "Container Registry", "container-registry"),
        (1170, "Log Analytics", "log-analytics"), (1390, "Application Insights", "application-insights"),
        (1610, "Bicep and ARM", "resource-group"),
    ):
        s.node("p-" + icon, cx, 1074, name, None, icon, w=160, size=32)

    # Flows: grid operations
    s.flow("f1", "sources", "eventhouse", [(240, MID[A]), s.port("eventhouse", "l")])
    s.flow("f2", "eventhouse", "policy", sides=("r", "l"))
    s.flow("f3", "policy", "kql", sides=("r", "l"))
    # asset reliability
    s.flow("f4", "sources", "lakehouse", [(240, MID[B]), s.port("lakehouse", "l")], label="Load", at=(ING, MID[B] - 8))
    s.flow("f5", "lakehouse", "notebooks", sides=("r", "l"), both=True)
    s.flow("f6", "lakehouse", "semantic", [s.port("lakehouse", "t"), (STO, 372), (SRV - 10, 372), s.port("semantic", "t", -10)])
    s.flow("f7", "agent-fabric", "semantic", [s.port("agent-fabric", "t"), s.port("semantic", "b")])
    s.flow("f8", "lakehouse", "ontology", [s.port("lakehouse", "b"), (STO, MID[B2]), s.port("ontology", "l")], "control")
    # weather forecast
    s.flow("w1", "sources", "channel", [(240, MID[C]), s.port("channel", "l")])
    s.flow("w2", "channel", "aurora", sides=("r", "l"), both=True)
    s.flow("w3", "aurora", "events", sides=("r", "l"))
    # geospatial context
    s.flow("g1", "sources", "landing", [(240, MID[D]), s.port("landing", "l")], label="Upload", at=(ING, MID[D] - 8))
    s.flow("g2", "landing", "geocatalog", sides=("r", "l"))
    s.flow("g3", "geocatalog", "stac", sides=("r", "l"))
    # serving into the app, and the app starting forecast runs
    s.flow("e1", "f-serve", "webapp", [(1260, MID[B]), (1300, MID[B]), (1300, 540), (1340, 540)])
    s.flow("e2", "a-serve", "webapp", [(1260, 865), (1360, 865), (1360, 730)])
    s.flow("e6", "webapp", "job", [(1340, 670), (ING, 670), s.port("job", "t")], "control",
           label="Start run", at=(870, 665))
    # experience
    s.flow("e3", "users", "webui", [s.port("users", "b"), s.port("webui", "t")], "request")
    s.flow("e4", "basemap", "users", sides=("r", "l"))
    s.flow("e7", "webui", "api", sides=("r", "l"), kind="request")
    s.flow("e8", "teams", "api", [s.port("teams", "b"), s.port("api", "t")], "request", dashed=True)
    s.flow("e9", "api", "agent", [s.port("api", "b"), s.port("agent", "t")], "request")
    s.flow("e5", "agent", "openai", [(API - 10, 690), (API - 10, 760), (UI, 760), s.port("openai", "t")], "request")
    s.flow("e10", "agent", "search", [(API + 10, 690), s.port("search", "t")], "request", dashed=True)

    # Numbered workflow (README "Workflow" steps 1-8)
    s.step(1, 240, 230)
    s.step(2, 448, MID[A])
    s.step(3, 682, MID[B])
    s.step(4, 682, MID[B2])
    s.step(5, 1280, MID[B])
    s.step(6, 448, MID[D])
    s.step(7, 448, MID[C])
    s.step(8, UI, 410)
    return s
