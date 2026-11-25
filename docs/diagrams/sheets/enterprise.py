"""Enterprise networking, drawn in Azure Architecture Center style.

Hub VNet (resolver endpoints and firewall), workload VNet (ingress, app integration,
job environment and private endpoint subnets), the service-hosted targets with each
private endpoint straight across from its service, and the approved public endpoints
behind the firewall. Numbered markers match the Workflow list in
docs/architecture/enterprise-landing-zone.md; ports, roles and caveats live there."""

from diagram_engine import Sheet

LABEL = "Enterprise networking"
SUMMARY = ("Hub and workload VNets with each subnet, a private endpoint beside every service-hosted "
           "target, UDR egress through the hub firewall and DNS to the resolver")

# Columns
HUB_X, HUB_W = 40, 320            # hub VNet
HUB_SX, HUB_SW = 60, 280          # hub subnets
HUB_CX = 200
GAP_X = 380                       # channel between the hub and the workload VNet
VNET_X, VNET_W = 400, 826         # workload VNet
CALL_X, CALL_W = 420, 440         # ingress, app integration and job subnets
CALL_CX = 700
CH = 895                          # channel between the caller subnets and the endpoints
PE_X, PE_W = 930, 276             # private endpoint subnet
PE_CX = PE_X + PE_W / 2
ZONE_X, ZONE_W = 1260, 300        # service-hosted targets
SVC_CX = ZONE_X + ZONE_W / 2

# Rows (icon tops); each private endpoint shares its service's row.
USERS = 110
TOP = 226                         # VNet and zone top edge
ROWS = {"app": 320, "openai": 474, "fabric": 574, "blob": 674, "ml": 774, "acr": 874}
MID = {k: v + 22 for k, v in ROWS.items()}
BOTTOM = 990                      # VNet and zone bottom edge
INT_Y, INT_H = 436, 284           # app integration subnet
JOB_Y, JOB_H = 740, 190           # job environment subnet
PUB_Y = 1020                      # approved public endpoints


