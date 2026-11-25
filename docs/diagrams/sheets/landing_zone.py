"""Landing zone: where OneGrid sits in an enterprise Azure landing zone.

Modelled on the Azure Virtual Desktop landing zone accelerator's enterprise landing zone
drawing: billing and tenant, identity, the management group hierarchy, the platform
subscriptions (connectivity, management, identity), the OneGrid workload subscriptions, the
Microsoft Fabric tenant and the delivery tooling. Letters A-H mark the eight design areas in
the "Landing zone design decisions" table of docs/architecture/enterprise-landing-zone.md."""

from diagram_engine import Sheet

LABEL = "Landing zone"
SUMMARY = ("Where OneGrid sits in an Azure landing zone: billing, identity, management groups, "
           "platform subscriptions, the OneGrid subscriptions, the Fabric tenant and delivery")

# Columns: platform (left), OneGrid (middle), identity / Fabric / DevOps (right)
LX, LW = 40, 480
MX, MW = 570, 840
RX, RW = 1440, 320
C1, C2 = RX + 90, RX + 230            # the two node columns of every right-hand zone

# Rows
TOP, ROW1_BOTTOM = 104, 466           # billing, on-premises, management groups, identity
ROW2 = 498                            # connectivity, OneGrid production, Fabric
ROW3 = 810                            # management subscription
ROW4 = 1095                           # identity subscription, OneGrid non-production
STRIP_Y = 996                         # shared by the management and OneGrid production strips

# Governance controls drawn along the bottom of every subscription (AVD landing zone grammar)
GOVERNANCE = (
    (["Cost", "Management"], "cost-management"),
    (["Role", "assignment"], "entra-id"),
    (["Policy", "assignment"], "policy"),
    (["Network", "Watcher"], "network-watcher"),
    (["Defender", "for Cloud"], "defender-for-cloud"),
    (["Monitor"], "monitor"),
)
GAP = 74                              # strip pitch; each item is GAP - 6 wide
STRIP_W = GAP * (len(GOVERNANCE) - 1) + GAP - 6
STRIP_L = LX + (LW - STRIP_W) / 2     # strip left edge inside a platform subscription


def governance(s, prefix, left, y):
    """Governance strip whose first item starts at x=left."""
    s.strip(prefix, left + (GAP - 6) / 2, y, GOVERNANCE, gap=GAP)


