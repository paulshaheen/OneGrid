"""Regulated workload: OneGrid's trust boundaries in Azure Architecture Center style.

Four boundaries read left to right: the OT transfer boundary, the classified Fabric
workspace, the controlled application boundary and the model and geospatial boundary.
Evidence from each boundary leaves the request path for a retained evidence bar.
Numbered markers match the Workflow list in docs/architecture/regulated-workload.md;
ports, roles and control requirements are in that article, not on the drawing."""

from diagram_engine import Sheet

LABEL = "Regulated workload"
SUMMARY = ("Regulated boundaries: outbound-only OT publication, classified Fabric workspace, private "
           "application ingress, approved model and geospatial services, and retained evidence")

OT = 150
F1, F2 = 390, 570          # Fabric workspace columns
A1, A2 = 810, 1060         # application boundary columns
M1, M2 = 1290, 1470        # model and geospatial columns
A, B, C = 280, 430, 580    # icon tops per row
TOP = 96                   # icon top of the users and sign-in row above the boundaries
MID = {r: r + 22 for r in (A, B, C, TOP)}
GAP_OF, GAP_FA, GAP_AM = 275, 685, 1185   # gaps between neighbouring boundaries
ZONE_Y, ZONE_H = 200, 500
BAR_Y = 750


def build():
    s = Sheet(
        "onegrid-reference-regulated",
        "OneGrid · regulated workload",
        "OneGrid regulated workload boundaries",
        "Outbound-only OT publication, a classified Fabric workspace, private application ingress and "
        "approved model services, with retained evidence for each boundary.",
        width=1600, height=890, style="learn",
    )
    s.footnote = ("Numbered steps match the Workflow in regulated-workload.md. Ports, permissions and "
                  "evidence requirements are described in the article.")

    # Boundaries
    s.zone("ot", 40, ZONE_Y, 220, ZONE_H, "OT transfer boundary")
    s.zone("fabric", 290, ZONE_Y, 380, ZONE_H, "Classified Fabric workspace", icon="fabric")
    s.zone("workload", 700, ZONE_Y, 470, ZONE_H, "Controlled application boundary")
    s.zone("models", 1200, ZONE_Y, 360, ZONE_H, "Model and geospatial boundary")
    s.bar("evidence", 40, BAR_Y, 1520, 82, "Retained security and operational evidence", align="left")

    # Users and sign-in
    s.node("entra", A1, TOP, "Microsoft Entra ID", "Conditional Access", "entra-id", w=170)
    s.node("users", A2, TOP, "Approved users", "browser", "users", w=150)

    # OT transfer boundary
    s.node("hist", OT, A, "Plant historian", "approved source", "glyph:gauge", w=180)
    s.node("conn", OT, B, "Source connector", "durable outbox", "glyph:network", w=180)

    # Classified Fabric workspace
    s.node("es", F1, A, "Eventstream", "live data add-on", "eventstream", w=150, optional=True)
    s.node("eh", F2, A, "Eventhouse", "KQL database", "event-house", w=150)
    s.node("nb", F1, B, "Notebooks", "approved transforms", "notebook", w=150)
    s.node("lake", F2, B, "Lakehouse", "classified tables", "lakehouse", w=150)
    s.node("sem", F2, C, "Semantic model", "Import mode", "semantic-model", w=150)

    # Controlled application boundary
    s.node("pe", A1, A, "Private endpoint", None, "private-endpoint", w=150)
    s.node("agw", A2, A, "Application Gateway", "WAF", "application-gateway", w=170)
    s.node("app", A1, B, "OneGrid web app", "App Service", "app-service", w=150)

    # Model and geospatial boundary
    s.node("openai", M1, A, "Microsoft Foundry", "approved models", "ai-foundry", w=150)
    s.node("geo", M1, B, "GeoCatalog", "Planetary Computer Pro", "geocatalog", w=160)
    s.node("aurora", M2, B, "Aurora", "Azure Machine Learning", "machine-learning", w=150)
    s.node("weather", M1, C, "Weather output", "Blob Storage", "blob-storage", w=150)
    s.node("job", M2, C, "Forecast job", "Container Apps", "container-apps-job", w=150)

    # Evidence
    s.node("logs", 700, BAR_Y + 14, "Log Analytics", None, "log-analytics", w=150, size=32)
    s.node("approvals", 1160, BAR_Y + 14, "Release approvals", None, "policy", w=150, size=32)

    # OT publication: read the source, publish outward
    s.flow("r1", "hist", "conn", [s.port("hist", "b"), s.port("conn", "t")], label="Read only",
           at=(OT + 8, (A + 80 + B) / 2 + 4), anchor="start")
    s.flow("r2", "conn", "es", [s.port("conn", "r"), (GAP_OF, MID[B]), (GAP_OF, MID[A]), s.port("es", "l")])
    # Fabric
    s.flow("r3", "es", "eh")
    s.flow("r4", "nb", "lake", both=True)
    s.flow("r5", "lake", "sem", [s.port("lake", "b"), s.port("sem", "t")])
    # Users, sign-in and private ingress
    s.flow("r6", "users", "agw", [s.port("users", "b"), s.port("agw", "t")], "request")
    s.flow("r7", "users", "entra", sides=("l", "r"), kind="identity", label="Sign in")
    s.flow("r8", "agw", "pe", sides=("l", "r"), kind="request")
    s.flow("r9", "pe", "app", [s.port("pe", "b"), s.port("app", "t")], "request")
    # Workload identity calls to data and model services
    s.flow("r10", "app", "eh", [s.port("app", "l", -16), (GAP_FA, MID[B] - 16), (GAP_FA, MID[A]),
                                s.port("eh", "r")], "request")
    s.flow("r11", "app", "sem", [s.port("app", "l", 16), (GAP_FA, MID[B] + 16), (GAP_FA, MID[C]),
                                 s.port("sem", "r")], "request")
    s.flow("r12", "app", "openai", [s.port("app", "r", -16), (GAP_AM, MID[B] - 16), (GAP_AM, MID[A]),
                                    s.port("openai", "l")], "request")
    s.flow("r13", "app", "geo", kind="request")
    s.flow("r14", "app", "weather", [s.port("app", "r", 16), (GAP_AM, MID[B] + 16), (GAP_AM, MID[C]),
                                     s.port("weather", "l")], "request")
    # Forecast
    s.flow("r15", "job", "weather", sides=("l", "r"))
    s.flow("r16", "job", "aurora", [s.port("job", "t"), s.port("aurora", "b")], "request")
    # Evidence leaves each boundary out of band
    bottom = ZONE_Y + ZONE_H
    for fid, zone, x in (("a1", "fabric", 480), ("a2", "workload", 935), ("a3", "models", 1380)):
        s.flow(fid, zone, "evidence", [(x, bottom), (x, BAR_Y)], "audit")

    # Numbered workflow (regulated-workload.md "Workflow" steps 1-6)
    s.step(1, GAP_OF, (MID[A] + MID[B]) / 2)
    s.step(2, (F1 + F2) / 2, MID[B])
    s.step(3, A2, (TOP + 80 + A) / 2 + 17)
    s.step(4, M2, (B + 80 + C) / 2)
    s.step(5, 935, (bottom + BAR_Y) / 2)
    s.step(6, 1060, BAR_Y + 30)
    return s
