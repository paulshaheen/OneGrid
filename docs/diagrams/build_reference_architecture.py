"""Build detailed OneGrid reference drawings; export images with draw.io Desktop."""

import argparse
from hashlib import sha256
from html import escape
import json
from pathlib import Path
import subprocess
import tempfile
import xml.etree.ElementTree as ET

import build_architecture_diagrams as drawing


HERE = Path(__file__).resolve().parent
LABELS = (
    "Baseline", "Fabric", "Enterprise networking", "DNS and private endpoints",
    "Weather orchestration", "Identity and authorization", "Logging and monitoring",
    "Regulated workload", "Multiregion recovery",
)


def page(name, title, description, height=2300):
    return drawing.Scene("onegrid-reference-" + name, title, description, height)


def node(scene, id, x, y, w, h, title, body, icon="", parent="1"):
    return scene.node(id, x, y, w, h, title, body, icon, parent)


def wire(scene, id, source, target, kind="request", ports=("right", "left"),
         via=None, dashed=False):
    items = {item.id: item for item in scene.items}

    def port(item, side):
        return {
            "left": (item.x, item.y + item.h // 2),
            "right": (item.x + item.w, item.y + item.h // 2),
            "top": (item.x + item.w // 2, item.y),
            "bottom": (item.x + item.w // 2, item.y + item.h),
        }[side]

    start, end = port(items[source], ports[0]), port(items[target], ports[1])
    if via is None:
        if start[0] == end[0] or start[1] == end[1]:
            via = []
        elif ports[0] in ("left", "right") and ports[1] in ("left", "right"):
            middle = (start[0] + end[0]) // 2
            via = [(middle, start[1]), (middle, end[1])]
        else:
            middle = (start[1] + end[1]) // 2
            via = [(start[0], middle), (end[0], middle)]
    scene.edge(id, source, target, [start, *via, end], kind, dashed=dashed)


def note(scene, id, y, title, body):
    scene.box(id, 40, y, 2320, 130, title, body)


def baseline():
    s = page("baseline", "OneGrid - deployed baseline and end-to-end traffic",
             "TEMPLATE + RUNTIME CONTRACT | Public service endpoints with authentication; private enterprise networking is an additional implementation.", 2440)
    s.box("sources", 40, 190, 330, 1750, "Customer / public inputs",
          "Source-specific access.", dashed=True)
    for id, y, title, body in (
        ("connector", 330, "Operational connector", "PI / historian / SCADA\nCertificate-based Entra authentication\nDurable outbox / checkpoints\nAMQP over WSS TCP 443; optional AMQP/TLS 5671"),
        ("business", 690, "Business and history", "AIMM / iCare / GADS / CMMS\nAsset register and work history\nApproved ingestion / source permissions"),
        ("noaa", 1430, "NOAA and weather feeds", "GFS f000 analyses over HTTPS 443\nTwo snapshots six hours apart\nNHC storm names / positions\nHuggingFace static weather fields"),
        ("imagery", 1740, "Customer imagery / GIS", "COG / STAC imagery and asset locations\nImagery ingestion is separate from weather-model inputs"),
    ):
        node(s, id, 65, y, 280, 220 if id != "imagery" else 170, title, body, parent="sources")
    s.box("fabric", 420, 190, 1020, 1120, "Microsoft Fabric - service-hosted workspace",
          "Provisioned items and actual item IDs; not deployed inside a customer VNet.", icon="fabric")
    for args in (
        ("stream", 460, 330, 400, 220, "Eventstream: PIForwarderEndpoint", "Custom source -> mapped Eventhouse destination\nProcessedIngestion\nPublish / rebind before producers", "eventstream"),
        ("eventhouse", 960, 330, 440, 220, "Eventhouse / KQL", "PiEventsRaw -> update policy -> PiEvents\nPCIOutages / spatial functions\nApplication queries: HTTPS 443\nSeparate item/database permissions", "event-house"),
        ("lake", 460, 690, 400, 200, "OneLake / Lakehouse", "Source tables + conformed asset keys\nReliability / work / weather tables\nNo automatic Eventhouse replication", "lakehouse"),
        ("notebooks", 960, 690, 440, 200, "Notebooks + Prediction_Pipeline", "Prepare -> features -> model/scoring\nPersist predictions and narratives\nRun identity / source permissions", "notebook"),
        ("sql", 460, 1000, 400, 170, "SQL analytics endpoint", "Lakehouse serving endpoint; not Azure SQL DB\nEncrypted TDS TCP 1433\nDedicated refresh service principal", "lakehouse"),
        ("semantic", 960, 1000, 440, 170, "OneGridModelImport", "Import mode; refresh after source changes\nApp DAX: HTTPS 443\nNot Direct Lake / not streaming", "semantic-model"),
        ("ontology", 460, 1210, 400, 80, "OneGridOntology", "Native Fabric Digital Twin Builder item", "fabric"),
        ("agent", 960, 1210, 440, 80, "Data Agent (optional)", "Grounded on the semantic model; HTTPS 443", "data-agent"),
    ):
        node(s, *args, parent="fabric")
    s.box("app-plane", 1490, 190, 870, 1120, "Application and browser boundary",
          "User sign-in, workload authorization, and browser-originated map traffic are different paths.")
    node(s, "users", 1520, 330, 360, 140, "User browser", "HTTPS / WebSocket 443\nPublished app host", "users", "app-plane")
    node(s, "entra", 1940, 330, 390, 140, "Microsoft Entra ID", "OIDC sign-in / application registration\nUser identity is not automatic data filtering", "entra-id", "app-plane")
    node(s, "app", 1520, 590, 810, 250, "Azure App Service - OneGrid",
         "Linux / Node 22; HTTPS-only; minimum TLS 1.2\nReport BFF + React SSR + Node AI agent; internal port 8080\nSystem-assigned managed identity\nBlob Data Contributor on sample storage; GeoCatalog Administrator\nFabric/KQL/model permissions configured by provisioner", "app-service", "app-plane")
    node(s, "openai", 1520, 980, 380, 190, "Azure OpenAI account", "HTTPS 443 / deployed model API\nEntra token or configured API key\nBaseline publicNetworkAccess = Enabled\nNo separately required Foundry project", "azure-openai", "app-plane")
    node(s, "arm", 1960, 980, 370, 190, "Azure Resource Manager", "management.azure.com / HTTPS 443\nApp starts / reads forecast job\nContainer Apps Jobs Operator at job scope\nNot an app-to-Aurora scoring call", "resource-group", "app-plane")
    node(s, "maps", 1520, 1210, 810, 80, "Browser maps / glyphs", "Direct browser HTTPS to Azure Maps / Esri / MapLibre; not App Service outbound routing.", parent="app-plane")
    s.box("weather", 420, 1390, 1020, 550, "Weather execution",
          "CPU job coordinates; Azure ML GPU predicts. See the dedicated weather sheet.")
    node(s, "job", 460, 1520, 400, 230, "Container Apps Job", "2 vCPU / 4 GiB; no inbound HTTP listener\nCron 01 / 07 / 13 / 19 UTC\nOwn user-assigned managed identity\n20 six-hour steps = 120 h from analysis time\nRegistry pull + NOAA/HF/NHC + Blob + ML", "container-apps-job", "weather")
    node(s, "ml", 960, 1520, 440, 230, "Azure ML Aurora endpoint", "authMode = AADToken; HTTPS 443\nSeparate healthy GPU deployment required\nDefault Standard_NC24ads_A100_v4\nWorkspace storage / Key Vault / App Insights\nModel terms and GPU quota are prerequisites", "machine-learning", "weather")
    node(s, "channel", 460, 1810, 400, 110, "Blob: aurora-channel", "Large inputs / predictions\nJob-minted user-delegation SAS", "blob-storage", "weather")
    node(s, "outputs", 960, 1810, 440, 110, "Blob: model-outputs", "weather-events.json + generation / analysis timestamps\nApp reads; optional Fabric shortcut", "blob-storage", "weather")
    s.box("geo", 1490, 1390, 870, 550, "Geospatial and package storage",
          "Blob containers prohibit anonymous reads. That is not private network isolation.")
    node(s, "blob", 1520, 1520, 380, 230, "Sample storage account", "Standard_LRS / HTTPS-only / TLS 1.2\nsample-assets / app package / outputs / channel\nPrivate container access; identity-based app access\nBaseline does not deploy private endpoints", "blob-storage", "geo")
    node(s, "catalog", 1960, 1520, 370, 230, "Planetary Computer Pro", "GeoCatalog STAC / search / tiles: HTTPS 443\nAssociated ingestion identity reads source Blob\nIngestion copies/catalogs imagery\nGeoCatalog Reader / Administrator are separate roles", "geocatalog", "geo")
    node(s, "package", 1520, 1810, 810, 110, "App package bootstrap", "Initial GitHub release URL -> provisioner uploads verified onegrid-app.zip -> private Blob package URL + app identity. Validate restart access.", "app-service", "geo")
    note(s, "deployment", 2000, "Deployment and identity boundary",
         "ARM/Bicep creates Azure resources; deployment scripts provision Fabric items and grants. Provisioner privileges are separate from runtime identities. Existing ACR/build and external package paths need explicit network access.")
    note(s, "baseline-acceptance", 2150, "Acceptance - source-reviewed design, not a live connectivity attestation",
         "Verify sign-in + WebSocket, KQL, DAX, actual model call, source acknowledgment, Blob package restart, GeoCatalog ingestion, forecast freshness, and denied unauthorized requests. A resource existing does not prove its data path works.")
    wire(s, "B01-publish", "connector", "stream", "data")
    wire(s, "B02-processed", "stream", "eventhouse", "data")
    wire(s, "B03-business", "business", "lake", "data")
    wire(s, "B04-features", "lake", "notebooks", "data")
    wire(s, "B05-sql", "lake", "sql", "data", ("bottom", "top"))
    wire(s, "B06-refresh", "sql", "semantic", "data")
    wire(s, "B07-agent-model", "agent", "semantic", ports=("top", "bottom"))
    wire(s, "B08-users", "users", "app", ports=("bottom", "top"),
         via=[(1700, 530), (1925, 530)])
    wire(s, "B09-signin", "entra", "app", "identity", ("bottom", "top"),
         via=[(2135, 550), (1925, 550)])
    wire(s, "B10-kql", "app", "eventhouse", ports=("left", "right"),
         via=[(1460, 715), (1460, 440)])
    s.edge("B11-dax", "app", "semantic", [(1520, 780), (1470, 780), (1470, 1085), (1400, 1085)])
    s.edge("B12-agent", "app", "agent", [(1520, 810), (1480, 810), (1480, 1250), (1400, 1250)])
    s.edge("B13-openai", "app", "openai", [(1710, 840), (1710, 980)])
    s.edge("B14-arm", "app", "arm", [(2145, 840), (2145, 980)], "control")
    s.edge("B15-weather-input", "job", "noaa", [(460, 1635), (395, 1635), (395, 1540), (345, 1540)])
    wire(s, "B16-inference", "job", "ml")
    wire(s, "B17-job-channel", "job", "channel", "data", ("bottom", "top"))
    s.edge("B18-ml-channel", "ml", "channel", [(1180, 1750), (1180, 1780), (660, 1780), (660, 1810)], "data")
    s.edge("B19-publish", "job", "outputs", [(860, 1690), (910, 1690), (910, 1865), (960, 1865)], "data")
    s.edge("B20-read-weather", "app", "outputs", [(2330, 800), (2360, 800), (2360, 1960), (1460, 1960), (1460, 1865), (1400, 1865)])
    s.edge("B21-imagery", "imagery", "blob", [(345, 1825), (390, 1825), (390, 1960), (1450, 1960), (1450, 1635), (1520, 1635)], "data")
    wire(s, "B22-catalog-read", "catalog", "blob", ports=("left", "right"))
    s.edge("B23-catalog-api", "app", "catalog", [(2330, 740), (2350, 740), (2350, 1635), (2330, 1635)])
    s.edge("B24-blob-api", "app", "blob", [(1520, 670), (1480, 670), (1480, 1635), (1520, 1635)])
    s.edge("B25-arm-job-start", "arm", "job", [(2330, 1090), (2390, 1090), (2390, 1370), (1460, 1370), (1460, 1495), (900, 1495), (900, 1635), (860, 1635)], "control")
    s.edge("B26-score-write", "notebooks", "lake", [(1180, 890), (1180, 940), (660, 940), (660, 890)], "data")
    s.edge("B27-ontology-binding", "ontology", "lake", [(660, 1210), (660, 1190), (440, 1190), (440, 790), (460, 790)], "control")
    s.edge("B28-shortcut", "lake", "outputs", [(460, 790), (445, 790), (445, 1345), (1450, 1345), (1450, 1865), (1400, 1865)], dashed=True)
    s.edge("B29-browser-maps", "users", "maps", [(1520, 400), (1450, 400), (1450, 1335), (1925, 1335), (1925, 1290)])
    return s


def fabric():
    s = page("fabric", "OneGrid - Fabric ingestion, serving and source security",
             "ACTUAL ITEM CONTRACTS | Fabric is SaaS. Client Private Link, source connectivity, refresh credentials, and item permissions are independent.", 2300)
    s.box("producer-zone", 40, 190, 400, 1490, "Source / connected client", "Customer-controlled connector and administrative network.", dashed=True)
    node(s, "producer", 70, 350, 340, 220, "PI / DB forwarder", "Client certificate -> Entra token\nWSS/AMQP TCP 443 by default\nNative AMQP/TLS 5671 is optional\nConnection string path is test-only\nOutbox retains unacknowledged events", parent="producer-zone")
    node(s, "business", 70, 850, 340, 220, "Business source load", "Approved source read / batch ingestion\nAIMM / iCare / GADS / assets / CMMS\nSource freshness and quality checked separately", parent="producer-zone")
    node(s, "sql-client", 70, 1400, 340, 220, "Connected SQL client", "Lakehouse SQL hostname from item\nEncrypted TDS TCP 1433\nSQL-aware firewall handling; not HTTPS", parent="producer-zone")
    s.box("workspace", 500, 190, 1310, 1490, "Fabric capacity / OneGrid workspace",
          "Tenant-level Private Link for this combined semantic-model workspace; use actual service-generated endpoint DNS.", icon="fabric")
    for args in (
        ("stream", 540, 350, 500, 220, "Eventstream custom source", "PIForwarderEndpoint\nDestination/mapping must be published\nProcessedIngestion stays enabled\nValidate actual broker namespace / source auth", "eventstream"),
        ("eventhouse", 1170, 350, 600, 220, "Eventhouse / KQL database", "PiEventsRaw -> update policy -> PiEvents\nPCIOutages / KQL functions\nData access follows KQL database permissions\nNot an automatic Lakehouse replication source", "event-house"),
        ("lake", 540, 850, 500, 220, "Lakehouse / conformed asset model", "dim_site -> dim_unit -> dim_asset -> dim_tag\nHealth / predictions / work / weather tables\nWeatherForecast case is significant\nSource/table permissions and quality rules", "lakehouse"),
        ("pipeline", 1170, 850, 600, 220, "Prediction_Pipeline + notebooks", "Preparation -> features -> anomaly / Cox / survival\nPersist scored tables and narrative\nNotebook identity and source connections\nWorkflow schedule / completion / data-age evidence", "notebook"),
        ("sql", 540, 1400, 500, 220, "Lakehouse SQL analytics endpoint", "Metadata synchronization is separate from a refresh\nTDS TCP 1433 / actual database name\nRefresh identity needs SQL/table permissions\nNot another Azure SQL Database", "lakehouse"),
        ("import", 1170, 1400, 600, 220, "OneGridModelImport - Import mode", "Fabric encrypted connection + refresh service principal\nRefresh after curated table updates\nApp queries refreshed model with DAX / HTTPS 443\nShared app identity is not per-user row filtering", "semantic-model"),
    ):
        node(s, *args, parent="workspace")
    node(s, "app", 1870, 350, 490, 220, "OneGrid App Service", "DAX + KQL + Data Agent calls: HTTPS 443\nActual workspace / dataset / agent IDs\nSeparate permissions for each API\nNo app-to-SQL dependency in this design", "app-service")
    node(s, "agent", 1870, 850, 490, 220, "Data Agent (optional)", "OneGridOntologyAgent\nConfigured semantic-model datasource\nPrivate connectivity follows supported source path\nNot the native ontology item", "data-agent")
    node(s, "ontology", 1870, 1400, 490, 220, "Digital Twin Builder", "OneGridOntology / table-backed entities\nExplicit table binding and item permissions\nNo separate Azure Digital Twins instance", "fabric")
    node(s, "shortcut", 540, 1780, 1230, 200, "Optional OneLake shortcut: pcp_model_outputs",
         "Requires a real Fabric cloud connection ID and reachable source endpoint; granting a deployment identity Blob Reader is not enough.\nSupplied Blob connection OR optional workspace-identity ADLS Gen2 connection; ADLS requires a compatible storage endpoint/configuration.\nBlob/DFS source network rules and access from Fabric must pass independently of client Private Link. Hazard-table transformation remains a separate step.", "blob-storage")
    note(s, "fabric-gates", 2030, "Acceptance and isolation gates",
         "Publish source -> confirm raw + curated row -> verify SQL metadata -> bind/refresh Import -> test real DAX/KQL/agent queries. No Eventhouse-to-Lakehouse copy is implied. Workspace-level Private Link cannot replace tenant-level access for this semantic-model workspace.")
    wire(s, "F01-source", "producer", "stream", "data")
    wire(s, "F02-destination", "stream", "eventhouse", "data")
    wire(s, "F03-load", "business", "lake", "data")
    wire(s, "F04-score", "lake", "pipeline", "data")
    wire(s, "F05-sql-metadata", "lake", "sql", "data", ("bottom", "top"))
    wire(s, "F06-refresh", "sql", "import", "data")
    wire(s, "F07-sql-client", "sql-client", "sql")
    wire(s, "F08-kql", "app", "eventhouse", ports=("left", "right"))
    s.edge("F09-dax", "app", "import", [(1870, 500), (1825, 500), (1825, 1325), (1470, 1325), (1470, 1400)])
    wire(s, "F10-agent", "app", "agent", ports=("bottom", "top"))
    s.edge("F11-agent-source", "agent", "import", [(1870, 960), (1840, 960), (1840, 1360), (1470, 1360), (1470, 1400)])
    s.edge("F12-ontology-bind", "ontology", "lake", [(2115, 1620), (2115, 1710), (480, 1710), (480, 960), (540, 960)], "control")
    wire(s, "F13-shortcut-read", "lake", "shortcut", ports=("left", "left"),
         via=[(470, 960), (470, 1880)], dashed=True)
    s.edge("F14-persist", "pipeline", "lake",
           [(1470, 1070), (1470, 1130), (790, 1130), (790, 1070)], "data")
    return s


def enterprise():
    s = page("enterprise", "OneGrid - enterprise network implementation blueprint",
             "ENTERPRISE ADDITIONS | Example CIDRs, not discovered Azure addresses. Baseline Bicep does not create these VNets, private endpoints, gateway or firewall.", 2300)
    s.box("hub", 40, 190, 450, 1340, "Connectivity hub - 10.10.0.0/16", "Platform-owned DNS, peering and egress.", icon="virtual-network")
    node(s, "dns-in", 70, 350, 390, 230, "DNS resolver inbound", "snet-dns-in: 10.10.1.0/28\nExample static IP: 10.10.1.4\nMicrosoft.Network/dnsResolvers delegation\nUDP/TCP 53 from approved clients\nPrivate zones linked to resolver VNet", "dns-private-resolver", "hub")
    node(s, "dns-out", 70, 670, 390, 220, "DNS resolver outbound", "snet-dns-out: 10.10.1.16/28\nSeparate delegated subnet; no inbound VIP\nForward only approved customer domains\nRuleset association is not a peering route", "dns-private-resolver", "hub")
    node(s, "firewall", 70, 1000, 390, 220, "Azure Firewall", "AzureFirewallSubnet: 10.10.0.0/26\nUDR next-hop example: 10.10.0.4\nApproved public FQDN / service dependencies\nPreserve platform/bootstrap requirements\nPE /32 route is not overridden by 0/0", "firewall", "hub")
    node(s, "peering", 70, 1330, 390, 160, "Hub / spoke connectivity", "Explicit peering and return paths\nNo implicit transitive peering\nHybrid access via approved ER / VPN\nNSG + route policy reviewed separately", "virtual-network", "hub")
    s.box("vnet", 540, 190, 1250, 1340, "OneGrid workload VNet - 10.20.0.0/16",
          "App Service compute remains outside the VNet. Container Apps has its own dedicated environment subnet.", icon="virtual-network")
    s.box("gateway-subnet", 570, 320, 480, 270, "Ingress - 10.20.0.0/24", "Dedicated Application Gateway subnet", parent="vnet")
    node(s, "gateway", 600, 410, 420, 150, "Application Gateway WAF", "HTTPS 443 / published custom host\nBackend host + TLS/SNI + custom probe\nWebSocket support and approved callback", "application-gateway", "gateway-subnet")
    s.box("app-pe-subnet", 1100, 320, 650, 270, "Private endpoints - 10.20.1.0/24", "NICs are private addresses; services stay hosted.", parent="vnet")
    node(s, "app-pe", 1130, 410, 590, 150, "App Service private endpoint", "Subresource: sites; SCM record if used\nprivatelink.azurewebsites.net\nInbound only; disable public origin after testing", "private-endpoint", "app-pe-subnet")
    s.box("integration-subnet", 570, 650, 480, 250, "App integration - 10.20.2.0/26", "Delegation: Microsoft.Web/serverFarms", parent="vnet")
    node(s, "integration", 600, 750, 420, 120, "App outbound interface", "outboundVnetRouting.allTraffic = true\nApplication + package/token configuration routing", "virtual-network", "integration-subnet")
    s.box("ca-subnet", 570, 980, 480, 470, "Job environment - 10.20.4.0/23", "Dedicated workload profiles environment\nDelegation: Microsoft.App/environments", parent="vnet")
    node(s, "job", 600, 1110, 420, 270, "Container Apps forecast job", "Separate managed identity / DNS / UDR\nNo inbound HTTP application endpoint\nHTTPS 443 to ML scoring / Blob / registry\nPublic egress for NOAA / NHC / HF\nCreate with VNet integration; not a later conversion\nDoes not use App Service integration subnet", "container-apps-job", "ca-subnet")
    s.box("dependency-subnet", 1100, 650, 650, 800, "Dependency private endpoint NICs",
          "Same example snet-pe /24; one service connection per target.", parent="vnet")
    dependencies = (
        ("blob", 770, "Blob private endpoint", "blob subresource / TCP 443\nPackage, assets, outputs, channel\nAdd DFS only for an ADLS path", "blob-storage"),
        ("openai", 910, "Azure OpenAI private endpoint", "account subresource / TCP 443\nOriginal account hostname + private DNS\nAuthorization still required", "azure-openai"),
        ("fabric", 1050, "Tenant Fabric private endpoint", "Actual PE DNS / KQL / DAX / API targets\nTCP 443; SQL client TDS 1433\nNot workspace-only Private Link", "fabric"),
        ("ml", 1190, "Azure ML workspace private endpoint", "amlworkspace / supplied scoring DNS\nJob -> scoring HTTPS 443\nManaged deployment egress is separate", "machine-learning"),
        ("acr", 1330, "ACR private endpoint", "Premium SKU / registry + data endpoints\nprivatelink.azurecr.io / TCP 443\nOwn runner path for image builds", "container-registry"),
    )
    s.box("service-hosted", 1840, 190, 520, 1340, "Azure / Fabric service-hosted compute",
          "A private endpoint is not a VM hosting these services.")
    node(s, "app", 1870, 390, 460, 190, "Azure App Service", "Outside integration subnet\nCustom domain + valid certificate\nPublic network access Disabled after acceptance\nWorkload identity + application authorization", "app-service", "service-hosted")
    for id, y, title, body, icon in dependencies:
        node(s, id + "-pe", 1130, y, 590, 120, title, body, "private-endpoint", "dependency-subnet")
        node(s, id, 1870, y, 460, 120, {
            "blob": "Azure Blob Storage", "openai": "Azure OpenAI", "fabric": "Microsoft Fabric",
            "ml": "Azure ML Aurora", "acr": "Container Registry Premium",
        }[id], {
            "blob": "Disable public access only after all callers pass.\nGeoCatalog and Fabric source access need their own solution.",
            "openai": "Cognitive Services OpenAI User / selected auth\nApproved model, quota and processing geography",
            "fabric": "Tenant Private Link; then block public access\nProcessedIngestion; source egress separate",
            "ml": "AADToken; workspace PE for inbound\nManaged-network egress to backing resources + channel",
            "acr": "Job identity AcrPull; build identity separately scoped\nBaseline auto-registry is Basic: promote SKU first",
        }[id], icon, "service-hosted")
        wire(s, "E-target-" + id, id + "-pe", id)
    node(s, "public", 570, 1610, 1760, 190, "Approved public dependencies - explicit firewall policy",
         "GeoCatalog API; management.azure.com; login.microsoftonline.com and required identity endpoints\nNOAA GFS S3; nhc.noaa.gov; HuggingFace and actual download/CDN hosts\nConnected build/bootstrap runner: GitHub release/source, image build dependencies and service control planes\nBrowser maps/glyphs leave the user's network directly, not the App Service or job subnet.", "firewall")
    note(s, "routes", 1850, "Route / DNS / security decisions",
         "App + job subnet 0.0.0.0/0 -> hub firewall for approved public egress. Private endpoint traffic normally follows its more-specific private route; inspection requires endpoint network policies + specific routes + symmetric return paths. DNS clients use 10.10.1.4 over reachable hub/spoke connectivity.")
    note(s, "enterprise-gates", 2010, "Source-access and release gates",
         "Customer Blob private endpoints alone do not give GeoCatalog or Fabric a source path. Select and test each service's supported source-access mechanism before public denial. Promote networking/SKUs in IaC, or baseline redeployment can reopen explicit public settings. Validate real calls, bootstrap and public-origin denial.")
    wire(s, "E01-ingress", "gateway", "app-pe")
    wire(s, "E02-origin", "app-pe", "app")
    s.edge("E03-app-outbound", "app", "integration", [(2100, 580), (2100, 620), (1075, 620), (1075, 775), (1020, 775)])
    wire(s, "E04-blob", "integration", "blob-pe",
         via=[(1070, 810), (1070, 830)])
    for id, y in (("openai", 970), ("fabric", 1110)):
        s.edge("E05-app-" + id, "integration", id + "-pe",
               [(1020, 840), (1080, 840), (1080, y), (1130, y)])
    s.edge("E06-job-scoring", "job", "ml-pe", [(1020, 1250), (1130, 1250)])
    s.edge("E07-job-blob", "job", "blob-pe", [(1020, 1150), (1060, 1150), (1060, 830), (1130, 830)])
    s.edge("E08-job-registry", "job", "acr-pe", [(1020, 1350), (1070, 1350), (1070, 1390), (1130, 1390)])
    s.edge("E09-app-egress", "integration", "firewall", [(600, 830), (520, 830), (520, 1110), (460, 1110)])
    s.edge("E10-job-egress", "job", "firewall", [(600, 1290), (510, 1290), (510, 1170), (460, 1170)])
    s.edge("E11-approved-public", "firewall", "public", [(460, 1200), (500, 1200), (500, 1705), (570, 1705)])
    s.edge("E12-app-dns", "integration", "dns-in", [(600, 790), (530, 790), (530, 465), (460, 465)])
    s.edge("E13-job-dns", "job", "dns-in", [(600, 1160), (500, 1160), (500, 610), (265, 610), (265, 580)])
    return s


def dns():
    s = page("dns", "OneGrid - private name resolution and endpoint reachability",
             "ENTERPRISE DNS BLUEPRINT | Example static IP plan. DNS resolution, route reachability, service public access and identity authorization are four separate checks.", 2060)
    s.box("onprem", 40, 190, 380, 1070, "Corporate / operator network",
          "Connected through approved ExpressRoute / VPN.", dashed=True)
    node(s, "corporate-dns", 70, 790, 320, 230, "Corporate DNS", "Conditional forwarding of Azure service namespaces\nTarget: resolver inbound 10.10.1.4\nUDP/TCP 53; reachable hybrid route\nDo not forward back into a loop", "dns-private-resolver", "onprem")
    s.box("hub", 470, 190, 1000, 1070, "DNS hub VNet - 10.10.0.0/16",
          "Private zones link here; outbound rules forward customer namespaces only.", icon="virtual-network")
    node(s, "inbound", 520, 390, 400, 170, "Private Resolver inbound", "10.10.1.4 in 10.10.1.0/28\nDedicated dnsResolvers-delegated subnet\nStatic VIP; approved DNS clients only", "dns-private-resolver", "hub")
    node(s, "outbound", 1020, 390, 400, 170, "Private Resolver outbound", "Separate 10.10.1.16/28 subnet\nNo client-facing inbound VIP\nSends approved forwarded queries", "dns-private-resolver", "hub")
    node(s, "azure-dns", 520, 690, 400, 170, "Azure DNS resolution context", "Private-zone records linked to resolver VNet\nAzure DNS is a platform service\nNot a hub DNS VM / peering proxy", "dns-private-resolver", "hub")
    node(s, "rules", 1020, 690, 400, 170, "Forwarding ruleset", "Customer domain -> corporate DNS:53\nAssociate with outbound endpoint\nNo rule for private zones back to this inbound\nRuleset link is not a network route", "dns-private-resolver", "hub")
    node(s, "zones", 520, 990, 900, 230, "Private DNS zones / actual generated records",
         "App/SCM: privatelink.azurewebsites.net | Blob: privatelink.blob.core.windows.net\nOpenAI: privatelink.openai.azure.com | ACR: privatelink.azurecr.io, including data records\nML: privatelink.api.azureml.ms; notebook zone only when used; supplied inference records\nFabric: use tenant PE's generated DNS configuration for actual KQL / Power BI / Fabric API hosts\nDFS: privatelink.dfs.core.windows.net only when the configured ADLS source requires it", "dns-private-resolver", "hub")
    s.box("spoke", 1520, 190, 840, 1070, "Workload VNet - 10.20.0.0/16",
          "Custom DNS: 10.10.1.4 | peering/UDR/NSG must permit the DNS and application paths.", icon="virtual-network")
    node(s, "app-dns", 1560, 390, 350, 250, "App integration client", "10.20.2.0/26\nMicrosoft.Web/serverFarms\nOriginal service FQDN in SDK\nDNS resolves private NIC address\nTLS still validates service hostname", "app-service", "spoke")
    node(s, "job-dns", 1970, 390, 350, 250, "Job environment client", "10.20.4.0/23\nMicrosoft.App/environments\nIndependent image-pull and scoring DNS\nNot inherited from App Service", "container-apps-job", "spoke")
    node(s, "endpoint-nics", 1560, 990, 760, 230, "Private endpoint NICs - example 10.20.1.0/24",
         "Separate App Service / Blob / OpenAI / tenant Fabric / ML workspace / ACR connections\nClient: original FQDN -> private IP -> TCP 443 (SQL clients: TDS TCP 1433)\nPrivate DNS does not grant RBAC and does not disable public service access\nPublic GeoCatalog / NOAA / Entra / ARM / browser-map DNS remains separately resolvable", "private-endpoint", "spoke")
    note(s, "dns-read", 1340, "Read the two DNS branches",
         "Private Azure service lookup: client -> inbound resolver -> Azure DNS -> linked private zone -> private NIC address. Customer namespace lookup: Azure DNS -> matched ruleset -> outbound endpoint -> corporate DNS. A ruleset link can work without peering, but direct DNS/IP traffic still needs a reachable network path.")
    note(s, "dns-test", 1500, "Acceptance from every real caller",
         "Resolve original app/SCM, Blob, OpenAI, ML inference, registry/data and Fabric hosts from gateway, app, job, runner and hybrid clients. Then test HTTPS/TDS, valid TLS/SNI, authorized data access and denied public origin. Test Blob and DFS separately when ADLS uses both.")
    note(s, "dns-ha", 1660, "Regional recovery is a configured design, not an automatic side effect",
         "Provide independently reachable regional resolver endpoints and zone links. Cross-region ruleset VNet links are not supported. Do not copy the example DNS failover lab's synthetic domains, upstream VMs, test addresses or NVA route assumptions into OneGrid.")
    s.edge("D01-app-query", "app-dns", "inbound", [(1735, 390), (1735, 330), (720, 330), (720, 390)])
    s.edge("D02-job-query", "job-dns", "inbound", [(2145, 390), (2145, 300), (940, 300), (940, 475), (920, 475)])
    wire(s, "D03-hybrid-query", "corporate-dns", "inbound",
         via=[(445, 905), (445, 475)])
    wire(s, "D04-platform-resolution", "inbound", "azure-dns", ports=("bottom", "top"))
    wire(s, "D05-private-zone", "azure-dns", "zones", ports=("bottom", "top"),
         via=[(720, 930), (970, 930)])
    wire(s, "D06-forward-match", "azure-dns", "rules")
    wire(s, "D07-forward-outbound", "rules", "outbound", ports=("top", "bottom"))
    s.edge("D08-corporate-upstream", "outbound", "corporate-dns",
           [(1220, 390), (1220, 350), (455, 350), (455, 950), (390, 950)])
    return s


def weather():
    s = page("weather", "OneGrid - forecast execution, model access and publication",
             "RUNTIME CODE + ENTERPRISE NETWORK OVERLAY | One scheduled CPU job; separate standing GPU inference; customer imagery is not an Aurora input.", 2320)
    s.box("external", 40, 190, 400, 1470, "Control and external dependencies", "Runtime inputs; HTTPS 443.", dashed=True)
    for id, y, title, body, icon in (
        ("trigger", 320, "Schedule / ARM start", "01 / 07 / 13 / 19 UTC\nOptional app -> ARM job API\nJob-scoped Jobs Operator\nNo inbound HTTP listener", "resource-group"),
        ("gfs", 610, "NOAA GFS", "Public S3 f000 0.25-degree analyses\nTwo cycles six hours apart\nSelect earlier cycle for data latency\nRequired fields / pressure levels", ""),
        ("static", 900, "HuggingFace static fields", "microsoft/aurora static data\nLand mask / elevation / soil\nAllow actual download/CDN hosts\nNot customer imagery", ""),
        ("nhc", 1190, "NHC active storm feed", "Names and positions, not Aurora predictions\nDefault match of detected candidates\nUnavailable -> tropical-latitude filter", ""),
        ("registry", 1480, "Pipeline image / ACR", "Image pull before Python starts\nOwn job identity / AcrPull\nEnterprise private registry requires Premium", "container-registry"),
    ):
        node(s, id, 70, y, 340, 150, title, body, icon, "external")
    s.box("job-env", 490, 190, 720, 1470, "Container Apps workload profiles environment",
          "Enterprise example: 10.20.4.0/23; own DNS, routes, firewall rules and identity.", icon="container-apps-job")
    for id, y, title, body in (
        ("entry", 320, "Start one job execution", "Python 3.11 / CPU torch; 2 vCPU / 4 GiB\npython -m aurora_pipeline.run\nManaged identity selected with AZURE_CLIENT_ID\nOne cycle -> exit; timeout 3600 s / retry limit 1"),
        ("prepare", 610, "Prepare two starting weather states", "config.py + initial_conditions.py\nTemperature / wind / pressure / humidity; 13 pressure levels\nGFS unit/grid conversion + standard static fields\nExample: 13 UTC run uses 00 and 06 UTC snapshots"),
        ("invoke", 1000, "Detect, filter and submit forecast", "tracking.py / nhc.py / inference.py\nPressure minima + nearby strong winds -> candidate centres\nNHC matching / fallback filter -> official aurora.Tracker seeds\nRequest aurora-0.25-finetuned, 20 six-hour steps"),
        ("normalize", 1390, "Track and normalize for OneGrid", "Follow each seed through returned weather fields\nStarting position/intensity is from the input analysis\nForecast positions / winds / pressure from rollout\nConvert units, movement and categories; publish events"),
    ):
        node(s, id, 530, y, 640, 210, title, body, "container-apps-job", "job-env")
    s.box("ml-workspace", 1260, 190, 1100, 1050, "Azure ML service-hosted workspace / deployment",
          "Customer workspace private endpoint handles inbound; managed-network policy handles deployment outbound.", icon="machine-learning")
    node(s, "model", 1300, 320, 1020, 220, "Model deployment and backing resources",
         "Workspace + endpoint existence is not model readiness: model asset / accepted terms / GPU quota / healthy deployment required.\nDefault GPU: Standard_NC24ads_A100_v4; model selection is separate from the CPU image.\nWorkspace identity, endpoint identity, AML backing storage, Key Vault and Application Insights have distinct lifecycle/permissions.\nValidate artifact pulls and required backing-resource roles; don't treat resource wiring as a completed permissions test.", "machine-learning", "ml-workspace")
    node(s, "ml-egress", 1300, 650, 1020, 210, "Managed deployment outbound network",
         "For private enterprise operation: configure allowed outbound managed private endpoints / approved destinations.\nInclude the customer Blob channel as well as ML backing storage / Key Vault / image artifacts.\nA user-delegation SAS authorizes Blob operations; it does not bypass a storage firewall.\nThis policy is not the Container Apps environment subnet or App Service VNet integration.", "virtual-network", "ml-workspace")
    node(s, "gpu", 1300, 1000, 1020, 210, "Aurora managed online endpoint",
         "Job -> workspace PE -> supplied scoring hostname / HTTPS 443\nEndpoint authMode = AADToken; job token audience https://ml.azure.com\nTemplate job grant: AzureML Data Scientist on workspace\nAurora predicts atmospheric fields; model is not trained anew per execution", "machine-learning", "ml-workspace")
    s.box("customer-storage", 1260, 1320, 1100, 340, "Customer Blob storage - separate service boundary",
          "HTTPS 443; source access must work from both job and managed model network.", icon="blob-storage")
    node(s, "channel", 1300, 1430, 480, 200, "aurora-channel", "Job creates short-lived user-delegation SAS\nLarge starting conditions and predicted fields\nEndpoint and job both need reachable Blob path\nJob: Storage Blob Data Contributor", "blob-storage", "customer-storage")
    node(s, "outputs", 1840, 1430, 480, 200, "model-outputs", "weather-events.json\nAnalysis and generation timestamps + horizon\nOverwrite only after successful processing\nApp reads; optional configured Fabric connection", "blob-storage", "customer-storage")
    node(s, "logs", 40, 1770, 1130, 160, "Container Apps environment -> Log Analytics",
         "Environment logging is wired in Bicep. Job logs cycle/source/step count, candidate count, track count, publish location and failures.\nNo storms + no regional export: skip the endpoint and publish an empty list. A failed run can leave the prior output file.", "log-analytics")
    node(s, "consumer", 1840, 1770, 480, 160, "OneGrid weather adapter", "Reads published events with app identity\nCheck analysis age, generation age and provenance\nAn app start request goes to ARM, not scoring", "app-service")
    note(s, "weather-caveats", 1990, "Forecast-derived values versus application estimates",
         "20 x 6 h = 120 h from analysis time, not job wall-clock time. Gust = wind x 1.25; cone radius = 25 + 1.5 x lead-hours miles; confidence label uses track length. These are application rules, not calibrated ensemble probabilities or customer-asset failure calculations.")
    wire(s, "W01-trigger", "trigger", "entry", "control")
    wire(s, "W02-gfs", "prepare", "gfs", ports=("left", "right"))
    s.edge("W03-static", "prepare", "static", [(530, 770), (465, 770), (465, 975), (410, 975)])
    s.edge("W04-nhc", "invoke", "nhc", [(530, 1160), (475, 1160), (475, 1265), (410, 1265)])
    wire(s, "W05-scoring", "invoke", "gpu")
    wire(s, "W06-rollout-tracking", "invoke", "normalize", "data", ("bottom", "top"))
    s.edge("W07-job-channel", "invoke", "channel", [(1170, 1160), (1230, 1160), (1230, 1530), (1300, 1530)], "data")
    s.edge("W08-model-channel", "gpu", "channel", [(1300, 1105), (1250, 1105), (1250, 1555), (1300, 1555)], "data")
    s.edge("W09-publish", "normalize", "outputs", [(1170, 1550), (1240, 1550), (1240, 1700), (2080, 1700), (2080, 1630)], "data")
    wire(s, "W10-read", "consumer", "outputs", ports=("top", "bottom"))
    s.edge("W11-pull-image", "entry", "registry", [(530, 470), (480, 470), (480, 1555), (410, 1555)])
    s.edge("W12-logs", "entry", "logs", [(530, 400), (450, 400), (450, 1730), (605, 1730), (605, 1770)], "audit")
    wire(s, "W13-initialize", "entry", "prepare", "control", ("bottom", "top"))
    wire(s, "W14-prepared-input", "prepare", "invoke", "data", ("bottom", "top"))
    return s


def identity():
    s = page("identity", "OneGrid - identity, credentials and authorization scopes",
             "AUTHORIZATION MAP | Purple arrows represent grants / token context, not inline network proxies. Network reachability never substitutes for data permission.", 2600)
    s.text("identity-head", 40, 190, 440, "Caller / identity", 25, True)
    s.text("credential-head", 540, 190, 640, "Credential / token context", 25, True)
    s.text("scope-head", 1240, 190, 1120, "Actual access boundary and required checks", 25, True)
    rows = (
        ("user", "Signed-in user", "Microsoft Entra user / groups", "OIDC app registration and callback\nApplication session / access controls\nConditional Access is enterprise configuration",
         "Application authorization", "Sign-in establishes user identity, not automatic row filtering across DAX, KQL, Data Agent or Blob.\nTest each tool/data path with permitted and denied users. A shared application identity can otherwise access the same backend data.", "users", "app-service"),
        ("app", "App Service identity", "System-assigned managed identity", "Resource-specific Entra access tokens\nOpenAI also supports an explicitly configured API-key path\nHTTPS 443 through app's own network configuration",
         "Runtime data and control grants", "Template: Storage Blob Data Contributor on sample account; GeoCatalog Administrator on catalog; Jobs Operator scoped to the one job.\nProvisioner applies Fabric/KQL/model and configured OpenAI grants. DAX/KQL/agent permissions remain distinct; verify actual runtime settings.", "managed-identity", "app-service"),
        ("job", "Forecast job identity", "User-assigned managed identity", "AZURE_CLIENT_ID -> DefaultAzureCredential\nAzure ML AADToken; Storage token\nUser-delegation SAS for channel exchange",
         "Forecast-only execution permissions", "Template: AzureML Data Scientist on workspace; Storage Blob Data Contributor on sample account.\nAuto-created registry grants AcrPull to this identity. Supplied registries need their explicit pull grant. SAS and RBAC still require reachable network paths.", "managed-identity", "container-apps-job"),
        ("ingest", "GeoCatalog ingestion identity", "User-assigned managed identity", "Associated with the GeoCatalog resource\nManaged-identity ingestion source uses container URL\nSeparate from app's catalog administration role",
         "Read source imagery for ingestion", "Storage Blob Data Reader on sample storage account in the template.\nIngestion copies/catalogs STAC imagery. Catalog public API controls and GeoCatalog-to-source storage network access are separate checks.", "managed-identity", "geocatalog"),
        ("refresh", "Import refresh service principal", "Dedicated refresh application", "Fabric cloud connection stores SP credential\nEncrypted SQL connection; client secret lifecycle\nNot the signed-in user and not the App Service identity",
         "SQL read + semantic-model refresh", "Lakehouse SQL analytics endpoint / TDS 1433; exact database/schema/table grants.\nBind the intended connection to OneGridModelImport; refresh after source updates; test credential rotation and data freshness.", "entra-id", "semantic-model"),
        ("workspace", "Fabric workspace identity (optional)", "Separate native workspace identity", "Optional createConnection path provisions identity\nADLS Gen2 cloud connection with WorkspaceIdentity\nOr use a supplied valid Blob connection ID",
         "OneLake shortcut source access", "Source storage reader grant + real connectionId + correct Blob/DFS endpoint + permitted source network path.\nA Fabric-plane deployment identity with Blob Reader does not automatically authenticate this shortcut. Transforming files into hazard tables is another job.", "managed-identity", "lakehouse"),
        ("deploy", "Deployment / provisioning identity", "Privileged deployment identity", "ARM / Fabric APIs; approved build and operator path\nOptional Graph Application.ReadWrite.OwnedBy\nDirectory consent is an explicit decision",
         "Provisioning, not runtime", "Template grants include resource-group Owner and storage User Access Administrator for provisioning tasks.\nUse approved release/elevation controls; keep credentials and administrative tooling out of runtime code. Review and remove unneeded standing grants after deployment.", "managed-identity", "resource-group"),
    )
    for index, (id, caller, principal, credential, scope, permissions, icon, target_icon) in enumerate(rows):
        y = 290 + index * 290
        node(s, id, 40, y, 440, 220, caller, principal, icon)
        node(s, id + "-credential", 540, y, 640, 220, "Identity / credential context", credential, "entra-id")
        node(s, id + "-scope", 1240, y, 1120, 220, scope, permissions, target_icon)
        wire(s, "I-" + id + "-credential", id, id + "-credential", "identity")
        wire(s, "I-" + id + "-authorization", id + "-credential", id + "-scope", "identity")
    note(s, "identity-gates", 2350, "Authorization acceptance",
         "Record principal IDs, role scope, Fabric item/database grants, token audience, connection owner, rotation and denied-access tests. Do not infer access from matching display names, a successful sign-in, a private IP, or the existence of an identity resource.")
    return s


def monitoring():
    s = page("monitoring", "OneGrid - logging, monitoring and operational evidence",
             "OUT-OF-BAND OBSERVABILITY | Baseline-wired destinations are distinguished from enterprise diagnostic/collection additions. No monitoring service proxies user requests.", 2450)
    s.text("monitor-source", 40, 190, 650, "Signal source", 25, True)
    s.text("monitor-route", 850, 190, 650, "Collection / transport configuration", 25, True)
    s.text("monitor-result", 1660, 190, 700, "Destination / operational check", 25, True)
    rows = (
        ("app", "App Service / report / agent", "HTTP, console, request failures and tool latency\nDo not log bearer tokens, prompts with sensitive data or connection secrets", "app-service",
         "Enable application/platform diagnostics", "ENTERPRISE ADDITION: configure supported App Service logs / diagnostic settings and actual instrumentation.\nRoute data using the app/platform-supported monitoring path.", "Central application evidence", "Chosen Log Analytics / monitoring workspace\nUI/API/WebSocket failures and dependency latency\nCorrelate app request with KQL/DAX/model call", "log-analytics"),
        ("job", "Container Apps environment / job", "Cycle/source/steps, candidate/track counts\nPublish location and exceptions\nJob status and duration", "container-apps-job",
         "Environment appLogsConfiguration", "BASELINE WIRED: environment sends logs to the configured Log Analytics workspace.\nJob stdout/stderr is captured; configure retention and access.", "Forecast operations", "Job failure / timeout / retry evidence\nCompare generatedAtIso and analysisTimeIso\nA failed run can leave old output; alert on age", "log-analytics"),
        ("ml", "Azure ML workspace / online endpoint", "GPU deployment health / request failures\nInference latency, capacity and backing-resource access\nModel/version and release provenance", "machine-learning",
         "Workspace Application Insights + endpoint settings", "BASELINE WIRED: workspace references Application Insights.\nSelect and enable managed-endpoint diagnostics/metrics and inference collection explicitly; resource creation is not complete telemetry coverage.", "Inference investigation", "Application Insights / selected Azure Monitor destination\nFailed scoring and throttling; model availability\nValidate log content and privacy before retention", "application-insights"),
        ("fabric", "Fabric pipelines / models / Eventhouse", "Source acknowledgments and newest PiEvents row\nNotebook/pipeline run results and model refresh history\nSQL/table freshness and capacity health", "fabric",
         "Fabric monitoring + approved collection workflow", "ENTERPRISE ADDITION: use Fabric's supported monitoring/admin/run-history interfaces; explicitly implement any export to central monitoring.\nClient Private Link does not automatically export Fabric logs.", "Data freshness and failed-run evidence", "Source -> raw -> curated -> SQL -> Import timestamps\nDAX/KQL journeys and row-count expectations\nCollection-job permissions, retries and audit trail", "log-analytics"),
        ("platform", "Azure resources / Entra / control plane", "Blob, Key Vault, ACR, OpenAI and gateway diagnostics\nAzure Activity Log / policy / access changes\nEntra sign-in and audit records", "policy",
         "Enable each supported diagnostic category", "ENTERPRISE ADDITION: configure resource diagnostic settings, subscription Activity Log export and Entra export independently.\nChoose supported categories, destinations, retention and region/tenant policy; no universal switch covers all services.", "Security operations", "Approved central workspace / archive / SIEM\nPublic-access changes, denied calls, role changes\nPrivileged access review and incident ownership", "log-analytics"),
        ("freshness", "Published data and recovery checks", "weather-events.json timestamps and provenance\nKQL latest event; Import last successful refresh\nExactly one active forecast publisher", "blob-storage",
         "Scheduled checks and actionable alerts", "ENTERPRISE ADDITION: run the actual caller's read/query, check age/shape and authorization, and retain the result.\nStatic health probes are not data/model readiness tests.", "Operational ownership", "Agreed freshness / RTO / RPO thresholds\nAlert -> named owner -> runbook -> tested recovery\nTest the alert by controlled failure, not dashboard presence", "log-analytics"),
    )
    for index, (id, title, body, icon, route_title, route_body, dest_title, dest_body, dest_icon) in enumerate(rows):
        y = 300 + index * 300
        node(s, id, 40, y, 650, 230, title, body, icon)
        node(s, id + "-route", 850, y, 650, 230, route_title, route_body, "log-analytics")
        node(s, id + "-destination", 1660, y, 700, 230, dest_title, dest_body, dest_icon)
        wire(s, "M-" + id + "-collect", id, id + "-route", "audit")
        wire(s, "M-" + id + "-retain", id + "-route", id + "-destination", "audit")
    note(s, "monitoring-network", 2180, "Monitoring network and retention controls",
         "If policy requires private Azure Monitor ingestion/query, design AMPLS, supported endpoints and private DNS for the chosen signals; a Log Analytics workspace alone is not private monitoring. Validate required agent/platform endpoints, retention, access, redaction, alert delivery and the administration path.")
    return s


def regulated():
    s = page("regulated", "OneGrid - regulated boundaries and enforced access paths",
             "ENTERPRISE / REGULATED BLUEPRINT | Controls below require implementation and evidence; they are not blanket enforcement provided by the baseline deployment.", 2330)
    s.box("ot", 40, 190, 440, 1430, "OT transfer boundary", "Approved outbound publication; no application-to-OT route.", dashed=True)
    node(s, "historian", 70, 390, 380, 220, "Historian / approved source", "Read-only source permission\nTimestamp / quality / equipment identity\nNo control command interface exposed to app", parent="ot")
    node(s, "connector", 70, 890, 380, 240, "Source connector / outbox", "Certificate-based source publication\nAMQP over WSS 443 default\nDurable checkpoint / retry / source ownership\nAllowed egress to actual Eventstream source", parent="ot")
    s.box("fabric", 530, 190, 600, 1430, "Classified Fabric workspace", "Tenant Private Link + item/data authorization.", icon="fabric")
    node(s, "stream", 570, 390, 520, 220, "Eventstream -> Eventhouse", "ProcessedIngestion; mapped source\nPiEventsRaw -> PiEvents update policy\nKQL database/table/function permissions\nNo Eventhouse-to-Lakehouse replication implied", "event-house", "fabric")
    node(s, "lake", 570, 890, 520, 240, "Lakehouse / approved transformations", "Classify source and curated tables\nNotebook/run identity and source connection\nWork / health / weather joins use asset keys\nRetention and approved source-access mechanism", "lakehouse", "fabric")
    node(s, "semantic", 570, 1370, 520, 210, "Import model / refresh boundary", "Dedicated refresh SP / encrypted TDS 1433\nExplicit SQL + model permissions\nTest export/build/query permissions\nRLS/OLS must match actual caller identity", "semantic-model", "fabric")
    s.box("workload", 1180, 190, 600, 1430, "Controlled application boundary", "Enterprise ingress, network and tool authorization.")
    node(s, "ingress", 1220, 390, 520, 220, "Approved ingress / sign-in", "WAF -> App Service private endpoint\nPreserve host, TLS/SNI and callback\nEntra access policies / approved users\nDisable and test public-origin denial", "application-gateway", "workload")
    node(s, "app", 1220, 890, 520, 240, "OneGrid App Service", "Shared workload identity needs explicit data/tool checks\nUser sign-in alone does not filter all backend data\nEnforce authorization on every actual call path\nNo direct application-to-OT control connection", "app-service", "workload")
    node(s, "approval", 1220, 1370, 520, 210, "Release / operational approval", "Model and tool allowlist / grounded-answer tests\nHuman approval before consequential actions\nGovernance configuration is disabled by baseline wrapper\nEnable and verify controls, not just inventory views", "policy", "workload")
    s.box("model-boundary", 1830, 190, 530, 1430, "Model and geospatial boundaries", "Approved geography, source access and input policy.")
    node(s, "openai", 1870, 390, 450, 220, "Azure OpenAI", "Private account endpoint / explicit auth\nApproved model and processing geography\nSensitive-data minimization and tool policy\nEvaluate answers and denied requests", "azure-openai", "model-boundary")
    node(s, "geo", 1870, 890, 450, 240, "GeoCatalog / imagery", "Catalog roles + source Blob ingestion identity\nClassified imagery and render permissions\nApproved public API egress if required\nSeparate service-to-storage network acceptance", "geocatalog", "model-boundary")
    node(s, "weather", 1870, 1370, 450, 210, "Forecast job / Aurora / Blob", "Own job subnet and managed identity\nPrivate ML inbound + managed outbound\nShort-lived SAS does not bypass firewall\nRetain source/model/analysis-time provenance", "machine-learning", "model-boundary")
    node(s, "evidence", 530, 1740, 1830, 220, "Retained security and operational evidence",
         "Configure and test App Service, gateway, Azure resource, Entra, Fabric and model evidence separately.\nCentral log/archive permissions, retention, redaction and monitoring network path; no secret/token logging.\nInclude approved + denied access, source freshness, Import refresh, model/tool evaluations, public-origin denial and recovery exercises.\nEvidence collection is out of band and does not make an otherwise unauthorized runtime request safe.", "log-analytics")
    note(s, "regulated-gates", 2030, "Release evidence, not a compliance badge",
         "Document data residency/retention, actual principal scopes, network exceptions, key/credential rotation and operational approval. Validate each DAX/KQL/agent/Blob/tool path; a dashboard or governance-intent record is not an enforcement mechanism.")
    wire(s, "R01-source-read", "historian", "connector", "data", ("bottom", "top"))
    wire(s, "R02-publication", "connector", "stream", "data",
         via=[(505, 1010), (505, 500)])
    wire(s, "R03-refresh", "lake", "semantic", "data", ("bottom", "top"))
    wire(s, "R04-ingress", "ingress", "app", ports=("bottom", "top"))
    wire(s, "R05-kql", "app", "stream", ports=("left", "right"),
         via=[(1150, 1010), (1150, 500)])
    s.edge("R06-dax", "app", "semantic", [(1220, 1080), (1160, 1080), (1160, 1475), (1090, 1475)])
    s.edge("R07-openai", "app", "openai", [(1740, 950), (1800, 950), (1800, 500), (1870, 500)])
    wire(s, "R08-geospatial", "app", "geo")
    s.edge("R09-weather-output", "app", "weather", [(1740, 1080), (1810, 1080), (1810, 1475), (1870, 1475)])
    s.edge("R10-evidence", "app", "evidence", [(1480, 1130), (1795, 1130), (1795, 1690), (1445, 1690), (1445, 1740)], "audit")
    return s


def multiregion():
    s = page("multiregion", "OneGrid - regional stamps, protected origins and controlled recovery",
             "RECOVERY BLUEPRINT | Example primary/recovery address plans. Front Door Premium uses its own managed Private Link origin path, not a customer-subnet gateway.", 2490)
    node(s, "users", 920, 180, 560, 110, "Users / published application host", "HTTPS 443 / approved sign-in callback", "users")
    node(s, "frontdoor", 920, 360, 560, 190, "Azure Front Door Premium", "WAF / TLS / custom host / WebSocket\nApprove each regional private origin connection\nKeep recovery origin disabled until acceptance\nProbe success alone is not data/model readiness", "front-door")
    for suffix, x, title, hub, spoke, state in (
        ("a", 40, "Primary region - active stamp", "10.10", "10.20", "Primary ingestion and forecast publisher active"),
        ("b", 1260, "Recovery region - prepared stamp", "10.30", "10.40", "Publisher fenced; origin disabled until accepted"),
    ):
        parent = "region-" + suffix
        s.box(parent, x, 660, 1100, 1420, title,
              f"{state}. Example hub {hub}.0.0/16; workload {spoke}.0.0/16.", dashed=True)
        node(s, "app-" + suffix, x + 40, 800, 1020, 190, "Regional App Service - service-hosted",
             "Front Door managed Private Link -> approved origin; verify direct public-origin denial\nRegional app settings / immutable package / custom host / certificate and sign-in callbacks\nActual Fabric item IDs, KQL host, model deployment, storage and catalog bindings; not names alone", "app-service", parent)
        subnet = "network-" + suffix
        s.box(subnet, x + 40, 1070, 1020, 410, f"Regional workload network - {spoke}.0.0/16",
              "Independent resolver / zone links / approved egress and reverse paths.", parent=parent, icon="virtual-network")
        node(s, "integration-" + suffix, x + 70, 1200, 440, 240, "App integration and dependency NICs",
             f"App integration {spoke}.2.0/26\nPE subnet {spoke}.1.0/24\nApp allTraffic routing; Blob/OpenAI/tenant Fabric PEs\nRegional hub DNS and firewall policy\nApp Service compute is outside subnet", "private-endpoint", subnet)
        node(s, "job-" + suffix, x + 570, 1200, 460, 240, "Regional forecast environment",
             f"Dedicated job subnet {spoke}.4.0/23\nOwn identity, DNS, registry and Blob channel access\nML workspace PE + managed model outbound\nExactly one active output publisher\nPrepare model asset/GPU/terms before incident", "container-apps-job", subnet)
        node(s, "fabric-" + suffix, x + 40, 1570, 480, 200, "Fabric regional recovery contract",
             "Item-specific data recovery and source replay\nRestore permissions / connections / actual IDs\nRebind SQL; refresh Import; test DAX/KQL\nCapacity/workspace existence is not freshness", "fabric", parent)
        node(s, "storage-" + suffix, x + 580, 1570, 480, 200, "Storage / package / imagery",
             "Baseline sample storage is Standard_LRS\nChoose explicit protection / copy / restore policy\nVersioning / retained backups separate from replication\nRestore GeoCatalog metadata and ingestion bindings", "blob-storage", parent)
        node(s, "models-" + suffix, x + 40, 1840, 480, 200, "OpenAI / Aurora / GeoCatalog",
             "Region-specific service endpoints and model quota\nActual inference and catalog search/tiles must pass\nKeys/identities/processing geography reviewed\nNo implied global model or catalog replication", "machine-learning", parent)
        node(s, "controls-" + suffix, x + 580, 1840, 480, 200, "Regional release and operations",
             "Independent logs / alerts / connected runner path\nFence competing producers and job schedules\nProtect source checkpoints and publication ownership\nApproved failback and state reconciliation", "policy", parent)
        wire(s, "G-app-egress-" + suffix, "app-" + suffix, "integration-" + suffix,
             ports=("bottom", "left"),
             via=[(x + 550, 1030), (x + 50, 1030), (x + 50, 1320)])
        wire(s, "G-fabric-query-" + suffix, "integration-" + suffix, "fabric-" + suffix,
             ports=("bottom", "top"), via=[(x + 290, 1520), (x + 280, 1520)])
        wire(s, "G-job-storage-" + suffix, "job-" + suffix, "storage-" + suffix,
             ports=("bottom", "top"), via=[(x + 800, 1510), (x + 820, 1510)])
        s.edge("G-model-readiness-" + suffix, "models-" + suffix, "job-" + suffix,
               [(x + 40, 1940), (x + 15, 1940), (x + 15, 1495), (x + 550, 1495),
                (x + 550, 1320), (x + 570, 1320)], "control")
    wire(s, "G01-global-entry", "users", "frontdoor", ports=("bottom", "top"))
    wire(s, "G02-primary-origin", "frontdoor", "app-a", ports=("left", "left"),
         via=[(20, 455), (20, 895)])
    wire(s, "G03-recovery-origin", "frontdoor", "app-b", ports=("right", "right"),
         via=[(2380, 455), (2380, 895)], dashed=True)
    s.edge("G04-fabric-recovery", "fabric-a", "fabric-b",
           [(320, 1770), (320, 1805), (1540, 1805), (1540, 1770)], "data", dashed=True)
    s.edge("G05-storage-recovery", "storage-a", "storage-b",
           [(1100, 1670), (1170, 1670), (1170, 2110), (2380, 2110), (2380, 1670), (2320, 1670)], "data", dashed=True)
    note(s, "cutover", 2160, "Cutover gate - fence -> recover -> rebind/refresh -> prove journeys -> enable origin",
         "Verify latest source event, SQL/Import consistency, KQL/DAX/agent authorization, real inference, catalog/Blob access, fresh forecast and sole-publisher ownership before enabling recovery traffic. Public-origin alternative requires AzureFrontDoor.Backend plus this profile's X-Azure-FDID; never the shared tag alone.")
    return s


def scenes(dark=False):
    captions = {
        "B01": "AMQP 443", "B02": "Processed", "B03": "Load", "B04": "Features",
        "B05": "SQL sync", "B06": "Import 1433", "B07": "Grounding", "B08": "443 / WSS",
        "B09": "Sign-in", "B10": "KQL 443", "B11": "DAX 443", "B12": "Agent 443",
        "B13": "Model 443", "B14": "ARM 443", "B15": "Inputs 443", "B16": "Score 443",
        "B17": "Payload", "B18": "Payload", "B19": "Publish", "B20": "Read 443",
        "B21": "Upload", "B22": "Read 443", "B23": "STAC 443", "B24": "Blob 443",
        "B25": "Start job", "B26": "Persist", "B27": "Bind", "B28": "Files 443", "B29": "Maps 443",
        "F01": "AMQP 443", "F02": "Processed", "F03": "Load", "F04": "Score",
        "F05": "SQL sync", "F06": "Import 1433", "F07": "TDS 1433",
        "F08": "KQL 443", "F09": "DAX 443", "F10": "Agent 443", "F11": "Model 443",
        "F12": "Bind", "F13": "Files 443", "F14": "Persist", "E01": "TLS 443", "E02": "TLS 443",
        "E03": "Outbound", "E04": "443", "E05": "443", "E06": "Score 443",
        "E07": "Blob 443", "E08": "Pull 443", "E09": "UDR", "E10": "UDR",
        "E11": "Allowlist", "E12": "DNS 53", "E13": "DNS 53",
        "D01": "DNS 53", "D02": "DNS 53", "D03": "DNS 53", "D04": "Resolve",
        "D05": "Private zone", "D06": "Rule match", "D07": "Forward", "D08": "DNS 53",
        "W01": "Start", "W02": "GFS 443", "W03": "Static 443", "W04": "NHC 443",
        "W05": "AAD / 443", "W06": "Track", "W07": "SAS / 443", "W08": "SAS / 443",
        "W09": "Publish", "W10": "Read 443", "W11": "Pull 443", "W12": "Logs",
        "W13": "Initialize", "W14": "Seed input",
        "R01": "Read", "R02": "AMQP 443", "R03": "Import 1433", "R04": "443 / WSS",
        "R05": "KQL 443", "R06": "DAX 443", "R07": "Model 443", "R08": "STAC 443",
        "R09": "Read 443", "R10": "Audit",
        "G01": "HTTPS 443", "G02": "Private origin", "G03": "Gated origin",
        "G04": "Recover / replay", "G05": "Configured copy",
    }
    result = []
    for source in (baseline(), fabric(), enterprise(), dns(), weather(),
                   identity(), monitoring(), regulated(), multiregion()):
        scene = drawing.card_scene(source.decorate(icon_routes=False), dark=dark)
        for edge in scene.edges:
            edge.caption = "443" if edge.id.startswith("E-target-") else captions.get(edge.id.split("-")[0], "")
        result.append(scene)
    return result


def document(dark=False):
    manifest = json.loads((HERE / "assets" / "manifest.json").read_text(encoding="utf-8"))
    for name, metadata in manifest["icons"].items():
        if sha256((HERE / "assets" / name).read_bytes()).hexdigest() != metadata["sha256"]:
            raise ValueError(f"Official icon changed: {name}")
    views = scenes(dark)
    root = ET.Element("mxfile", {"host": "app.diagrams.net", "type": "device",
                                "pages": str(len(views)), "compressed": "false"})
    for scene in views:
        drawing.validate(scene)
        root.append(drawing.drawio_page(scene))
    ET.indent(root)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True) + b"\n"


def gallery():
    views = scenes()
    rows, sections = [], []
    for scene, label in zip(views, LABELS):
        name = escape(scene.name)
        rows.append(f'<li><a href="#{name}">{label}</a></li>')
        sections.append(
            f'<section id="{name}"><h2>{label}</h2><p>{escape(scene.description)}</p>'
            f'<p><a href="{name}.svg">Light SVG</a> | <a href="{name}.png">Light PNG</a> | '
            f'<a href="{name}-dark.svg">Dark SVG</a> | <a href="{name}-dark.png">Dark PNG</a></p>'
            f'<a href="{name}.svg"><img src="{name}.svg" width="2400" height="{scene.height}" '
            f'alt="{escape(scene.title)}"></a><p><a href="#top">Back to sheets</a></p></section>'
        )
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<title>OneGrid - detailed reference architecture</title><style>'
        'body{margin:0;background:#0C1117;color:#EDF5FF;font:16px/1.6 "Segoe UI",Arial,sans-serif}'
        'main{max-width:1800px;margin:auto;padding:28px}a{color:#63B9FF}'
        'h1{font-size:36px}h2{font-size:28px}p{color:#B7C8DA}'
        'nav ul{display:flex;flex-wrap:wrap;gap:12px 28px;padding:20px;list-style:none;border:1px solid #416780}'
        'section{margin:60px 0;scroll-margin-top:20px}img{display:block;width:100%;height:auto;background:white;border-radius:6px}'
        'a:focus-visible{outline:2px solid #FFB365}@media(max-width:700px){main{padding:14px}}'
        '</style></head><body><main id="top"><h1>OneGrid detailed reference architecture</h1>'
        '<p>Nine source-reviewed sheets: real callers, service boundaries, ports, DNS, identity grants, '
        'source access, monitoring and recovery. Example network addresses are design allocations, not live Azure inventory.</p>'
        '<p>Both SVG and PNG images are exported by draw.io Desktop from native editable diagram XML.</p>'
        '<p><a href="onegrid-reference-architecture.drawio">Editable light draw.io</a> | '
        '<a href="onegrid-reference-architecture-dark.drawio">Editable dark draw.io</a> | '
        '<a href="../architecture/traffic-and-security.md">Routing, identity and evidence guide</a></p>'
        '<nav aria-label="Architecture sheets"><ul>' + "".join(rows) + '</ul></nav>'
        + "".join(sections) + '</main></body></html>\n'
    ).encode("utf-8")


def exports(executable, dark=False):
    result = {}
    with tempfile.TemporaryDirectory(prefix="onegrid-reference-") as directory:
        folder = Path(directory)
        source = folder / "architecture.drawio"
        source.write_bytes(document(dark))
        for index, scene in enumerate(scenes(dark), 1):
            for format in ("svg", "png"):
                target = folder / (scene.name + "." + format)
                command = [
                    str(executable), "--disable-update", "--export", "--format", format,
                    "--theme", "light", "--size", "page", "--width", str(drawing.WIDTH),
                    "--page-index", str(index), "--timeout", "60", "--output", str(target),
                ]
                if format == "svg":
                    command.append("--embed-images")
                subprocess.run([*command, str(source)], check=True, timeout=90)
                result[HERE / target.name] = target.read_bytes()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--drawio", type=Path, help="Actual draw.io Desktop executable.")
    parser.add_argument("--render", action="store_true", help="Export all light and dark SVG/PNG pages.")
    parser.add_argument("--check", action="store_true", help="Compare generated files instead of writing.")
    args = parser.parse_args()
    if args.render and (args.drawio is None or not args.drawio.is_file()):
        parser.error("--render requires --drawio pointing to draw.io Desktop")
    generated = {
        HERE / "onegrid-reference-architecture.drawio": document(),
        HERE / "onegrid-reference-architecture-dark.drawio": document(dark=True),
        HERE / "onegrid-reference-gallery.html": gallery(),
    }
    if args.render:
        for dark in (False, True):
            generated.update(exports(args.drawio, dark))
    stale = []
    for path, content in generated.items():
        if args.check:
            if not path.is_file() or path.read_bytes() != content:
                stale.append(path.name)
        else:
            path.write_bytes(content)
    if stale:
        raise SystemExit("Stale reference drawings:\n" + "\n".join(stale))
    print(f"{'Verified' if args.check else 'Generated'} {len(generated)} files; nine detailed native draw.io pages per theme.")


if __name__ == "__main__":
    main()
