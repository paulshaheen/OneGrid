"""Multiregion recovery: OneGrid business continuity and disaster recovery (BCDR) in a landing zone.

Modelled on the landing-zone views in Microsoft's "Multiregion BCDR for Azure Virtual Desktop"
article: Microsoft Entra ID and Azure Front Door Premium as global bars across the top, the
on-premises corporate and OT networks on the left with ExpressRoute or VPN to both regional
hubs, and the regions as rows. The primary region (active) is on top; the recovery region
(standby) below uses greyed, dashed subscriptions. The recovery row mirrors the primary row so
that every recovery copy sits directly under its source across the gap between the regions.
Each region has a Connectivity subscription (hub), a Management subscription and a OneGrid
workload subscription whose red dashed boundary is the regional deployment stamp. The
Microsoft Fabric tenant is on the right with a capacity per region.

Letters A-J (B2-J2 for the recovery copies) match the "Design areas" table in
docs/architecture/multiregion.md. This sheet has letters only, no numbered steps."""

from diagram_engine import Sheet

LABEL = "Multiregion recovery"
SUMMARY = ("OneGrid BCDR in a landing zone: Entra ID and Front Door Premium across the top, a primary "
           "and a standby recovery region as rows with hub, management and workload subscriptions, "
           "the Fabric tenant on the right, recovery paths between the regions and lettered design areas")

W, H = 1800, 1240

# Columns
OX, OW = 40, 160                      # on-premises zone
RX, RW = 220, 1208                    # region zones (also the left edge of both global bars)
LX, LW = 236, 380                     # left column: connectivity and management subscriptions
WX, WW = 648, 756                     # OneGrid workload subscription
SX, SW = 664, 724                     # regional stamp (red dashed scale unit)
VX, VW = 680, 468                     # workload VNet (row A, columns 1-4)
HX, HW = 248, 356                     # hub VNet
FX, FW = 1452, 308                    # Microsoft Fabric tenant zone
CHANNEL = 628                         # hub-to-hub peering channel between the two columns
ORIGIN_X = 1416                       # recovery origin channel inside the right margin of the regions

COLS = [746 + 112 * i for i in range(6)]   # stamp grid: row A and row B share these centre lines
HUB = (312, 426, 540)                      # hub and management grid
F1, F2 = 1536, 1676                        # Fabric columns

# Rows
ENTRA_Y, FD_Y, BAR_H = 96, 148, 36
FD_MID = FD_Y + BAR_H / 2
Z1, RH, GAP = 228, 446, 48            # region zones
Z2 = Z1 + RH + GAP
S1, S2 = Z1 + 44, Z2 + 44             # subscription tops
SUB_H = 386
GAP_LABEL_Y = Z1 + RH + 28            # baseline for labels in the gap between the regions
BOTTOM_Y = Z2 + RH + 22               # replay route under the recovery region


