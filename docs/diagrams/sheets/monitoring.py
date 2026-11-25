"""Logging and monitoring, drawn in Azure Architecture Center style.

Signal sources on the left, the collection mechanism in the middle and the destinations
on the right. Collection the baseline deployment wires sits in a solid "Baseline wired"
boundary; collection you must configure sits in a dashed "Enterprise additions"
boundary. Every link is out-of-band evidence. Log categories, retention and the private
monitoring (AMPLS) design are in the Collection flow list in
docs/architecture/traffic-and-security.md."""

from diagram_engine import Sheet

LABEL = "Logging and monitoring"
SUMMARY = ("Six signal sources traced from collection to destination, with baseline-wired "
           "collection told apart from enterprise additions")

SRC, COL, D1, D2 = 160, 560, 980, 1320      # column centres
R = (250, 370, 550, 670, 790, 910)           # icon tops: job, ML | Fabric, app, Azure, data
MID = [r + 22 for r in R]


def build():
    s = Sheet(
        "onegrid-reference-monitoring",
        "OneGrid · logging and monitoring",
        "Logging and monitoring",
        "Out-of-band evidence: what the baseline wires, what you add, and where each signal lands. "
        "No monitoring service sits on the user request path.",
        width=1600, height=1070, style="learn",
    )
    s.footnote = ("Numbered steps match the Collection flow list in the traffic and security guide. "
                  "All lines are diagnostic paths, out of band.")

    # Containers and headers
    s.stage("sources", 40, 190, 240, 820, "Signal sources")
    s.header(COL, 178, "Collection")
    s.boundary("baseline", 380, 190, 360, 280, "Baseline wired")
    s.boundary("enterprise", 380, 500, 360, 510, "Enterprise additions", dashed=True)
    s.header((D1 + D2) / 2, 178, "Destinations")

    # Signal sources
    s.node("job", SRC, R[0], "Forecast job", "Container Apps job", "container-apps-job", w=200)
    s.node("aml", SRC, R[1], "Aurora endpoint", "Azure ML", "machine-learning", w=200)
    s.node("fabric", SRC, R[2], "Fabric items", "runs and refreshes", "fabric", w=200)
    s.node("app", SRC, R[3], "OneGrid web app", "App Service", "app-service", w=200)
    s.node("azure", 102, R[4], "Azure resources", "Activity Log", "resource-group", w=112)
    s.node("entra", 220, R[4], "Entra ID", "sign-in, audit", "entra-id", w=112)
    s.node("data", SRC, R[5] + 8, "Published data", "events, KQL, model", "blob-storage", w=200)

    # Collection
    diag = (R[3] + R[4]) // 2
    s.node("envlog", COL, R[0], "Environment logging", "Container Apps", "glyph:document", w=180)
    s.node("appins", COL, R[1], "Application Insights", "ML workspace link", "application-insights", w=180)
    s.node("fabmon", COL, R[2], "Fabric monitoring", "run history", "glyph:gauge", w=180)
    s.node("diag", COL, diag, "Diagnostic settings", "per resource", "glyph:document", w=180)
    s.node("checks", COL, R[5] + 8, "Scheduled checks", "real-caller reads", "glyph:clock", w=180)

    # Destinations
    la_top = R[0]
    s.node("la", D1, la_top, "Log Analytics", "central workspace", "log-analytics", w=170)
    s.node("siem", D2, la_top - 8, "SIEM or archive", "security operations", "glyph:shield", w=170)
    s.node("owners", D2, R[5], "Alert owners", "runbook, recovery", "users", w=170)
    la_mid = la_top + 22

    # 1 Forecast job logs (baseline)
    s.flow("m1a", "sources", "envlog", [(280, MID[0]), s.port("envlog", "l")], "audit")
    s.flow("m1b", "envlog", "la", sides=("r", "l"), kind="audit")
    # 2 Model inference telemetry (baseline workspace link)
    s.flow("m2", "sources", "appins", [(280, MID[1]), s.port("appins", "l")], "audit")
    # 3 Fabric run history, exported explicitly
    s.flow("m3a", "sources", "fabmon", [(280, MID[2]), s.port("fabmon", "l")], "audit")
    s.flow("m3b", "fabmon", "la", [s.port("fabmon", "r"), (D1 - 10, MID[2]), s.port("la", "b", -10)], "audit",
           label="Export", at=(860, MID[2] - 8))
    # 4 Diagnostic settings for the app, Azure resources and Entra
    s.flow("m4a", "sources", "diag", [(280, MID[3]), (340, MID[3]), (340, diag + 14), s.port("diag", "l", -8)], "audit")
    s.flow("m4b", "sources", "diag", [(280, MID[4]), (340, MID[4]), (340, diag + 30), s.port("diag", "l", 8)], "audit")
    s.flow("m4c", "diag", "la", [s.port("diag", "r"), (D1 + 10, diag + 22), s.port("la", "b", 10)], "audit")
    # 5 Scheduled real-caller checks alert their owners
    s.flow("m5a", "sources", "checks", [(280, MID[5] + 8), s.port("checks", "l")], "audit")
    s.flow("m5b", "checks", "owners", [s.port("checks", "r"), s.port("owners", "l", 8)], "audit")
    # 6 Retention and security export, 7 log alerts
    s.flow("m6", "la", "siem", [s.port("la", "r", -8), s.port("siem", "l")], "audit", label="Export",
           at=((D1 + D2) / 2, la_mid - 16))
    s.flow("m7", "la", "owners", [s.port("la", "r", 8), (1140, la_mid + 8), (1140, MID[5] - 8),
                                  s.port("owners", "l", -8)], "audit", label="Alerts",
           at=(1148, (la_mid + MID[5]) / 2), anchor="start")

    # Numbered collection flow (Collection flow list in traffic-and-security.md)
    s.step(1, 330, MID[0])
    s.step(2, 330, MID[1])
    s.step(3, 330, MID[2])
    s.step(4, 780, diag + 22)
    s.step(5, 330, MID[5] + 8)
    s.step(6, 1080, la_mid - 8)
    s.step(7, 1140, MID[5] - 60)
    return s
