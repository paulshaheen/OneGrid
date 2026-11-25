"""Multiregion recovery, drawn in Azure Architecture Center style.

Azure Front Door Premium sits above two mirrored regions that use the same icons. The
primary origin is solid; the recovery origin is dashed because it stays disabled until
the cutover gate passes. Dashed arrows between the regions are the configured storage
copy and Fabric item recovery. Numbered markers match the Workflow list in
docs/architecture/multiregion.md, which also holds the address plans, origin protection
and readiness detail."""

from diagram_engine import Sheet

LABEL = "Multiregion recovery"
SUMMARY = ("An active primary region and a prepared recovery region behind Front Door Premium, "
           "with a gated recovery origin, configured recovery paths and a numbered cutover")

W = 1600
CA, CB, CC = 170, 390, 610           # primary-region columns, outer to inner; recovery mirrors them
USERS_Y, FD_Y = 112, 218
FD_MID = FD_Y + 22
ZONE_Y, ZONE_H = 330, 645
APP_Y = 390
NET_Y, NET_H = 500, 160
R2 = 560
STAGE_Y, STAGE_H = 712, 245
R3, R4 = 737, 857
GAP_STEP = 718                       # steps on the cross-region arrows, between stage and zone edges


def build():
    s = Sheet(
        "onegrid-reference-multiregion",
        "OneGrid · multiregion recovery",
        "OneGrid multiregion recovery",
        "An active primary region and a prepared recovery region behind Azure Front Door Premium, "
        "with configured recovery paths and a gated cutover.",
        width=W, height=1025, style="learn",
    )
    s.footnote = ("Numbered steps match the Workflow list. Dashed lines are gated, disabled or configured "
                  "recovery paths. Address ranges are examples.")

    # Global entry
    s.node("users", W / 2, USERS_Y, "OneGrid users", None, "users", w=120)
    s.node("frontdoor", W / 2, FD_Y, "Azure Front Door", "Premium · WAF", "front-door", w=130)
    s.flow("entry", "users", "frontdoor", sides=("b", "t"), kind="request")

    # Two mirrored regions: same icons, same rows; the recovery side is the mirror image
    regions = (
        ("a", lambda x: x, "Primary region (active)", "10.20.0.0/16", "sole publisher", False),
        ("b", lambda x: W - x, "Recovery region (prepared)", "10.40.0.0/16", "disabled until cutover", True),
    )
    for k, m, title, cidr, job_caption, gated in regions:
        left = lambda a, b: min(m(a), m(b))
        s.zone("region-" + k, left(40, 740), ZONE_Y, 700, ZONE_H, title)
        s.boundary("vnet-" + k, left(66, 696), NET_Y, 630, NET_H, "Workload VNet", cidr, icon="virtual-network")
        s.stage("services-" + k, left(66, 696), STAGE_Y, 630, STAGE_H, "Regional services")

        s.node("app-" + k, m(CB), APP_Y, "OneGrid web app", "App Service", "app-service", w=130)
        s.node("vnetint-" + k, m(CB), R2, "VNet integration", "app outbound", "virtual-network", w=130)
        s.node("pe-" + k, m(CC), R2, "Private endpoints", "Blob · OpenAI · Fabric", "private-endpoint", w=150)
        s.node("job-" + k, m(CA), R2, "Forecast job", job_caption, "container-apps-job", w=150)
        s.node("aurora-" + k, m(CA), R3, "Aurora", "Azure Machine Learning", "machine-learning", w=150)
        s.node("openai-" + k, m(CB), R3, "Azure OpenAI", "regional model quota", "azure-openai", w=140)
        s.node("blob-" + k, m(CC), R3, "Blob storage", "assets and outputs", "blob-storage", w=130)
        s.node("geo-" + k, m(CA), R4, "GeoCatalog", "STAC and tiles", "geocatalog", w=140)
        s.node("ops-" + k, m(CB), R4, "Operations", "logs and alerts", "log-analytics", w=140)
        s.node("fabric-" + k, m(CC), R4, "Microsoft Fabric", "capacity and items", "fabric", w=130)

        inward = ("r", "l") if k == "a" else ("l", "r")
        s.flow("app-net-" + k, "app-" + k, "vnetint-" + k, sides=("b", "t"), kind="request")
        s.flow("net-pe-" + k, "vnetint-" + k, "pe-" + k, sides=inward, kind="request")
        s.flow("pe-services-" + k, "pe-" + k, "services-" + k,
               [s.port("pe-" + k, "b"), (m(CC), STAGE_Y)], kind="request")
        s.flow("job-aurora-" + k, "job-" + k, "aurora-" + k, sides=("b", "t"), kind="request", dashed=gated)

    # Origins: primary accepted, recovery disabled until the cutover gate passes
    s.flow("origin-a", "frontdoor", "app-a", [s.port("frontdoor", "l"), (CB, FD_MID), s.port("app-a", "t")],
           kind="request", label="Private origin")
    s.flow("origin-b", "frontdoor", "app-b", [s.port("frontdoor", "r"), (W - CB, FD_MID), s.port("app-b", "t")],
           kind="request", label="Gated origin", dashed=True)

    # Recovery paths between the regions
    s.flow("copy", "blob-a", "blob-b", sides=("r", "l"), label="Configured copy", dashed=True)
    s.flow("recover", "fabric-a", "fabric-b", sides=("r", "l"), label="Recover / replay", dashed=True)

    # Numbered workflow (multiregion.md "Workflow" steps 1-7)
    s.step(1, CB, 300)                       # normal traffic to the accepted primary origin
    s.step(2, GAP_STEP, R3 + 22)             # configured storage copy
    s.step(3, CA, 686)                       # fence the primary publisher and writers
    s.step(4, GAP_STEP, R4 + 22)             # recover Fabric items and replay sources
    s.step(5, W - CB, 527)                   # rebind the recovery app and refresh
    s.step(6, W - CC, 686)                   # prove journeys against recovery services
    s.step(7, W - CB, 300)                   # enable the recovery origin
    return s