def build():
    s = Sheet(
        "onegrid-reference-multiregion",
        "OneGrid · multiregion recovery",
        "OneGrid multiregion business continuity and disaster recovery",
        "A primary region and a standby recovery region in the landing zone, with hub, management and "
        "workload subscriptions per region, the Microsoft Fabric tenant, and the recovery paths between them.",
        width=W, height=H, style="learn",
    )
    s.footnote = ("Letters A–J match the design areas in the multiregion article; B2–J2 mark the recovery "
                  "copies. Dashed lines are gated, disabled, optional or recovery paths. Address ranges are examples.")

    # ----- global services across the top --------------------------------------------------
    s.bar("entra", RX, ENTRA_Y, FX + FW - RX, BAR_H,
          "Microsoft Entra ID · sign-in, managed identities, Conditional Access", icon="entra-id")
    s.bar("frontdoor", RX, FD_Y, RW, BAR_H,
          "Azure Front Door Premium · WAF, custom host, managed private origins", icon="front-door")
    s.node("users", 130, FD_Y - 4, "OneGrid users", "browser, HTTPS", "users", w=120)
    s.flow("entry", "users", "frontdoor", [s.port("users", "r"), (RX, FD_MID)], "request")

    # ----- on-premises: corporate and OT networks --------------------------------------------
    s.zone("onprem", OX, 506, OW, 384, "On-premises")
    s.node("corp", 120, 550, ["Corporate", "network"], "admins, DNS", "glyph:network", w=110)
    s.node("historian", 120, 674, "OT historian", "PI or SQL source", "glyph:gauge", w=110)
    s.node("connector", 120, 794, "OT connector", "outbox, watermark", "glyph:api", w=110)
    s.flow("ot-read", "historian", "connector", sides=("b", "t"), kind="data")

    # ExpressRoute or VPN from on-premises to the gateway in each regional hub
    for k, gy in (("a", S1 + 84), ("b", S2 + 268)):
        s.node("circuit-" + k, 120, gy, "ExpressRoute", "or VPN", "expressroute", w=110)
        s.flow("hybrid-" + k, "circuit-" + k, "gw-" + k,
               [s.port("circuit-" + k, "r"), (HUB[0] - 22, gy + 22)], "request", both=True)
    s.flow("onprem-a", "onprem", "circuit-a", [(120, 506), s.port("circuit-a", "b")], "request", both=True)
    s.flow("onprem-b", "onprem", "circuit-b", [(120, 506 + 384), s.port("circuit-b", "t")], "request", both=True)

    # ----- the two regions -----------------------------------------------------------------------
    regions = (
        ("a", Z1, S1, "Primary region (active)", False),
        ("b", Z2, S2, "Recovery region (standby)", True),
    )
    for k, zy, sy, title, standby in regions:
        s.zone("region-" + k, RX, zy, RW, RH, title)
        # Primary: connectivity on top, management below; recovery mirrors it so the hubs face their
        # workload VNets and the recovery copies sit under their sources.
        conn_y, mgmt_y = (sy, sy + 216) if not standby else (sy + 184, sy)
        conn_h, mgmt_h = (204, 170) if not standby else (202, 172)
        hub_y = conn_y + 44
        s.subscription("conn-" + k, LX, conn_y, LW, conn_h, "Connectivity subscription", passive=standby)
        s.boundary("hub-" + k, HX, hub_y, HW, 146, "Hub VNet", "10.30.0.0/16" if standby else "10.10.0.0/16",
                   icon="virtual-network")
        s.node("gw-" + k, HUB[0], hub_y + 40, "Gateway", "ER or VPN", "vnet-gateway", w=108)
        s.node("fw-" + k, HUB[1], hub_y + 40, "Azure Firewall", "approved egress", "firewall", w=108)
        s.node("dns-" + k, HUB[2], hub_y + 40, ["DNS Private", "Resolver"], "private DNS",
               "dns-private-resolver", w=108)

        s.subscription("mgmt-" + k, LX, mgmt_y, LW, mgmt_h, "Management subscription", passive=standby)
        node_y = mgmt_y + 46
        s.node("la-" + k, HUB[0], node_y, "Log Analytics", "regional workspace" if standby else "workspace",
               "log-analytics", w=108)
        s.node("monitor-" + k, HUB[1], node_y, "Monitor", "alerts", "monitor", w=108)
        s.node("watcher-" + k, HUB[2], node_y, "Network Watcher", "path probes", "network-watcher", w=108)

        # OneGrid workload subscription with the regional stamp (same template in both regions)
        s.subscription("work-" + k, WX, sy, WW, SUB_H, "OneGrid workload", passive=standby)
        stamp_y = sy + 44
        s.boundary("stamp-" + k, SX, stamp_y, SW, 328, "Regional stamp", accent=True)
        vnet_y, row_b = (stamp_y + 44, stamp_y + 218) if not standby else (stamp_y + 184, stamp_y + 44)
        row_a = vnet_y + 40
        s.boundary("vnet-" + k, VX, vnet_y, VW, 130, "Workload VNet",
                   "10.40.0.0/16" if standby else "10.20.0.0/16", icon="virtual-network")
        s.node("job-" + k, COLS[0], row_a, "Forecast job", "off until cutover" if standby else "sole publisher",
               "container-apps-job", w=108)
        s.node("env-" + k, COLS[1], row_a, "Job environment", "job subnet", "container-apps-env", w=108)
        s.node("pe-" + k, COLS[2], row_a, "Private endpoints", "one per service", "private-endpoint", w=108)
        s.node("vnetint-" + k, COLS[3], row_a, "VNet integration", "app outbound", "virtual-network", w=108)
        s.node("app-" + k, COLS[5], row_a, "App Service", "standby web app" if standby else "OneGrid web app",
               "app-service", w=108)

        services = (
            ("aml", ["Azure Machine", "Learning"], "GPU quota" if standby else "Aurora endpoint", "machine-learning"),
            ("acr", ["Container", "Registry"], "replica or rebuild" if standby else "job image", "container-registry"),
            ("blob", "Blob storage", "replica, read-only" if standby else "assets, outputs", "blob-storage"),
            ("foundry", ["Microsoft", "Foundry"], "own model quota" if standby else "model deployment", "ai-foundry"),
            ("geo", "GeoCatalog", "re-ingested" if standby else "STAC, tiles", "geocatalog"),
            ("kv", "Key Vault", "stamp vault" if standby else "ML workspace", "key-vault"),
        )
        for cx, (key, name, caption, icon) in zip(COLS, services):
            s.node(f"{key}-{k}", cx, row_b, name, caption, icon, w=108)

        # Inside the stamp: app outbound through VNet integration to private endpoints. In the primary
        # stamp the job also calls Aurora and its environment pulls the image; the recovery stamp is the
        # same template, and its job stays off, so those two arrows aren't repeated there (they would
        # cross the VNet title in the mirrored row).
        s.flow("app-out-" + k, "app-" + k, "vnetint-" + k, sides=("l", "r"), kind="request")
        s.flow("int-pe-" + k, "vnetint-" + k, "pe-" + k, sides=("l", "r"), kind="request")
        s.flow("pe-blob-" + k, "pe-" + k, "blob-" + k, sides=("b", "t") if not standby else ("t", "b"),
               kind="request")
        if not standby:
            s.flow("job-aml-a", "job-a", "aml-a", sides=("b", "t"), kind="request")
            s.flow("acr-env-a", "acr-a", "env-a", sides=("t", "b"), kind="data")

        # Hub-to-spoke peering at the row A centre line
        peer_y = row_a + 22
        s.flow("peering-" + k, "hub-" + k, "vnet-" + k, [(HX + HW, peer_y), (VX, peer_y)], "request", both=True)

    # Hub-to-hub peering runs in the channel between the left column and the workload subscriptions
    s.flow("hub-hub", "hub-a", "hub-b",
           [(HX + HW, S1 + 176), (CHANNEL, S1 + 176), (CHANNEL, S2 + 184 + 66), (HX + HW, S2 + 184 + 66)],
           "request", both=True, label="Global VNet peering", at=(CHANNEL - 6, GAP_LABEL_Y), anchor="end")

    # ----- Front Door origins ------------------------------------------------------------------------
    s.flow("origin-a", "frontdoor", "app-a", [(COLS[5], FD_Y + BAR_H), s.port("app-a", "t")], "request",
           label="Primary origin", at=(COLS[5] + 8, 210), anchor="start")
    app_b = s.port("app-b", "r")
    s.flow("origin-b", "frontdoor", "app-b", [(ORIGIN_X, FD_Y + BAR_H), (ORIGIN_X, app_b[1]), app_b], "request",
           dashed=True, label="Recovery origin, off until the gate", at=(ORIGIN_X - 6, GAP_LABEL_Y), anchor="end")

    # ----- recovery paths between the regions ------------------------------------------------------
    s.flow("copy-acr", "acr-a", "acr-b", sides=("b", "t"), dashed=True,
           label="Registry replica", at=(COLS[1] - 6, GAP_LABEL_Y), anchor="end")
    s.flow("copy-blob", "blob-a", "blob-b", sides=("b", "t"), dashed=True,
           label="Object replication", at=(COLS[2] + 6, GAP_LABEL_Y), anchor="start")

    # ----- Microsoft Fabric tenant (SaaS) --------------------------------------------------------------
    s.zone("fabric", FX, Z1, FW, Z2 + RH - Z1, "Microsoft Fabric", icon="fabric")
    # Primary capacity (top) and recovery capacity (bottom, mirrored)
    s.node("cap-a", F1, S1, "Fabric capacity", "primary region", "fabric", w=120)
    s.node("es-a", F2, S1, "Eventstream", "live add-on", "eventstream", w=120, optional=True)
    s.node("nb-a", F1, S1 + 128, "Notebooks", "processing", "notebook", w=120)
    s.node("eh-a", F2, S1 + 128, "Eventhouse", "KQL database", "event-house", w=120)
    s.node("lh-a", F1, S1 + 262, "Lakehouse", "asset tables", "lakehouse", w=120)
    s.node("sm-a", F2, S1 + 262, "Semantic model", "Import mode", "semantic-model", w=120)
    s.node("lh-b", F1, S2, "Lakehouse", "copied tables", "lakehouse", w=120)
    s.node("sm-b", F2, S2, "Semantic model", "rebound, refreshed", "semantic-model", w=120)
    s.node("nb-b", F1, S2 + 134, "Notebooks", "from Git", "notebook", w=120)
    s.node("eh-b", F2, S2 + 134, "Eventhouse", "replayed", "event-house", w=120)
    s.node("cap-b", F1, S2 + 268, "Fabric capacity", "recovery region", "fabric", w=120)
    s.node("es-b", F2, S2 + 268, "Eventstream", "replay target", "eventstream", w=120, optional=True)
    s.flow("es-eh-a", "es-a", "eh-a", sides=("b", "t"), kind="data", dashed=True)
    s.flow("nb-lh-a", "nb-a", "lh-a", sides=("b", "t"), kind="data")
    s.flow("lh-sm-a", "lh-a", "sm-a", kind="data")
    s.flow("es-eh-b", "es-b", "eh-b", sides=("t", "b"), kind="data", dashed=True)
    s.flow("nb-lh-b", "nb-b", "lh-b", sides=("t", "b"), kind="data")
    s.flow("lh-sm-b", "lh-b", "sm-b", kind="data")
    s.flow("copy-lh", "lh-a", "lh-b", sides=("b", "t"), dashed=True,
           label="OneLake DR copy", at=(F1 + 6, GAP_LABEL_Y), anchor="start")
    s.flow("copy-items", "sm-a", "sm-b", sides=("b", "t"), dashed=True,
           label="Items via Git", at=(F2 + 6, GAP_LABEL_Y), anchor="start")

    # ----- OT connector: checkpoint replay into the recovery Eventstream (live add-on) ---------------------
    # Live events normally reach the primary Eventstream; that path is in the Fabric sheet.
    c_left = s.port("connector", "l")
    s.flow("replay", "connector", "es-b",
           [c_left, (52, c_left[1]), (52, BOTTOM_Y), (F2, BOTTOM_Y), s.port("es-b", "b")],
           dashed=True, label="Replay from the recorded checkpoint", at=(900, BOTTOM_Y - 8))

    # ----- design areas (multiregion.md, "Design areas") ----------------------------------------------
    s.step("A", RX, ENTRA_Y)               # identity
    s.step("D", RX, FD_Y)                  # global routing and origins
    s.step("B", LX, S1)                    # connectivity, primary
    s.step("B2", LX, S2 + 184)             # connectivity, recovery
    s.step("J", LX, S1 + 216)              # management, primary
    s.step("J2", LX, S2)                   # management, recovery
    s.step("C", WX, S1)                    # workload subscription and regional stamp
    s.step("C2", WX, S2)
    gap_a, gap_b = S1 + 44 + 196, S2 + 44 + 162   # between row A and row B in each stamp
    s.step("F", COLS[0] + 30, gap_a)       # forecast publication: job, Aurora, registry
    s.step("F2", COLS[0] + 30, gap_b)
    s.step("E", COLS[2] + 30, gap_a)       # storage
    s.step("E2", COLS[2] + 30, gap_b)
    s.step("G", (COLS[3] + COLS[4]) / 2, gap_a)   # Microsoft Foundry and GeoCatalog
    s.step("G2", (COLS[3] + COLS[4]) / 2, gap_b)
    s.step("H", FX, S1 + 22)               # Microsoft Fabric
    s.step("H2", FX, S2 + 268 + 22)
    s.step("I", OX, 506)                   # OT connector and live events
    return s