def build():
    s = Sheet(
        "onegrid-reference-enterprise",
        "OneGrid · enterprise networking",
        "OneGrid enterprise network",
        "Enterprise addition: hub and spoke networking, a private endpoint per service-hosted "
        "dependency, and firewall-controlled egress.",
        width=1600, height=1210, style="learn",
    )
    s.footnote = ("Example CIDRs are design allocations. Numbered steps match the Workflow in "
                  "enterprise-landing-zone.md.")

    # ----- users ------------------------------------------------------------------
    s.node("users", CALL_CX, USERS, "OneGrid users", "browser", "users", w=130)
    s.node("maps", 900, USERS, "Map tiles", "Azure Maps, Esri", "azure-maps", w=130)

    # ----- hub VNet -----------------------------------------------------------------
    s.boundary("hub", HUB_X, TOP, HUB_W, BOTTOM - TOP, "Hub VNet", "10.10.0.0/16", icon="virtual-network")
    s.boundary("snet-dns-in", HUB_SX, 272, HUB_SW, 144, "DNS inbound", "10.10.1.0/28")
    s.node("dns-in", HUB_CX, 320, "Inbound endpoint", "10.10.1.4", "dns-private-resolver", w=130)
    s.boundary("snet-dns-out", HUB_SX, 508, HUB_SW, 144, "DNS outbound", "10.10.1.16/28")
    s.node("dns-out", HUB_CX, 556, "Outbound endpoint", None, "dns-private-resolver", w=130)
    s.boundary("snet-fw", HUB_SX, JOB_Y, HUB_SW, 144, "AzureFirewallSubnet", "10.10.0.0/26")
    s.node("firewall", HUB_CX, JOB_Y + 48, "Azure Firewall", "10.10.0.4", "firewall", w=130)

    # ----- workload VNet ------------------------------------------------------------
    s.boundary("vnet", VNET_X, TOP, VNET_W, BOTTOM - TOP, "Workload VNet", "10.20.0.0/16",
               icon="virtual-network")
    s.boundary("snet-ingress", CALL_X, 272, CALL_W, 144, "Ingress", "10.20.0.0/24")
    s.node("gateway", CALL_CX, ROWS["app"], "Application Gateway", "WAF", "application-gateway", w=150)
    s.boundary("snet-int", CALL_X, INT_Y, CALL_W, INT_H, "App integration",
               "10.20.2.0/26 · Microsoft.Web/serverFarms")
    s.node("integration", CALL_CX, INT_Y + INT_H / 2 - 40, "VNet integration", "outbound only", "virtual-network", w=130)
    s.boundary("snet-job", CALL_X, JOB_Y, CALL_W, JOB_H, "Job environment",
               "10.20.4.0/23 · Microsoft.App/environments")
    s.node("job", CALL_CX, JOB_Y + 48, "Forecast job", "Container Apps", "container-apps-job", w=130)
    s.boundary("snet-pe", PE_X, 272, PE_W, 698, "Private endpoints", "10.20.1.0/24")

    # ----- service-hosted targets, each with its private endpoint ---------------------
    s.zone("hosted", ZONE_X, TOP, ZONE_W, BOTTOM - TOP, "Azure and Fabric services", icon="resource-group")
    services = (
        ("app", "App Service", "OneGrid web app", "app-service", "sites"),
        ("openai", "Azure OpenAI", "language model", "azure-openai", "account"),
        ("fabric", "Microsoft Fabric", "KQL, DAX, agent", "fabric", "tenant"),
        ("blob", "Blob storage", "package and data", "blob-storage", "blob"),
        ("ml", "Azure Machine Learning", "Aurora endpoint", "machine-learning", "amlworkspace"),
        ("acr", "Container Registry", "Premium", "container-registry", "registry"),
    )
    for key, name, caption, icon, subresource in services:
        s.node(key + "-pe", PE_CX, ROWS[key], "Private endpoint", subresource, "private-endpoint", w=130)
        s.node(key, SVC_CX, ROWS[key], name, caption, icon, w=180)
        s.flow("pe-" + key, key + "-pe", key, kind="request")

    # ----- approved public endpoints ------------------------------------------------
    s.boundary("public", 40, PUB_Y, 820, 144, "Approved public endpoints", dashed=True)
    for i, (key, name, caption, icon) in enumerate((
        ("weather", "Weather sources", "NOAA, NHC, HF", "glyph:globe"),
        ("arm", "Azure Resource Manager", "job start", "resource-group"),
        ("entra", "Microsoft Entra ID", "sign-in, tokens", "entra-id"),
        ("geocatalog", "GeoCatalog", "STAC API", "geocatalog"),
    )):
        s.node(key, 142 + i * 205, PUB_Y + 48, name, caption, icon, w=170)

    # ----- flows --------------------------------------------------------------------
    # Ingress: users -> gateway -> App Service private endpoint -> App Service
    s.flow("ingress", "users", "gateway", [s.port("users", "b"), s.port("gateway", "t")], "request",
           label="HTTPS 443", at=(CALL_CX + 8, 252), anchor="start")
    s.flow("origin", "gateway", "app-pe", kind="request")
    s.flow("maps-direct", "users", "maps", kind="request")

    # App Service outbound through its integration subnet
    out_y = 428
    s.flow("app-out", "app", "snet-int",
           [s.port("app", "b"), (SVC_CX, out_y), (CH, out_y), (CH, 460), (CALL_X + CALL_W, 460)], "request")
    right = CALL_X + CALL_W
    for key in ("openai", "fabric"):
        s.flow("int-" + key, "snet-int", key + "-pe", [(right, MID[key]), s.port(key + "-pe", "l")], "request")
    s.flow("int-blob", "snet-int", "blob-pe", [(right, MID["blob"] - 6), s.port("blob-pe", "l", -6)], "request")

    # Forecast job to its private endpoints
    s.flow("job-blob", "snet-job", "blob-pe",
           [(right, JOB_Y + 20), (CH, JOB_Y + 20), (CH, MID["blob"] + 6), s.port("blob-pe", "l", 6)], "request")
    s.flow("job-ml", "snet-job", "ml-pe", [(right, MID["ml"]), s.port("ml-pe", "l")], "request",
           label="Score")
    s.flow("job-acr", "snet-job", "acr-pe", [(right, MID["acr"]), s.port("acr-pe", "l")], "request",
           label="Pull")

    # DNS and egress through the hub
    s.flow("dns", "vnet", "dns-in", [(VNET_X, MID["app"]), s.port("dns-in", "r")], "request", label="DNS 53")
    fw = s.port("firewall", "r")
    s.flow("udr-app", "snet-int", "firewall",
           [(CALL_X, INT_Y + INT_H - 20), (GAP_X, INT_Y + INT_H - 20), (GAP_X, fw[1] - 12), (fw[0], fw[1] - 12)],
           "request")
    s.flow("udr-job", "snet-job", "firewall", [(CALL_X, fw[1] + 12), (fw[0], fw[1] + 12)], "request",
           label="UDR 0/0", at=(300, fw[1] + 30))
    s.flow("allow", "firewall", "public", [s.port("firewall", "b"), (HUB_CX, PUB_Y)], "request",
           label="Allowlist", at=(HUB_CX + 10, PUB_Y - 10), anchor="start")
    s.flow("peering", "hub", "vnet", [(HUB_X + HUB_W, 246), (VNET_X, 246)], "control", both=True,
           label="Peering", at=(GAP_X, 216))

    # Numbered workflow (enterprise-landing-zone.md "Workflow" steps 1-8)
    s.step(1, CALL_CX, 208)
    s.step(2, CH, MID["app"])
    s.step(3, 1243, out_y)
    s.step(4, GAP_X, MID["app"])
    s.step(5, CH, MID["openai"])
    s.step(6, CH, MID["ml"])
    s.step(7, HUB_CX, 940)
    s.step(8, 800, USERS + 22)
    return s
