"""DNS and private endpoints, drawn in Azure Architecture Center style.

Workload clients and corporate DNS query the hub resolver's inbound endpoint. Private
service names resolve from the private DNS zones linked to the hub; customer namespaces
match the forwarding ruleset and leave through the outbound endpoint to corporate DNS.
Numbered markers match the name resolution flow in
docs/architecture/enterprise-landing-zone.md; zone names and caveats live there."""

from diagram_engine import Sheet

LABEL = "DNS and private endpoints"
SUMMARY = ("Workload and corporate clients resolve original service names through the hub resolver: "
           "private zones for Azure services, a forwarding ruleset for customer domains")

# Columns
CORP_X, CORP_W, CORP_CX = 40, 200, 140
HUB_X, HUB_W = 290, 710
SUB_X, SUB_W = 310, 450               # resolver subnets
RES_CX = SUB_X + SUB_W / 2            # inbound and outbound endpoints
LINK_CX = 880                         # zones and ruleset, linked to the hub VNet
CH = 1025                             # channel between the hub and the workload VNet
WL_X, WL_W = 1050, 510
WSUB_X, WSUB_W = 1070, 470
CLIENT_CX = 1226

# Rows
TOP = 120
LINK_Y = 172                          # private DNS zones and corporate clients (icon tops)
IN_Y = 256                            # inbound subnet and app integration subnet
OUT_Y = 476                           # outbound subnet and job environment subnet
SUB_H = 144
PE_Y, PE_H = 696, 128                 # private endpoint subnet
HUB_BOTTOM = OUT_Y + SUB_H + 20
WL_BOTTOM = PE_Y + PE_H + 20


def build():
    s = Sheet(
        "onegrid-reference-dns",
        "OneGrid · DNS and private endpoints",
        "OneGrid DNS and private endpoints",
        "Workload and corporate clients resolve original service hostnames through the hub resolver "
        "to private endpoint addresses.",
        width=1600, height=WL_BOTTOM + 60, style="learn",
    )
    s.footnote = ("Example CIDRs and IPs are design allocations. Numbered steps match the name resolution "
                  "flow in enterprise-landing-zone.md.")

    # ----- corporate network --------------------------------------------------------
    s.boundary("corp", CORP_X, TOP, CORP_W, HUB_BOTTOM - TOP, "Corporate network", dashed=True)
    s.node("clients", CORP_CX, LINK_Y, "Corporate clients", "browsers, runners", "users", w=150)
    s.node("corp-dns", CORP_CX, IN_Y + 48, "Corporate DNS", "forwarders", "glyph:network", w=150)

    # ----- hub VNet -----------------------------------------------------------------
    s.boundary("hub", HUB_X, TOP, HUB_W, HUB_BOTTOM - TOP, "Hub VNet", "10.10.0.0/16", icon="virtual-network")
    s.boundary("snet-in", SUB_X, IN_Y, SUB_W, SUB_H, "DNS inbound",
               "10.10.1.0/28 · Microsoft.Network/dnsResolvers")
    s.node("inbound", RES_CX, IN_Y + 48, "Inbound endpoint", "10.10.1.4", "dns-private-resolver", w=150)
    s.boundary("snet-out", SUB_X, OUT_Y, SUB_W, SUB_H, "DNS outbound",
               "10.10.1.16/28 · Microsoft.Network/dnsResolvers")
    s.node("outbound", RES_CX, OUT_Y + 48, "Outbound endpoint", None, "dns-private-resolver", w=150)
    s.node("zones", LINK_CX, LINK_Y, "Private DNS zones", "privatelink.*", "glyph:database", w=170)
    s.node("ruleset", LINK_CX, OUT_Y + 48, "Forwarding ruleset", "customer domains", "glyph:document", w=170)

    # ----- workload VNet ------------------------------------------------------------
    s.boundary("vnet", WL_X, TOP, WL_W, WL_BOTTOM - TOP, "Workload VNet",
               "10.20.0.0/16 · DNS server 10.10.1.4", icon="virtual-network")
    s.boundary("snet-int", WSUB_X, IN_Y, WSUB_W, SUB_H, "App integration",
               "10.20.2.0/26 · Microsoft.Web/serverFarms")
    s.node("app", CLIENT_CX, IN_Y + 48, "App Service", "VNet integration", "app-service", w=130)
    s.boundary("snet-job", WSUB_X, OUT_Y, WSUB_W, SUB_H, "Job environment",
               "10.20.4.0/23 · Microsoft.App/environments")
    s.node("job", CLIENT_CX, OUT_Y + 48, "Forecast job", "Container Apps", "container-apps-job", w=130)
    s.boundary("snet-pe", WSUB_X, PE_Y, WSUB_W, PE_H, "Private endpoints", "10.20.1.0/24")
    step = WSUB_W / 6
    for i, (key, name) in enumerate((("pe-app", "App Service"), ("pe-blob", "Blob"), ("pe-openai", "Foundry"),
                                     ("pe-fabric", "Fabric"), ("pe-ml", "Azure ML"), ("pe-acr", "ACR"))):
        s.node(key, WSUB_X + step * (i + 0.5), PE_Y + 48, name, None, "private-endpoint", w=76)

    # ----- flows --------------------------------------------------------------------
    inb_l, inb_r = s.port("inbound", "l"), s.port("inbound", "r")
    # Private Azure service lookup
    s.flow("app-query", "snet-int", "inbound", [(WSUB_X, inb_r[1]), inb_r], "request")
    s.flow("job-query", "snet-job", "inbound",
           [(WSUB_X, OUT_Y + 24), (CH, OUT_Y + 24), (CH, inb_r[1] + 16), (inb_r[0], inb_r[1] + 16)], "request")
    s.flow("hybrid", "clients", "corp-dns", [s.port("clients", "b"), s.port("corp-dns", "t")], "request")
    s.flow("conditional", "corp-dns", "inbound", [s.port("corp-dns", "r"), inb_l], "request", label="DNS 53")
    zones_b = s.port("zones", "b")
    s.flow("zone-lookup", "inbound", "zones",
           [(inb_r[0], inb_r[1] - 16), (LINK_CX, inb_r[1] - 16), zones_b], "request")
    app_r = s.port("app", "r")
    s.flow("app-connect", "app", "snet-pe", [app_r, (1462, app_r[1]), (1462, PE_Y)], "request",
           label="TCP 443", at=(1470, 440), anchor="start")
    s.flow("job-connect", "job", "snet-pe", [s.port("job", "b"), (CLIENT_CX, PE_Y)], "request")
    # Customer namespace lookup
    inb_b = s.port("inbound", "b")
    s.flow("rule-match", "inbound", "ruleset",
           [inb_b, (RES_CX, 438), (LINK_CX, 438), s.port("ruleset", "t")], "request")
    s.flow("forward", "ruleset", "outbound", sides=("l", "r"), kind="request", label="Forward")
    out_l = s.port("outbound", "l")
    s.flow("upstream", "outbound", "corp-dns", [out_l, (CORP_CX, out_l[1]), s.port("corp-dns", "b")],
           "request", label="DNS 53", at=(CORP_CX + 8, 470), anchor="start")

    # Numbered flow (enterprise-landing-zone.md "Name resolution flow" steps 1-6)
    s.step(1, 960, inb_r[1])
    s.step(1, CH, 420)
    s.step(2, 265, inb_l[1])
    s.step(3, LINK_CX, 281)
    s.step(4, 1462, 640)
    s.step(5, 720, 438)
    s.step(6, 265, out_l[1])
    return s