def build():
    s = Sheet(
        "onegrid-reference-landing-zone",
        "OneGrid · landing zone",
        "OneGrid in an Azure landing zone",
        "The OneGrid workload subscriptions under the organization's management groups, beside the "
        "platform subscriptions, the Microsoft Fabric tenant and the delivery tooling.",
        width=1800, height=1362, style="learn",
    )
    s.footnote = "Letters A–H match the design areas in the design guide. Enterprise additions are dashed."

    # ----- A  billing and tenant ------------------------------------------------------
    s.zone("billing", LX, TOP, LW, 172, "Billing and Microsoft Entra tenant", icon="tenant")
    s.node("tenant", 105, 158, "Entra tenant", "trusted directory", "tenant", w=114)
    s.node("billing-account", 222, 158, "Billing account", "EA or MCA", "glyph:document", w=114)
    s.node("subscriptions", 339, 158, "Subscriptions", "billing scope", "subscriptions", w=114)
    s.node("cost", 456, 158, "Cost Management", "budget, cost owner", "cost-management", w=114)
    s.flow("f-billing", "billing-account", "subscriptions", kind="request")

    # ----- on-premises (reached through the connectivity hub) ----------------------------
    s.zone("onprem", LX, 300, LW, ROW1_BOTTOM - 300, "On-premises")
    s.node("corporate", 150, 350, "Corporate network", "browsers, admins", "glyph:network", w=130)
    s.node("ot", 300, 350, "OT network", "historian, SCADA", "glyph:gauge", w=130)

    # ----- C  management group hierarchy -------------------------------------------------
    s.zone("mg", MX, TOP, MW, ROW1_BOTTOM - TOP, "Management groups", icon="management-groups")
    L0, L1, L2, L3 = 130, 206, 294, 374      # icon tops per level

    def mg(id, cx, y, name, w, caption=None):
        s.node(id, cx, y, name, caption, "management-groups", w=w, size=32, font=12)

    mg("root", 1090, L0, "Tenant root group", 112)
    mg("org", 1090, L1, "Organization", 96)
    mg("platform", 740, L2, "Platform", 80)
    mg("lz", 1010, L2, "Landing zones", 96)
    mg("sandbox", 1170, L2, "Sandbox", 80)
    mg("decom", 1300, L2, "Decommissioned", 104)
    mg("mg-mgmt", 640, L3, "Management", 88)
    mg("mg-identity", 740, L3, "Identity", 80)
    mg("mg-conn", 840, L3, "Connectivity", 88)
    mg("corp", 950, L3, "Corp", 100, "hub-connected")
    mg("online", 1070, L3, "Online", 100, "public endpoints")

    def down(id, src, dst):
        s.flow(id, src, dst, [s.port(src, "b"), s.port(dst, "t")], "request")

    def side(id, src, dst, port):
        start, end = s.port(src, port), s.port(dst, "t")
        s.flow(id, src, dst, [start, (end[0], start[1]), end], "request")

    def fork(id, src, dst, offset):
        start, end = s.port(src, "b", offset), s.port(dst, "t")
        mid = (start[1] + end[1]) / 2
        s.flow(id, src, dst, [start, (start[0], mid), (end[0], mid), end], "request")

    down("t-root", "root", "org")
    side("t-platform", "org", "platform", "l")
    fork("t-lz", "org", "lz", -8)
    fork("t-sandbox", "org", "sandbox", 8)
    side("t-decom", "org", "decom", "r")
    side("t-mgmt", "platform", "mg-mgmt", "l")
    down("t-identity", "platform", "mg-identity")
    side("t-conn", "platform", "mg-conn", "r")
    side("t-corp", "lz", "corp", "l")
    side("t-online", "lz", "online", "r")

    # ----- B  identity and access management ---------------------------------------------
    s.zone("iam", RX, TOP, RW, ROW1_BOTTOM - TOP, "Identity and access management", icon="entra-id")
    s.node("users", C1, 148, "Users and groups", "sign-in groups", "users", w=130)
    s.node("ca", C2, 148, "Conditional Access", "sign-in policy", "glyph:shield", w=130)
    s.node("pim", C1, 250, "PIM", "privileged elevation", "glyph:clock", w=130)
    s.node("appreg", C2, 250, "App registration", "OneGrid sign-in", "entra-id", w=130)
    s.node("workload-ids", C1, 352, "Workload identities", "deploy, runtime, job", "managed-identity", w=130)
    s.node("refresh-sp", C2, 352, "Service principal", "refresh identity", "entra-id", w=130)

    # ----- D  connectivity subscription ----------------------------------------------------
    s.subscription("conn", LX, ROW2, LW, 288, "Connectivity subscription")
    s.boundary("hub", 56, 544, 448, 142, "Hub VNet", icon="virtual-network")
    s.node("firewall", 135, 588, "Azure Firewall", "approved egress", "firewall", w=130)
    s.node("resolver", 280, 588, "DNS Private Resolver", "private DNS", "dns-private-resolver", w=140)
    s.node("gateway", 425, 588, "Gateway", "VPN or ExpressRoute", "vnet-gateway", w=130)
    governance(s, "gov-conn", STRIP_L, 710)
    s.flow("hybrid", "gateway", "onprem", [s.port("gateway", "t"), (425, ROW1_BOTTOM)], "request", both=True)

    # ----- OneGrid production subscription --------------------------------------------------
    s.subscription("prod", MX, ROW2, MW, 573, "OneGrid production", note="Corp or Online")
    s.flow("t-prod", "corp", "prod", [s.port("corp", "b"), (950, ROW2)], "request")
    s.flow("t-prod-online", "online", "prod", [s.port("online", "b"), (1070, ROW2)], "request")

    # Workload VNet: enterprise addition, peered to the platform hub
    s.boundary("spoke", 586, 544, 808, 142, "Workload VNet", "enterprise addition",
               icon="virtual-network", dashed=True)
    s.node("appgw", 690, 588, "Application Gateway", "ingress, WAF", "application-gateway", w=140)
    s.node("pe", 890, 588, "Private endpoints", "one per service", "private-endpoint", w=130)
    s.node("vnet-int", 1090, 588, "VNet integration", "app outbound", "virtual-network", w=130)
    s.node("job-env", 1290, 588, "Job environment", "Container Apps", "container-apps-env", w=130)
    s.flow("peering", "hub", "spoke", [(504, 615), (586, 615)], "request", dashed=True, both=True,
           label="Peering", at=(545, 607))

    # The one resource group the Bicep template deploys
    s.boundary("rg", 586, 710, 808, 262, "OneGrid workload", "resource group", icon="resource-group")
    xs = [664 + 130 * i for i in range(6)]
    for cx, (key, name, caption, icon) in zip(xs, (
        ("app", "App Service", "OneGrid web app", "app-service"),
        ("foundry", "Microsoft Foundry", "language models", "ai-foundry"),
        ("aml", ["Azure Machine", "Learning"], "Aurora endpoint", "machine-learning"),
        ("job", "Container Apps job", "weather forecast", "container-apps-job"),
        ("acr", "Container Registry", "job image", "container-registry"),
        ("capacity", "Fabric capacity", "new or existing", "fabric"),
    )):
        s.node(key, cx, 754, name, caption, icon, w=124)
    for cx, (key, name, caption, icon) in zip(xs, (
        ("geocatalog", "GeoCatalog", "Planetary Computer Pro", "geocatalog"),
        ("blob", "Blob storage", "packages and data", "blob-storage"),
        ("mi", "Managed identities", "3 user-assigned", "managed-identity"),
        ("la", "Log Analytics", None, "log-analytics"),
        ("appi", "Application Insights", None, "application-insights"),
        ("kv", "Key Vault", None, "key-vault"),
    )):
        s.node(key, cx, 874, name, caption, icon, w=130 if key == "geocatalog" else 124)
    governance(s, "gov-prod", 616, STRIP_Y)

    # ----- Microsoft Fabric tenant (SaaS) ----------------------------------------------------
    s.zone("fabric", RX, ROW2, RW, 334, "Microsoft Fabric tenant · SaaS", icon="fabric")
    s.boundary("ws", RX + 16, 544, RW - 32, 272, "OneGrid workspace")
    s.node("eventhouse", C1, 588, "Eventhouse", "KQL database", "event-house", w=130)
    s.node("lakehouse", C2, 588, "Lakehouse", "asset model", "lakehouse", w=130)
    s.node("semantic", C1, 716, "Semantic model", "Import mode", "semantic-model", w=130)
    s.node("onelake", C2, 716, "OneLake", None, "one-lake", w=130)
    cap = s.port("capacity", "r")
    s.flow("capacity-ws", "capacity", "ws", [cap, (1425, cap[1]), (1425, 692), (RX + 16, 692)], "request")

    # ----- H  platform automation and DevOps --------------------------------------------------
    s.zone("devops", RX, 856, RW, 244, "Automation and DevOps")
    s.node("bicep", C1, 902, "Bicep and ARM", "resource group scope", "resource-group", w=130)
    s.node("provisioner", C2, 902, "Provisioner", "PowerShell scripts", "glyph:document", w=130)
    s.node("repo", C1, 1002, "GitHub repository", "release package", "glyph:database", w=130)
    s.node("wizard", C2, 1002, "Deploy wizard", "localhost web UI", "glyph:globe", w=130)
    s.flow("d-release", "repo", "wizard", kind="request")
    s.flow("d-scripts", "bicep", "provisioner", kind="request")
    s.flow("d-deploy", "bicep", "rg", [s.port("bicep", "l"), (586 + 808, s.port("bicep", "l")[1])], "request")
    s.flow("d-fabric", "provisioner", "ws", [s.port("provisioner", "t"), (C2, 544 + 272)], "request")

    # ----- F  management subscription -------------------------------------------------------
    s.subscription("mgmt", LX, ROW3, LW, ROW2 + 573 - ROW3, "Management subscription")
    s.node("la-central", 112, 870, "Log Analytics", "platform logs", "log-analytics", w=108)
    s.node("monitor", 224, 870, "Monitor", "alerts", "monitor", w=108)
    s.node("defender", 336, 870, ["Defender", "for Cloud"], "security posture", "defender-for-cloud", w=108)
    s.node("automation", 448, 870, "Automation", None, "automation", w=108)
    governance(s, "gov-mgmt", STRIP_L, STRIP_Y)

    # ----- identity subscription ---------------------------------------------------------------
    s.subscription("idsub", LX, ROW4, LW, 226, "Identity subscription")
    s.node("domain", 280, ROW4 + 52, "Domain services", "if used", "entra-id", w=130, optional=True)
    governance(s, "gov-id", STRIP_L, ROW4 + 154)

    # ----- OneGrid non-production subscription ---------------------------------------------------
    s.subscription("nonprod", MX, ROW4, MW, 146, "OneGrid non-production", note="Corp or Online")
    s.node("dev", 664, ROW4 + 48, "Development", "own resource group", "resource-group", w=124)
    s.node("test", 794, ROW4 + 48, "Test", "own resource group", "resource-group", w=124)
    governance(s, "gov-nonprod", 900, ROW4 + 58)

    # ----- design areas (enterprise-landing-zone.md, "Landing zone design decisions") -------------
    s.step("A", LX, TOP)            # billing and Microsoft Entra tenant
    s.step("B", RX, TOP)            # identity and access management
    s.step("C", MX, TOP)            # resource organization
    s.step("D", LX, ROW2)           # network topology and connectivity
    s.step("E", 336, 856)           # security
    s.step("F", LX, ROW3)           # management
    s.step("G", 594, STRIP_Y + 12)  # governance
    s.step("H", RX, 856)            # platform automation and DevOps
    return s
