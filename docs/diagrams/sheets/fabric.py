"""Fabric: the OneGrid workspace in Azure Architecture Center style.

Sources and clients on the left, the Fabric workspace in ingest, store, process and serve
stages over OneLake, and the OneGrid app on the right. Numbered markers match the Workflow
list in docs/architecture/fabric.md; item names, ports, identities and permissions are in
that article, not on the drawing."""

from diagram_engine import Sheet

LABEL = "Fabric"
SUMMARY = ("Fabric workspace: Eventstream and Eventhouse for telemetry, Lakehouse and notebooks for "
           "history and scoring, SQL endpoint refresh into the Import model, ontology and data agent")

SRC, ING, STO, PRO, SRV, APP = 145, 415, 675, 935, 1195, 1460
A, B, C, D = 220, 370, 520, 670          # icon tops per row
MID = {r: r + 22 for r in (A, B, C, D)}
GAP_SP = 805                             # gap between the Store and Process stages
GAP_PS = 1065                            # gap between the Process and Serve stages


def build():
    s = Sheet(
        "onegrid-reference-fabric",
        "OneGrid · Fabric",
        "OneGrid data and analytics in Microsoft Fabric",
        "Telemetry, business history and weather outputs land in one Fabric workspace and reach the "
        "OneGrid app through KQL, DAX and a data agent.",
        width=1600, height=900, style="learn",
    )
    s.footnote = ("Numbered steps match the Workflow in fabric.md. Protocols, permissions and private "
                  "connectivity are described in the article.")

    # Containers
    s.zone("sources", 40, 110, 210, 735, "Source and clients")
    s.zone("fabric", 280, 110, 1050, 735, "Microsoft Fabric workspace", icon="fabric")
    s.stage("ingest", 300, 190, 230, 590, "Ingest")
    s.stage("store", 560, 190, 230, 590, "Store")
    s.stage("process", 820, 190, 230, 590, "Process")
    s.stage("serve", 1080, 190, 230, 590, "Serve")
    s.bar("onelake", 300, 795, 1010, 28, "OneLake", icon="one-lake")
    s.zone("consumers", 1360, 110, 200, 735, "Consumers")

    # Source and clients
    s.node("conn", SRC, A, "Source connectors", "PI and SQL forwarders", "glyph:gauge", w=180)
    s.node("biz", SRC, B, "Business systems", "AIMM · iCare · GADS", "glyph:database", w=180)
    s.node("blob", SRC, C, "Weather outputs", "Blob Storage", "blob-storage", w=180)
    s.node("ops", SRC, D, "Operators", "SQL client", "users", w=180)

    # Ingest
    s.node("es", ING, A, "Eventstream", "live data add-on", "eventstream", w=150, optional=True)
    s.node("sc", ING, C, "OneLake shortcut", "optional", "one-lake", w=150)

    # Store
    s.node("eh", STO, A, "Eventhouse", "KQL database", "event-house", w=150)
    s.node("lake", STO, B, "Lakehouse", "conformed asset model", "lakehouse", w=160)
    s.node("sql", STO, D, "SQL analytics endpoint", "Lakehouse surface", "lakehouse", w=170)

    # Process
    s.node("upd", PRO, A, "Update policy", "curated events", "kql-database", w=160)
    s.node("nb", PRO, B, "Notebooks", "prediction pipeline", "notebook", w=160)
    s.node("onto", PRO, C, "Ontology", "Digital Twin Builder", "ontology", w=160)

    # Serve
    s.node("kql", SRV, A, "KQL queries", "events and outages", "kql-queryset", w=150)
    s.node("sem", SRV, B, "Semantic model", "Import mode", "semantic-model", w=150)
    s.node("agent", SRV, C, "Data agent", "optional", "data-agent", w=130)

    # Consumers
    s.node("app", APP, B, "OneGrid web app", "App Service", "app-service", w=150)

    # Real-time telemetry
    s.flow("f1", "conn", "es")
    s.flow("f2", "es", "eh")
    s.flow("f3", "eh", "upd")
    s.flow("f4", "upd", "kql")
    s.flow("f5", "app", "kql", [s.port("app", "t"), (APP, MID[A]), s.port("kql", "r")], "request")
    # Curated history and scoring
    s.flow("f6", "biz", "lake", label="Load", at=(ING, MID[B] - 8))
    s.flow("f7", "lake", "nb", both=True)
    s.flow("f8", "blob", "sc", dashed=True)
    s.flow("f9", "sc", "lake", [s.port("sc", "t"), (ING, MID[B] + 14), s.port("lake", "l", 14)], dashed=True)
    s.flow("f10", "onto", "lake", [s.port("onto", "l"), (STO + 40, MID[C]), s.port("lake", "b", 40)],
           "control", label="Bind", at=(760, MID[C] - 8))
    # Serving
    s.flow("f11", "lake", "sql", [s.port("lake", "b"), s.port("sql", "t")])
    s.flow("f12", "ops", "sql", kind="request", label="TDS 1433", at=(ING, MID[D] - 8))
    s.flow("f13", "sql", "sem", [s.port("sql", "r"), (GAP_PS, MID[D]), (GAP_PS, MID[B]), s.port("sem", "l")],
           label="Refresh", at=(PRO, MID[D] - 8))
    s.flow("f14", "app", "sem", sides=("l", "r"), kind="request")
    s.flow("f15", "app", "agent", [s.port("app", "b"), (APP, MID[C]), s.port("agent", "r")], "request")
    s.flow("f16", "agent", "sem", [s.port("agent", "t"), s.port("sem", "b")], "request")

    # Numbered workflow (fabric.md "Workflow" steps 1-6)
    s.step(1, 265, MID[A])
    s.step(2, 545, MID[A])
    s.step(3, GAP_SP, MID[B])
    s.step(4, GAP_SP, MID[D])
    s.step(5, 1345, MID[B])
    s.step(6, 265, MID[D])
    return s
