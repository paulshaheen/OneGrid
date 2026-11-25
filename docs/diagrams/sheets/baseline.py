"""Baseline: the logical view, drawn in Azure Architecture Center style.

Icons with short names, grouped into stages (data sources, ingest, store, process,
serve, experience) inside the Microsoft Fabric and Azure zones. Numbered markers match
the Workflow list in the README. Ports, roles and networking are on the other sheets."""

from diagram_engine import Sheet

LABEL = "Baseline"
SUMMARY = "Logical view: sources, ingest, store, process and serve in Fabric and Azure, ending in one web app"

SRC, ING, STO, PRO, SRV, EXP = 140, 335, 545, 820, 1110, 1420
A, B, B2, C, D = 272, 400, 512, 756, 890   # icon tops per row
MID = {r: r + 22 for r in (A, B, B2, C, D)}


def build():
    s = Sheet(
        "onegrid-reference-baseline",
        "OneGrid · baseline",
        "OneGrid logical architecture",
        "Operational, business, weather and geospatial data flow through Microsoft Fabric and Azure "
        "into one asset-intelligence web app.",
        width=1600, height=1170, style="learn",
    )
    s.footnote = ("Numbered steps match the Workflow list in the README. Dashed lines are optional or binding "
                  "paths. Ports, roles and networking are on the detailed sheets.")

    # Stage headers that sit outside a stage box
    s.header(ING, 218, "Ingest")
    s.header(EXP, 218, "Experience")

    # Containers
    s.stage("sources", 40, 230, 200, 780, "Data sources")
    s.zone("fabric", 410, 150, 850, 506, "Microsoft Fabric", icon="fabric")
    s.stage("f-store", 430, 230, 230, 376, "Store")
    s.stage("f-process", 700, 230, 240, 376, "Process")
    s.stage("f-serve", 980, 230, 260, 376, "Serve")
    s.bar("onelake", 430, 616, 810, 28, "OneLake", icon="one-lake")
    s.zone("azure", 410, 680, 1170, 340, "Azure", icon="resource-group")
    s.stage("a-store", 430, 730, 230, 270)
    s.stage("a-process", 700, 730, 240, 270)
    s.stage("a-serve", 980, 730, 260, 270)

    # Data sources
    s.node("historian", SRC, A, "Historian and SCADA", "operational telemetry", "glyph:gauge", w=180)
    s.node("business", SRC, B, "Asset and work systems", "AIMM · iCare · GADS · CMMS", "glyph:database", w=180)
    s.node("noaa", 92, C, ["NOAA GFS", "and NHC"], None, "glyph:globe", w=96)
    s.node("hf", 190, C, "Hugging Face", "static fields", "glyph:database", w=96)
    s.node("imagery", SRC, D, "Customer imagery", "COG and STAC", "glyph:document", w=180)

    # Ingest tools sit on the arrows
    s.node("eventstream", ING, MID[A] - 59, "Eventstream", None, "eventstream", w=120, size=32)
    s.node("job", ING, MID[C] - 59, "Forecast job", None, "container-apps-job", w=120, size=32)

    # Microsoft Fabric
    s.node("eventhouse", STO, A, "Eventhouse", "KQL database", "event-house", w=140)
    s.node("policy", PRO, A, "Update policy", "events and outages", "kql-database", w=160)
    s.node("kql", SRV, A, "KQL queries", "spatial functions", "kql-queryset", w=160)
    s.node("lakehouse", STO, B, "Lakehouse", "conformed asset model", "lakehouse", w=140)
    s.node("notebooks", PRO, B, "Notebooks", "risk scoring", "notebook", w=160)
    s.node("semantic", SRV, B, "Semantic model", "Import mode", "semantic-model", w=160)
    s.node("ontology", PRO, B2, "Ontology", "Digital Twin Builder", "ontology", w=160)
    s.node("agent", SRV, B2, "Data agent", "optional", "data-agent", w=160)

    # Azure
    s.node("channel", STO, C, "Blob storage", "model exchange", "blob-storage", w=140)
    s.node("aurora", PRO, C, "Aurora", "Azure Machine Learning", "machine-learning", w=170)
    s.node("events", SRV, C, "Weather events", "published forecast", "blob-storage", w=160)
    s.node("landing", STO, D, "Blob storage", "imagery landing", "blob-storage", w=140)
    s.node("geocatalog", PRO, D, "GeoCatalog", "Planetary Computer Pro", "geocatalog", w=170)
    s.node("stac", SRV, D, "STAC and tiles", "search and render", "geocatalog", w=160)

    # Experience
    s.node("users", EXP, A, "OneGrid users", "browser", "users", w=100)
    s.node("basemap", 1535, A, "Map tiles", "Azure Maps, Esri", "azure-maps", w=100)
    s.node("app", EXP, C, "OneGrid web app", "App Service", "app-service", w=140)
    s.node("openai", EXP, 880, "Azure OpenAI", "language model", "azure-openai", w=140)

    # Platform row
    s.bar("platform", 40, 1044, 1540, 82, "Platform", align="left")
    for cx, name, icon in (
        (270, "Microsoft Entra ID", "entra-id"), (465, "Managed identities", "managed-identity"),
        (660, "Key Vault", "key-vault"), (855, "Container Registry", "container-registry"),
        (1050, "Log Analytics", "log-analytics"), (1245, "Application Insights", "application-insights"),
        (1440, "Bicep and ARM", "resource-group"),
    ):
        s.node("p-" + icon, cx, 1058, name, None, icon, w=150, size=32)

    # Flows: grid operations
    s.flow("f1", "sources", "eventhouse", [(240, MID[A]), s.port("eventhouse", "l")])
    s.flow("f2", "eventhouse", "policy", sides=("r", "l"))
    s.flow("f3", "policy", "kql", sides=("r", "l"))
    # asset reliability
    s.flow("f4", "sources", "lakehouse", [(240, MID[B]), s.port("lakehouse", "l")], label="Load", at=(ING, MID[B] - 8))
    s.flow("f5", "lakehouse", "notebooks", sides=("r", "l"), both=True)
    s.flow("f6", "lakehouse", "semantic", [s.port("lakehouse", "t"), (STO, 372), (SRV - 10, 372), s.port("semantic", "t", -10)])
    s.flow("f7", "agent", "semantic", [s.port("agent", "t"), s.port("semantic", "b")])
    s.flow("f8", "lakehouse", "ontology", [s.port("lakehouse", "b"), (STO, MID[B2]), s.port("ontology", "l")], "control")
    # weather forecast
    s.flow("w1", "sources", "channel", [(240, MID[C]), s.port("channel", "l")])
    s.flow("w2", "channel", "aurora", sides=("r", "l"), both=True)
    s.flow("w3", "aurora", "events", sides=("r", "l"))
    # geospatial context
    s.flow("g1", "sources", "landing", [(240, MID[D]), s.port("landing", "l")], label="Upload", at=(ING, MID[D] - 8))
    s.flow("g2", "landing", "geocatalog", sides=("r", "l"))
    s.flow("g3", "geocatalog", "stac", sides=("r", "l"))
    # serving and experience
    s.flow("e1", "f-serve", "app", [(1240, MID[B]), (1360, MID[B]), (1360, MID[C] - 8), (1398, MID[C] - 8)])
    s.flow("e2", "a-serve", "app", [(1240, 845), (1340, 845), (1340, MID[C] + 8), (1398, MID[C] + 8)])
    s.flow("e3", "users", "app", [s.port("users", "b"), s.port("app", "t")], "request")
    s.flow("e4", "basemap", "users", sides=("l", "r"))
    s.flow("e5", "app", "openai", [s.port("app", "b"), s.port("openai", "t")], "request")

    # Numbered workflow (README "Workflow" steps 1-8)
    s.step(1, 240, 230)
    s.step(2, 448, MID[A])
    s.step(3, 682, MID[B])
    s.step(4, 682, MID[B2])
    s.step(5, 1300, MID[B])
    s.step(6, 448, MID[D])
    s.step(7, 448, MID[C])
    s.step(8, EXP, 620)
    return s
