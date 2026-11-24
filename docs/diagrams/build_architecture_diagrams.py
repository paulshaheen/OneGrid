"""Build OneGrid architecture views as editable draw.io, SVG, and PNG files."""

import argparse
import base64
import copy
from dataclasses import dataclass, field
from hashlib import sha256
from html import escape
import json
from pathlib import Path
import subprocess
import tempfile
import textwrap
import xml.etree.ElementTree as ET


HERE = Path(__file__).resolve().parent
WIDTH = 2400
COLORS = {
    "request": "#0078D4",
    "data": "#107C10",
    "control": "#CA5010",
    "identity": "#8764B8",
    "audit": "#69797E",
}
INK = "#172B4D"
MUTED = "#43566B"
DARK_BACKGROUND = "#10161D"
DARK_COLORS = {
    "request": "#63B9FF",
    "data": "#70D997",
    "control": "#FFB365",
    "identity": "#C9A6FF",
    "audit": "#AFBFCC",
}


def lines(value, width, size):
    return tuple(
        line
        for paragraph in value.split("\n")
        for line in (textwrap.wrap(paragraph, max(1, int(width / (size * 0.56)))) or [""])
    )


@dataclass
class Item:
    id: str
    kind: str
    x: int
    y: int
    w: int
    h: int
    parent: str = "1"
    text: tuple = ()
    size: int = 18
    bold: bool = False
    color: str = INK
    fill: str = "#FFFFFF"
    stroke: str = "#9AAFC1"
    dashed: bool = False
    icon: str = ""
    align: str = "left"


@dataclass
class Edge:
    id: str
    source: str
    target: str
    points: tuple
    kind: str
    dashed: bool = False
    caption: str = ""


@dataclass
class Scene:
    name: str
    title: str
    description: str
    height: int
    items: list = field(default_factory=list)
    edges: list = field(default_factory=list)
    dark: bool = False
    cards: bool = False

    def text(self, id, x, y, w, text, size=18, bold=False, parent="1", color=INK,
             align="left"):
        content = lines(text, w, size)
        item = Item(id, "text", x, y, w, len(content) * (size + 5),
                    parent=parent, text=content, size=size, bold=bold, color=color, align=align)
        self.items.append(item)
        return item

    def box(self, id, x, y, w, h, title, subtitle="", fill="#F4F8FC", icon="",
            parent="1", dashed=False):
        item = Item(id, "scope", x, y, w, h, parent=parent, fill=fill,
                    stroke="#6D8CA6", dashed=dashed)
        self.items.append(item)
        offset = 64 if icon else 20
        if icon:
            self.items.append(Item(id + "-icon", "icon", x + 20, y + 18, 32, 32,
                                   parent=id, icon=icon))
        heading = self.text(id + "-title", x + offset, y + 17, w - offset - 20, title,
                            24, True, id)
        if subtitle:
            self.text(id + "-subtitle", x + 20, heading.y + heading.h + 12, w - 40, subtitle,
                      17, parent=id, color=MUTED)
        return item

    def node(self, id, x, y, w, h, title, body="", icon="", parent="1", optional=False):
        if optional:
            title += " (optional)"
        item = Item(id, "node", x, y, w, h, parent=parent, text=(title, body))
        self.items.append(item)
        if icon and h < 120:
            self.items.append(Item(id + "-icon", "icon", x + 12, y + 10, 48, 48,
                                   parent=id, icon=icon))
            heading = self.text(id + "-title", x + 76, y + 10, w - 86, title,
                                18, True, id)
            if body:
                self.text(id + "-body", x + 76, heading.y + heading.h + 4, w - 86,
                          body.split("\n")[0], 15, parent=id, color=MUTED)
        elif icon:
            size = 72 if h >= 150 else 64
            self.items.append(Item(id + "-icon", "icon", x + (w - size) // 2, y + 4,
                                   size, size, parent=id, icon=icon))
            heading = self.text(id + "-title", x + 8, y + size + 8, w - 16,
                                title, 18, True, id, align="center")
            if body:
                self.text(id + "-body", x + 8, heading.y + heading.h + 3, w - 16,
                          body.split("\n")[0], 15, parent=id, color=MUTED, align="center")
        else:
            heading = self.text(id + "-title", x + 12, y + 14, w - 24, title,
                                20, True, id, align="center")
            if body:
                self.text(id + "-body", x + 12, heading.y + heading.h + 12, w - 24,
                          body, 17, parent=id, color=MUTED, align="center")
        return item

    def edge(self, id, source, target, points, kind="request", label="", at=None,
             label_width=280, dashed=False):
        self.edges.append(Edge(id, source, target, tuple(points), kind, dashed))
        if label:
            if at is None:
                raise ValueError(f"{id}: an explicit label position is required")
            label_item = self.text(id + "-label", *at, label_width, label, 17,
                                   color=COLORS[kind])
            label_item.kind = "edge-label"

    def decorate(self, icon_routes=True):
        self.text("page-title", 40, 28, WIDTH - 80, self.title, 36, True)
        self.text("page-description", 40, 88, WIDTH - 80, self.description, 21,
                  color=MUTED)
        y = self.height - 89
        for i, (kind, label) in enumerate((
            ("request", "Request / query (response omitted)"),
            ("data", "Data movement / published output"),
            ("control", "Deployment / configuration / recovery"),
            ("identity", "Identity / authorization"),
            ("audit", "Out-of-band telemetry"),
        )):
            x = 40 + i * 470
            self.items.append(Item("legend-" + kind, "swatch", x, y + 8, 44, 0,
                                   color=COLORS[kind], dashed=kind not in ("request", "data")))
            self.text("legend-label-" + kind, x + 56, y, 400, label, 17)
        self.text("page-footnote", 40, self.height - 38, WIDTH - 80,
                  "Arrowheads indicate the initiator of a request or the destination of data. "
                  "Optional components are labeled; dashed boundaries mark a separately controlled scope.", 16, color=MUTED)
        return route_icons(self) if icon_routes else self


def logical():
    s = Scene("onegrid-logical-architecture", "OneGrid - asset and weather intelligence",
              "Operational data + geospatial context + weather inference + AI, joined by one asset model", 1630)
    s.box("sources", 40, 150, 320, 1170, "Source systems", "Customer and external inputs")
    s.node("pi", 60, 260, 280, 145, "Operational telemetry",
           "PI / historian / SCADA\nApproved source connectors", parent="sources")
    s.node("business", 60, 515, 280, 165, "Asset and maintenance",
           "AIMM / iCare / GADS\nCMMS / work orders\nAsset register", parent="sources")
    s.node("imagery", 60, 915, 280, 140, "Customer geospatial",
           "Imagery / COG / STAC\nGIS and asset locations", parent="sources")
    s.node("gfs", 60, 1135, 280, 140, "NOAA GFS",
           "Global forecast inputs\nUTC input-cycle provenance", parent="sources")

    s.box("fabric", 400, 150, 1190, 620, "Microsoft Fabric",
          "OneGrid workspace | existing or new capacity | SaaS data and analytics", icon="fabric")
    s.node("eventstream", 430, 270, 280, 150, "Fabric Eventstream",
           "PIForwarderEndpoint\nPublish / rebind first", "eventstream", "fabric")
    s.node("eventhouse", 780, 270, 330, 150, "Fabric Eventhouse",
           "PiEventsRaw -> PiEvents\nKQL / PCIOutages", "event-house", "fabric")
    s.node("dataagent", 1200, 270, 330, 150, "Fabric Data Agent",
           "OneGridOntologyAgent\nConfigured model grounding", "data-agent", "fabric", True)
    s.node("lakehouse", 430, 515, 280, 155, "OneLake / Lakehouse",
           "og.* conformed tables\nAsset / reliability / weather", "lakehouse", "fabric")
    s.node("notebooks", 780, 515, 330, 155, "Fabric notebooks",
           "Features / scoring / survival\nPrediction_Pipeline", "notebook", "fabric")
    s.node("semantic", 1200, 490, 330, 145, "Import semantic model",
           "OneGridModelImport\nSQL-backed refresh", "semantic-model", "fabric")
    s.node("ontology", 1200, 655, 330, 95, "Digital Twin Builder",
           "OneGridOntology", "fabric", "fabric")

    s.node("users", 1670, 150, 300, 100, "OneGrid users", icon="users")
    s.node("entra", 2030, 150, 310, 100, "Microsoft Entra ID", "", "entra-id")
    s.node("app", 1670, 300, 670, 275, "Azure App Service - OneGrid",
           "Linux / Node 22 | managed identity\nReport BFF + React / TanStack SSR + Node AI agent\nREST / WebSocket | port 8080\nBlob package: onegrid-app.zip", "app-service")
    s.node("openai", 1670, 665, 320, 140, "Azure OpenAI",
           "Configured model deployment\nGrounded tool orchestration", "azure-openai")
    s.node("manuals", 2030, 665, 310, 140, "Equipment manuals",
           "Bundled retrieval corpus\nOptional indexed integration", optional=True)

    s.box("geo", 400, 835, 400, 485, "Geospatial plane",
          "Customer imagery and map context")
    s.node("assets", 430, 945, 340, 140, "Azure Blob Storage",
           "sample-assets\nCustomer imagery / GIS", "blob-storage", "geo")
    s.node("catalog", 430, 1150, 340, 145, "Planetary Computer Pro",
           "GeoCatalog / STAC / tiles\nIngestion managed identity", "geocatalog", "geo")
    s.box("weather", 840, 835, 750, 485, "Weather / Aurora plane",
          "CPU orchestration and managed GPU inference are separate")
    s.node("job", 875, 945, 300, 150, "Container Apps Job",
           "NOAA -> Aurora -> tracking\n01 / 07 / 13 / 19 UTC", "container-apps-job", "weather")
    s.node("aml", 1240, 945, 315, 150, "Azure Machine Learning",
           "Aurora managed online endpoint\nGPU model deployment", "machine-learning", "weather")
    s.node("acr", 875, 1175, 300, 130, "Container Registry",
           "aurora-pipeline image\nManaged-identity pull", "container-registry", "weather")
    s.node("channel", 1240, 1130, 315, 75, "Blob: aurora-channel", "", "blob-storage", "weather")
    s.node("outputs", 1240, 1230, 315, 75, "Blob: model-outputs", "", "blob-storage", "weather")

    s.box("support", 1650, 850, 710, 470, "Model support and operational signals",
          "Resource permissions and diagnostics are outside the user request path")
    s.node("keyvault", 1680, 965, 310, 140, "Azure Key Vault",
           "Azure ML workspace support\nSecret / access lifecycle", "key-vault", "support")
    s.node("insights", 2030, 965, 300, 140, "Application Insights",
           "Azure ML diagnostics\nInference investigation", "application-insights", "support")
    s.node("logs", 1680, 1155, 310, 140, "Log Analytics",
           "Container Apps environment\nJob execution diagnostics", "log-analytics", "support")
    s.node("identities", 2030, 1155, 300, 140, "Managed identities",
           "App / job / ingestion\nScoped resource permissions", "managed-identity", "support")
    s.box("deployment", 40, 1395, 2320, 100, "Deployment and provisioning",
          "ARM / Bicep -> Azure resources | deployment scripts -> Fabric REST / items / bindings | GitHub release -> Blob package",
          icon="resource-group")

    s.edge("telemetry-ingest", "pi", "eventstream", [(340, 335), (430, 335)], "data")
    s.edge("stream-raw", "eventstream", "eventhouse", [(710, 345), (780, 345)], "data")
    s.edge("business-land", "business", "lakehouse", [(340, 590), (430, 590)], "data")
    s.edge("feature-read", "lakehouse", "notebooks", [(710, 570), (780, 570)], "data")
    s.edge("score-write", "notebooks", "lakehouse",
           [(945, 670), (945, 705), (570, 705), (570, 670)], "data",
           "Write scored tables", (650, 710))
    s.edge("import-refresh", "lakehouse", "semantic",
           [(570, 515), (570, 460), (1365, 460), (1365, 490)], "data",
           "SQL-backed Import refresh", (800, 432), 350)
    s.edge("agent-grounding", "dataagent", "semantic", [(1365, 420), (1365, 490)])
    s.edge("ontology-bind", "ontology", "lakehouse",
           [(1200, 712), (1150, 712), (1150, 740), (460, 740), (460, 670)], "control")
    s.edge("user-app", "users", "app", [(1820, 250), (1820, 300)])
    s.edge("signin", "entra", "app", [(2185, 250), (2185, 300)], "identity")
    s.edge("app-agent", "app", "dataagent", [(1670, 360), (1530, 360)])
    s.edge("app-kql", "app", "eventhouse",
           [(1670, 435), (1140, 435), (1140, 345), (1110, 345)],
           label="KQL", at=(1550, 440), label_width=100)
    s.edge("app-dax", "app", "semantic", [(1670, 540), (1530, 540)],
           label="DAX", at=(1550, 510), label_width=100)
    s.edge("app-model", "app", "openai", [(1830, 575), (1830, 665)])
    s.edge("app-manuals", "app", "manuals", [(2185, 575), (2185, 665)])
    s.edge("imagery-upload", "imagery", "assets",
           [(340, 990), (380, 990), (380, 1015), (430, 1015)], "data")
    s.edge("catalog-ingest", "catalog", "assets", [(600, 1150), (600, 1085)],
           label="Read source blobs", at=(440, 1100), label_width=290)
    s.edge("app-catalog", "app", "catalog",
           [(1670, 560), (1630, 560), (1630, 1355), (790, 1355), (790, 1220), (770, 1220)],
           label="STAC / tiles", at=(820, 1330), label_width=220)
    s.edge("gfs-download", "gfs", "job",
           [(340, 1205), (370, 1205), (370, 1340), (820, 1340), (820, 1000), (875, 1000)], "data")
    s.edge("aurora-invoke", "job", "aml", [(1175, 1020), (1240, 1020)],
           label="Invoke", at=(1180, 985), label_width=80)
    s.edge("channel-access", "aml", "channel", [(1470, 1095), (1470, 1130)], "data")
    s.edge("job-channel", "job", "channel",
           [(1175, 1055), (1205, 1055), (1205, 1167), (1240, 1167)], "data")
    s.edge("forecast-publish", "job", "outputs",
           [(1175, 1080), (1190, 1080), (1190, 1267), (1240, 1267)], "data")
    s.edge("image-pull", "job", "acr", [(1025, 1095), (1025, 1175)])
    s.edge("weather-read", "app", "outputs",
           [(2010, 575), (2010, 825), (1610, 825), (1610, 1267), (1555, 1267)],
           label="Read weather-events.json", at=(1660, 800), label_width=340)
    s.edge("shortcut-read", "lakehouse", "outputs",
           [(700, 670), (700, 815), (1600, 815), (1600, 1290), (1555, 1290)],
           dashed=True)
    s.edge("job-start", "app", "job",
           [(1670, 520), (1650, 520), (1650, 790), (855, 790), (855, 1060), (875, 1060)],
           "control", "Optional ARM job start", (1050, 792), 340)
    return s.decorate()


def fabric():
    s = Scene("onegrid-fabric", "OneGrid - Fabric data and analytics",
              "Real-time telemetry and curated history share asset keys, with separate KQL and Import-model serving paths", 1470)
    s.box("workspace", 420, 160, 1550, 1110, "Microsoft Fabric - OneGrid workspace",
          "Capacity / workspace / item permissions | source provenance | independently measured freshness", icon="fabric")
    s.node("pi", 40, 280, 320, 150, "PI / historian connector",
           "Canonical source events\nDurable outbox / checkpoints")
    s.node("business", 40, 660, 320, 160, "Business and history",
           "AIMM / iCare / GADS\nCMMS / assets / reference data")
    s.node("outputs", 40, 1030, 320, 150, "Azure Blob Storage",
           "model-outputs files\nConfigured OneLake shortcut", "blob-storage", optional=True)
    s.node("eventstream", 470, 280, 310, 150, "Fabric Eventstream",
           "PIForwarderEndpoint\nPublish destination / mapping", "eventstream", "workspace")
    s.node("raw", 900, 280, 390, 150, "Eventhouse: PiEventsRaw",
           "Canonical landing table\nUpdate policy -> PiEvents", "event-house", "workspace")
    s.node("kql", 1440, 280, 440, 150, "Eventhouse query endpoint",
           "PiEvents / PCIOutages\nOperational and spatial KQL", "event-house", "workspace")
    s.node("agent", 1440, 480, 440, 140, "Fabric Data Agent",
           "OneGridOntologyAgent\nPublished semantic-model source", "data-agent", "workspace", True)
    s.node("lake", 470, 700, 350, 190, "OneLake / Lakehouse",
           "Source landing + og.* tables\nSite -> unit -> asset -> tag\nReliability / work / weather", "lakehouse", "workspace")
    s.node("notebooks", 900, 700, 390, 190, "Notebooks + pipeline",
           "Prepare / features / models\nAnomaly / Cox / survival / scoring\nPrediction_Pipeline", "notebook", "workspace")
    s.node("ontology", 1440, 740, 440, 145, "Digital Twin Builder",
           "OneGridOntology\nTable-backed entities / relationships", "fabric", "workspace")
    s.node("sql", 900, 1050, 390, 145, "SQL analytics endpoint",
           "Lakehouse metadata sync\nDedicated refresh connection", "lakehouse", "workspace")
    s.node("import", 1440, 1050, 440, 145, "Import semantic model",
           "OneGridModelImport\nRefresh after curated-table updates", "semantic-model", "workspace")
    s.node("users", 2030, 180, 330, 100, "OneGrid users", icon="users")
    s.node("app", 2030, 570, 330, 230, "Azure App Service",
           "OneGrid report BFF / agent\nDAX + KQL + Data Agent\nRuntime query identity", "app-service")
    s.box("contracts", 40, 1300, 2320, 65, "Access contracts",
          fill="#F1F8F5")
    s.text("contract-note", 310, 1320, 2020,
           "Separate runtime and refresh identities | shortcut file access | verified hazard transforms | table-backed ontology and model-grounded Data Agent", 19)
    s.edge("source-events", "pi", "eventstream", [(360, 355), (470, 355)], "data")
    s.edge("raw-land", "eventstream", "raw", [(780, 355), (900, 355)], "data")
    s.edge("update-policy", "raw", "kql", [(1290, 355), (1440, 355)], "data",
           "Curate", (1315, 325), 100)
    s.edge("history-land", "business", "lake",
           [(360, 740), (400, 740), (400, 795), (470, 795)], "data")
    s.edge("read-features", "lake", "notebooks", [(820, 770), (900, 770)], "data")
    s.edge("write-scores", "notebooks", "lake",
           [(1095, 890), (1095, 940), (645, 940), (645, 890)], "data",
           "Persist curated / scored tables", (680, 947), 390)
    s.edge("sql-projection", "lake", "sql",
           [(600, 890), (600, 1122), (900, 1122)], "data")
    s.edge("model-refresh", "sql", "import", [(1290, 1122), (1440, 1122)], "data")
    s.edge("shortcut-read", "lake", "outputs",
           [(470, 850), (390, 850), (390, 1105), (360, 1105)],
           label="Shortcut file access", at=(45, 1220), label_width=320, dashed=True)
    s.edge("ontology-binding", "ontology", "lake",
           [(1660, 740), (1660, 660), (645, 660), (645, 700)], "control",
           "Bind approved entity tables", (950, 630), 420)
    s.edge("agent-model", "agent", "import",
           [(1880, 550), (1920, 550), (1920, 1122), (1880, 1122)],
           label="Configured model source", at=(1490, 1008), label_width=360)
    s.edge("user-app", "users", "app", [(2195, 280), (2195, 570)])
    s.edge("app-kql", "app", "kql",
           [(2030, 600), (2000, 600), (2000, 355), (1880, 355)],
           label="KQL", at=(1900, 320), label_width=80)
    s.edge("app-agent", "app", "agent",
           [(2030, 675), (1990, 675), (1990, 550), (1880, 550)])
    s.edge("app-dax", "app", "import",
           [(2195, 800), (2195, 1160), (1880, 1160)],
           label="DAX", at=(2010, 1125), label_width=100)
    return s.decorate()


def enterprise():
    s = Scene("onegrid-enterprise-landing-zone", "OneGrid - enterprise landing zone implementation",
              "Add enterprise ingress, private connectivity, DNS, egress and governance around the same OneGrid application and data services", 1550)
    s.node("users", 40, 210, 380, 130, "Enterprise users",
           "Approved browser / API access\nHybrid network or internet ingress", "users")
    s.node("browsermaps", 40, 355, 380, 95, "Browser map endpoints",
           "Azure Maps / Esri / glyphs")
    s.box("hub", 40, 470, 420, 740, "Existing connectivity hub",
          "Platform-owned DNS and controlled egress", icon="virtual-network")
    s.node("dns", 80, 610, 340, 140, "DNS Private Resolver",
           "Private-zone links\nHybrid DNS forwarding", "dns-private-resolver", "hub")
    s.node("firewall", 80, 920, 340, 140, "Azure Firewall",
           "Approved outbound endpoints\nUDR / egress policy", "firewall", "hub")
    s.box("vnet", 520, 170, 940, 1040, "OneGrid workload virtual network",
          "Enterprise networking layer | separate from the baseline ARM deployment", icon="virtual-network")
    s.box("ingress-subnet", 550, 285, 400, 255, "Ingress subnet",
          parent="vnet")
    s.node("gateway", 575, 375, 350, 145, "Application Gateway",
           "WAF / TLS / WebSocket\nApproved entry point", "application-gateway", "ingress-subnet")
    s.box("pe-subnet", 990, 285, 440, 480, "Private endpoint subnet",
          "Separate private endpoint NICs", parent="vnet")
    s.node("app-pe", 1020, 385, 380, 130, "App Service endpoint",
           "Private inbound app access\nOrigin access restricted", "private-endpoint", "pe-subnet")
    s.node("service-pe", 1020, 585, 380, 160, "Dependency endpoints",
           "Fabric / Blob / Azure OpenAI\nTenant Fabric Private Link\nService-specific DNS / access", "private-endpoint", "pe-subnet")
    s.box("integration-subnet", 550, 825, 880, 260, "App integration subnet",
          "Dedicated delegated subnet | outbound application and configuration routing", parent="vnet")
    s.node("integration", 585, 935, 810, 125, "App Service VNet integration",
           "Outbound virtual interface; not the inbound application endpoint", "virtual-network", "integration-subnet")
    s.node("entra", 1530, 175, 390, 120, "Microsoft Entra ID",
           "Sign-in / groups / access policy", "entra-id")
    s.node("app", 1530, 385, 390, 170, "Azure App Service",
           "OneGrid / managed identity\nService-hosted compute\nOutside the integration subnet", "app-service")
    s.box("saas", 1980, 170, 380, 1040, "Service endpoints",
          "SaaS / PaaS remain service-hosted")
    s.node("fabric", 2010, 295, 320, 145, "Microsoft Fabric",
           "Tenant-level Private Link\nSeparate source egress", "fabric", "saas")
    s.node("blob", 2010, 545, 320, 145, "Azure Blob Storage",
           "Assets / package / outputs\nPrivate DNS + authorization", "blob-storage", "saas")
    s.node("ai", 2010, 785, 320, 145, "Azure OpenAI",
           "Approved model endpoint\nRegion / processing policy", "azure-openai", "saas")
    s.node("ml", 2010, 1025, 320, 145, "Azure Machine Learning",
           "Workspace PE for inbound\nManaged network for outbound", "machine-learning", "saas")
    s.node("public", 1530, 1090, 390, 135, "Approved public APIs",
           "GeoCatalog / Entra / ARM\nExplicit endpoint allowlist")
    s.text("outbound-note", 1530, 665, 390,
           "Inbound: gateway -> app private endpoint.\nOutbound: app -> integration subnet -> private endpoints or firewall.", 21, True)
    s.node("forecast-job", 1530, 865, 390, 160, "Aurora forecast job",
           "Own environment / DNS / egress\nNOAA / registry / Blob channel",
           "container-apps-job")
    s.box("platform", 40, 1320, 2320, 120, "Existing enterprise platform",
          "Policy / RBAC / budgets / change approvals / central monitoring | validate runner, package-bootstrap and source-ingestion paths before restricting endpoints",
          icon="policy")
    s.edge("user-ingress", "users", "gateway",
           [(420, 275), (490, 275), (490, 447), (575, 447)])
    s.edge("gateway-origin", "gateway", "app-pe", [(925, 450), (1020, 450)])
    s.edge("origin-app", "app-pe", "app", [(1400, 450), (1530, 450)])
    s.edge("entra-app", "entra", "app", [(1725, 295), (1725, 385)], "identity")
    s.edge("app-outbound", "app", "integration",
           [(1920, 515), (1940, 515), (1940, 810), (1360, 810), (1360, 935)])
    s.edge("integration-private", "integration", "service-pe",
           [(1395, 970), (1445, 970), (1445, 795), (1210, 795), (1210, 745)])
    s.edge("private-fabric", "service-pe", "fabric",
           [(1400, 620), (1480, 620), (1480, 330), (1980, 330), (2010, 330)])
    s.edge("private-blob", "service-pe", "blob",
           [(1400, 650), (1960, 650), (1960, 615), (2010, 615)])
    s.edge("private-ai", "service-pe", "ai",
           [(1400, 680), (1490, 680), (1490, 820), (1960, 820), (1960, 855), (2010, 855)])
    s.edge("forecast-inference", "forecast-job", "ml",
           [(1920, 945), (1950, 945), (1950, 1095), (2010, 1095)],
           label="Job -> workspace PE -> scoring", at=(1955, 975), label_width=370)
    s.edge("dns-query", "integration", "dns",
           [(585, 970), (480, 970), (480, 680), (420, 680)])
    s.edge("egress", "integration", "firewall",
           [(585, 1020), (500, 1020), (500, 990), (420, 990)])
    s.edge("allowlisted-egress", "firewall", "public",
           [(420, 1040), (480, 1040), (480, 1260), (1725, 1260), (1725, 1225)])
    s.edge("dns-links", "dns", "service-pe",
           [(420, 650), (440, 650), (440, 550), (1210, 550), (1210, 585)], "control",
           "Private DNS / forwarding configuration", (570, 552), 430)
    s.edge("browser-map-access", "users", "browsermaps", [(230, 340), (230, 355)])
    return s.decorate()


def regulated():
    s = Scene("onegrid-regulated-workload", "OneGrid - regulated workload boundaries",
              "Separate OT publication, workload queries, model processing, identity and retained evidence", 1500)
    s.box("sources", 40, 170, 360, 950, "Source boundaries",
          "No application-to-OT control path")
    s.box("ot", 60, 285, 320, 495, "OT transfer zone",
          "Read / buffer / publish", parent="sources", dashed=True)
    s.node("pi", 80, 385, 280, 140, "PI / historian / SCADA",
           "Approved source read\nUTC time / quality flags", parent="ot")
    s.node("connector", 80, 615, 280, 140, "Source connector",
           "Durable outbound publication\nCheckpoint / certificate", parent="ot")
    s.node("business", 80, 900, 280, 155, "Approved enterprise data",
           "Assets / maintenance\nClassified work records", parent="sources")
    s.box("fabric", 450, 170, 760, 950, "Microsoft Fabric",
          "Workspace / item / table / model boundaries", icon="fabric")
    s.node("eventstream", 490, 385, 300, 145, "Fabric Eventstream",
           "Approved custom source\nMapped destination", "eventstream", "fabric")
    s.node("eventhouse", 850, 385, 320, 145, "Fabric Eventhouse",
           "PiEvents / PCIOutages\nExplicit KQL permissions", "event-house", "fabric")
    s.node("lake", 490, 870, 300, 155, "OneLake / Lakehouse",
           "Classified curated data\nVerified data-access roles", "lakehouse", "fabric")
    s.node("semantic", 850, 870, 320, 155, "Import semantic model",
           "OneGridModelImport\nTest SQL / model / export access", "semantic-model", "fabric")
    s.node("users", 1270, 170, 270, 105, "Approved users", icon="users")
    s.node("entra", 1580, 170, 280, 145, "Microsoft Entra ID",
           "Conditional Access\nPrivileged access review", "entra-id")
    s.box("workload", 1270, 350, 550, 770, "OneGrid application boundary",
          "Enterprise network, authorization and release controls")
    s.node("gateway", 1310, 475, 470, 140, "Enterprise ingress / WAF",
           "TLS / origin restrictions / approved callbacks\nREST and WebSocket access tests", "application-gateway", "workload")
    s.node("app", 1310, 870, 470, 155, "Azure App Service - OneGrid",
           "Scoped runtime identity and tool authorization\nHuman-reviewed operational recommendations", "app-service", "workload")
    s.box("services", 1880, 170, 480, 950, "Data and model boundaries",
          "Approved geography, inputs, tools and retention")
    s.node("ai", 1920, 385, 400, 155, "Azure OpenAI",
           "Approved model / processing geography\nGrounding and prompt/tool evaluation", "azure-openai", "services")
    s.node("geo", 1920, 675, 400, 145, "Planetary Computer Pro",
           "Classified imagery and asset context\nCatalog / Blob permissions", "geocatalog", "services")
    s.node("forecast", 1920, 940, 400, 155, "Weather / Aurora pipeline",
           "Approved GFS -> job -> managed endpoint\nTimestamped normalized Blob outputs", "machine-learning", "services")
    s.box("audit", 450, 1190, 1910, 185, "Audit and operational evidence",
          "Configure exports for identity, app, Fabric, job, model and deployment events; correlate timestamps and retain provenance")
    s.node("evidence", 1830, 1275, 490, 80, "Log Analytics - retained evidence", "", "log-analytics", "audit")
    s.text("evidence-note", 490, 1290, 1250,
           "Access reviews | positive / negative tests | model approvals | forecast lineage | recovery exercises", 21)
    s.edge("source-read", "pi", "connector", [(220, 525), (220, 615)], "data")
    s.edge("ot-publication", "connector", "eventstream",
           [(360, 685), (425, 685), (425, 457), (490, 457)], "data")
    s.edge("raw-curation", "eventstream", "eventhouse", [(790, 457), (850, 457)], "data")
    s.edge("business-ingest", "business", "lake", [(360, 975), (490, 975)], "data")
    s.edge("model-refresh", "lake", "semantic", [(790, 947), (850, 947)], "data")
    s.edge("user-ingress", "users", "gateway",
           [(1405, 275), (1405, 330), (1260, 330), (1260, 545), (1310, 545)])
    s.edge("identity", "entra", "app",
           [(1860, 245), (1870, 245), (1870, 900), (1780, 900)], "identity")
    s.edge("gateway-app", "gateway", "app", [(1545, 615), (1545, 870)])
    s.edge("app-dax", "app", "semantic", [(1310, 947), (1170, 947)])
    s.edge("app-kql", "app", "eventhouse",
           [(1310, 905), (1240, 905), (1240, 457), (1170, 457)])
    s.edge("app-ai", "app", "ai",
           [(1780, 925), (1840, 925), (1840, 462), (1920, 462)])
    s.edge("app-geospatial", "app", "geo",
           [(1780, 970), (1850, 970), (1850, 747), (1920, 747)])
    s.edge("read-forecast", "app", "forecast", [(1780, 1000), (1920, 1000)])
    s.edge("audit-export", "app", "evidence",
           [(1545, 1025), (1545, 1160), (2100, 1160), (2100, 1275)], "audit")
    return s.decorate()


def multiregion():
    s = Scene("onegrid-multiregion", "OneGrid - coordinated multiregion recovery",
              "Recover data and dependencies, fence competing publishers, validate journeys, then change application traffic", 1580)
    s.node("users", 1040, 155, 320, 100, "OneGrid users", icon="users")
    s.node("routing", 1020, 300, 360, 135, "Azure Front Door",
           "Enterprise global ingress / WAF\nGated origin enablement", "front-door")
    for suffix, x, name, subtitle in (
        ("a", 40, "Primary deployment stamp", "Active traffic and active ingestion / forecast publisher"),
        ("b", 1260, "Recovery deployment stamp", "Prepared dependencies; publisher fenced until approved"),
    ):
        s.box("region-" + suffix, x, 475, 1100, 810, name, subtitle)
        s.node("app-" + suffix, x + 60, 590, 980, 150, "Azure App Service - OneGrid",
               "Versioned package / regional bindings\nRegion-specific endpoints, workspace/item IDs, sign-in callbacks and network configuration",
               "app-service", "region-" + suffix)
        s.node("fabric-" + suffix, x + 60, 860, 300, 160, "Microsoft Fabric",
               "Capacity / workspace / items\nDAX / KQL / refresh / replay", "fabric", "region-" + suffix)
        s.node("geo-" + suffix, x + 410, 860, 300, 160, "GeoCatalog",
               "Source imagery / STAC\nRecover or rebuild bindings", "geocatalog", "region-" + suffix)
        s.node("blob-" + suffix, x + 760, 860, 300, 160, "Azure Blob Storage",
               "App package / assets / outputs\nApproved copy / recovery policy", "blob-storage", "region-" + suffix)
        s.node("ai-" + suffix, x + 60, 1125, 300, 140, "Azure OpenAI",
               "Model / version / quota\nApproved processing geography", "azure-openai", "region-" + suffix)
        s.node("weather-" + suffix, x + 410, 1125, 300, 140, "Aurora + forecast job",
               "GPU endpoint / job image\nOne active output publisher", "machine-learning", "region-" + suffix)
        s.node("access-" + suffix, x + 760, 1125, 300, 140, "Identity and access",
               "Entra / workload roles\nDNS / ingress / egress", "managed-identity", "region-" + suffix)
        s.edge("app-fabric-" + suffix, "app-" + suffix, "fabric-" + suffix,
               [(x + 210, 740), (x + 210, 860)])
        s.edge("app-geo-" + suffix, "app-" + suffix, "geo-" + suffix,
               [(x + 560, 740), (x + 560, 860)])
        s.edge("app-blob-" + suffix, "app-" + suffix, "blob-" + suffix,
               [(x + 910, 740), (x + 910, 860)])
        s.edge("app-ai-" + suffix, "app-" + suffix, "ai-" + suffix,
               [(x + 60, 675), (x + 25, 675), (x + 25, 1195), (x + 60, 1195)])
        s.edge("app-weather-" + suffix, "app-" + suffix, "weather-" + suffix,
               [(x + 1040, 675), (x + 1080, 675), (x + 1080, 1085),
                (x + 560, 1085), (x + 560, 1125)])
    s.edge("user-route", "users", "routing", [(1200, 255), (1200, 300)])
    s.edge("primary-traffic", "routing", "app-a",
           [(1020, 367), (590, 367), (590, 590)],
           label="Normal application traffic", at=(480, 337), label_width=360)
    s.edge("recovery-traffic", "routing", "app-b",
           [(1380, 367), (1810, 367), (1810, 590)],
           label="Enable after recovery acceptance", at=(1550, 337), label_width=480, dashed=True)
    s.edge("fabric-recovery", "fabric-a", "fabric-b",
           [(250, 1020), (250, 1060), (1470, 1060), (1470, 1020)], "data",
           "Approved data / item recovery; replay and rebind", (620, 1028), 650, True)
    s.edge("blob-recovery", "blob-a", "blob-b",
           [(1100, 940), (1190, 940), (1190, 1320), (2350, 1320), (2350, 940), (2320, 940)], "data",
           "Configured asset / package / output copy", (1490, 1290), 570, True)
    s.box("gates", 40, 1370, 2320, 100, "Recovery release gate",
          "Fence primary writers -> recover data and items -> rebind / refresh -> test DAX, KQL, model calls and freshness -> enable recovery traffic")
    return s.decorate()


def scenes(dark=False):
    result = [logical(), fabric(), enterprise(), regulated(), multiregion()]
    return [dark_scene(scene) for scene in result] if dark else result


def dark_scene(source):
    return card_scene(source, dark=True)


def card_scene(source, dark=False):
    scene = copy.deepcopy(source)
    if dark:
        scene.name += "-dark"
    scene.dark = dark
    scene.cards = True
    items = {item.id: item for item in scene.items}
    nodes = [item for item in scene.items if item.kind == "node"]
    node_ids = {node.id for node in nodes}
    scene.items = [item for item in scene.items if item.parent not in node_ids]
    palette = {INK: "#EDF5FF" if dark else INK, MUTED: "#B7C8DA" if dark else MUTED}
    if dark:
        palette.update({COLORS[kind]: color for kind, color in DARK_COLORS.items()})
    for item in scene.items:
        item.color = palette.get(item.color, item.color)
        if item.id == "weather-read-label":
            item.y = 811
        elif item.id == "aurora-invoke-label":
            item.x = 1178
            item.w = 58
        if item.kind == "scope" and dark:
            item.fill = "#19232D" if item.parent == "1" else "#121B24"
            item.stroke = "#3D85AF"
    for node in nodes:
        node.fill = "#0F171F" if dark else "#FFFFFF"
        node.stroke = "#416780" if dark else "#6D8CA6"
        node.dashed = "(optional)" in node.text[0]
        icon = items.get(node.id + "-icon")
        offset = 76 if icon else 14
        width = node.w - offset - 14
        title, body = node.text
        for title_size, body_size in ((18, 15), (17, 14), (16, 13)):
            heading = lines(title, width, title_size)
            detail = lines(body, width, body_size) if body else ()
            heading_height = len(heading) * (title_size + 5)
            detail_height = len(detail) * (body_size + 5)
            if 24 + heading_height + (5 + detail_height if body else 0) <= node.h:
                break
        else:
            raise ValueError(f"{scene.name}/{node.id}: card text does not fit")
        if icon:
            scene.items.append(Item(node.id + "-icon", "icon", node.x + 14,
                                    node.y + 14, 48, min(48, node.h - 28),
                                    parent=node.id, icon=icon.icon))
        scene.text(node.id + "-title", node.x + offset, node.y + 12, width,
                   title, title_size, True, node.id, color=palette[INK])
        if body:
            scene.text(node.id + "-body", node.x + offset,
                       node.y + 17 + heading_height, width, body, body_size,
                       parent=node.id, color=palette[MUTED])

    def trim(points, node):
        for index, (a, b) in enumerate(zip(points, points[1:])):
            if not (node.x <= b[0] <= node.x + node.w
                    and node.y <= b[1] <= node.y + node.h):
                if a[0] == b[0]:
                    boundary = (a[0], node.y if b[1] < node.y else node.y + node.h)
                else:
                    boundary = (node.x if b[0] < node.x else node.x + node.w, a[1])
                return [boundary, *points[index + 1:]]
        raise ValueError(f"{scene.name}/{node.id}: connector never leaves card")

    for edge in scene.edges:
        points = trim(list(edge.points), items[edge.source])
        edge.points = tuple(reversed(trim(list(reversed(points)), items[edge.target])))
    return scene


def grid_svg(height):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{height}" '
        f'viewBox="0 0 {WIDTH} {height}"><defs>'
        '<pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">'
        '<path d="M24,0 H0 V24" fill="none" stroke="#25313D" stroke-width="0.7"/>'
        '</pattern></defs>'
        f'<rect width="100%" height="100%" fill="{DARK_BACKGROUND}"/>'
        '<rect width="100%" height="100%" fill="url(#grid)"/></svg>'
    )


def gallery(views):
    labels = ("Baseline", "Fabric data and analytics", "Enterprise landing zone",
              "Regulated workload", "Multiregion recovery")
    rows = []
    sections = []
    for scene, label in zip(views, labels):
        name = escape(scene.name)
        rows.append(f'<tr><th scope="row"><a href="#{name}">{label}</a></th>'
                    f'<td>{escape(scene.description)}</td></tr>')
        sections.append(
            f'<section id="{name}"><h2>{label}</h2><p>{escape(scene.description)}</p>'
            f'<p><a href="{name}.svg">Open scalable diagram</a> | '
            f'<a href="{name}.png">Open PNG</a></p>'
            f'<a href="{name}.svg"><img src="{name}.svg" '
            f'width="{WIDTH}" height="{scene.height}" alt="{escape(scene.title)}"></a>'
            '<p><a href="#top">Back to configurations</a></p></section>'
        )
    return (
        '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<title>OneGrid - dark architecture configurations</title><style>'
        ':root{color-scheme:dark}html{scroll-behavior:smooth}'
        'body{margin:0;background:#0C1117;color:#EDF5FF;font:16px/1.6 "Segoe UI",Arial,sans-serif}'
        'main{max-width:1800px;margin:auto;padding:32px}h1{font-size:36px;margin:0 0 12px}'
        'h2{font-size:28px}a{color:#63B9FF}a:focus-visible{outline:2px solid #FFB365}'
        'table{width:100%;border-collapse:collapse;margin:28px 0}'
        'th,td{border:1px solid #416780;padding:14px;text-align:left}'
        'tr:nth-child(even){background:#19232D}section{margin:60px 0;scroll-margin-top:24px}'
        'img{display:block;width:100%;height:auto;border:1px solid #416780;border-radius:8px}'
        'p{color:#B7C8DA}@media(max-width:700px){main{padding:16px}h1{font-size:28px}}'
        '</style></head><body><main id="top"><h1>OneGrid architecture configurations</h1>'
        '<p>Dark, grid-backed views with official Microsoft icons, service details, '
        'controlled boundaries, and labeled traffic flows. Click a diagram to inspect it at full size.</p>'
        '<p><a href="onegrid-architecture-dark.drawio">Open the editable five-page draw.io document</a>'
        ' | <a href="README.md">Diagram guide and light versions</a></p>'
        '<table><thead><tr><th scope="col">Configuration</th>'
        '<th scope="col">Design focus</th></tr></thead><tbody>'
        + "".join(rows) + '</tbody></table>' + "".join(sections)
        + '</main></body></html>\n'
    )


def route_icons(scene):
    items = {item.id: item for item in scene.items}

    def terminal(node, point, other):
        icon = items.get(node.id + "-icon")
        if icon is None:
            return [point]
        center = node.x + node.w / 2
        if point[1] == node.y + node.h:
            near_center = abs(point[0] - center) < node.w / 10
            left = other.x + other.w / 2 < center if near_center else point[0] < center
            labels = [item for item in scene.items
                      if item.parent == node.id and item.kind == "text"]
            half_width = max(
                (len(line) * label.size * 0.58 / 2 for label in labels for line in label.text),
                default=icon.w / 2,
            ) + 20
            outside = (min(icon.x - 12, round(center - half_width)) if left
                       else max(icon.x + icon.w + 12, round(center + half_width)))
            port = (icon.x if left else icon.x + icon.w, icon.y + round(icon.h * 0.8))
            return [port, (outside, port[1]), (outside, point[1]), point]
        if point[1] == node.y:
            port = (icon.x + icon.w // 2, icon.y)
            return [port, (port[0], point[1]), point]
        fraction = min(0.85, max(0.15, (point[1] - node.y) / node.h))
        port = (icon.x if point[0] == node.x else icon.x + icon.w,
                icon.y + (icon.h - 3 if node.h < 120 and point[0] != node.x else round(icon.h * fraction)))
        return [port, (point[0], port[1]), point]

    for edge in scene.edges:
        source, target = items[edge.source], items[edge.target]
        start = terminal(source, edge.points[0], target)
        end = terminal(target, edge.points[-1], source)
        if len(edge.points) == 2 and edge.points[0][0] == edge.points[1][0]:
            if len(start) == 4:
                start = start[:2] + [(start[1][0], edge.points[-1][1])]
            if len(end) == 4:
                end = end[:2] + [(end[1][0], edge.points[0][1])]
        if len(edge.points) == 2 and edge.points[0][1] == edge.points[1][1]:
            mid = (edge.points[0][0] + edge.points[-1][0]) // 2
            points = [start[0], (mid, start[0][1]), (mid, end[0][1]), end[0]]
        else:
            points = start + list(edge.points[1:-1]) + list(reversed(end))
        simplified = []
        for point in points:
            if simplified and point == simplified[-1]:
                continue
            while len(simplified) >= 2:
                a, b = simplified[-2:]
                if not (a[0] == b[0] == point[0] or a[1] == b[1] == point[1]):
                    break
                simplified.pop()
            simplified.append(point)
        edge.points = tuple(simplified)
    return scene


def image_data(icon, drawio=False):
    encoded = base64.b64encode((HERE / "assets" / (icon + ".svg")).read_bytes()).decode("ascii")
    # mxGraph's image data-URI style uses base64 without the CSS-style semicolon.
    return ("data:image/svg+xml," if drawio else "data:image/svg+xml;base64,") + encoded


def svg(scene):
    colors = DARK_COLORS if scene.dark else COLORS
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{scene.height}" '
        f'viewBox="0 0 {WIDTH} {scene.height}" role="img" aria-labelledby="title description">',
        f'<title id="title">{escape(scene.title)}</title>',
        f'<desc id="description">{escape(scene.description)}</desc>',
        '<defs>',
    ]
    for kind, color in colors.items():
        out.append(f'<marker id="arrow-{kind}" markerWidth="10" markerHeight="8" refX="9" refY="4" '
                   f'orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L10,4 L0,8 Z" fill="{color}"/></marker>')
    background = (grid_svg(scene.height) if scene.dark
                  else '<rect width="100%" height="100%" fill="#FFFFFF"/>')
    out.extend(['</defs>', background,
                '<g font-family="Segoe UI,Arial,sans-serif">'])
    boxes = [item for item in scene.items if item.kind == "scope"]
    foreground = [item for item in scene.items if item.kind != "scope"]
    for item in boxes:
        out.append(rect_svg(item))
    if scene.cards:
        out.extend(rect_svg(item) for item in scene.items if item.kind == "node")
    for edge in scene.edges:
        points = " ".join(f"{x},{y}" for x, y in edge.points)
        dashed = edge.dashed or edge.kind in ("control", "identity", "audit")
        dash = ' stroke-dasharray="9 6"' if dashed else ""
        out.append(f'<polyline id="{edge.id}" points="{points}" fill="none" stroke="{colors[edge.kind]}" '
                   f'stroke-width="2.5" stroke-linejoin="round"{dash} marker-end="url(#arrow-{edge.kind})"/>')
    for item in foreground:
        if item.kind == "node":
            out.append(f'<g id="{item.id}"><title>{escape(" - ".join(item.text))}</title></g>')
        elif item.kind in ("text", "edge-label"):
            if item.kind == "edge-label":
                out.append(f'<rect x="{item.x - 3}" y="{item.y - 1}" width="{item.w + 6}" '
                           f'height="{item.h + 2}" rx="3" fill="{DARK_BACKGROUND if scene.dark else "#FFFFFF"}" fill-opacity="0.96"/>')
            text_x = item.x + item.w / 2 if item.align == "center" else item.x
            content = "".join(
                f'<tspan x="{text_x:g}" y="{item.y + item.size + i * (item.size + 5)}">{escape(line)}</tspan>'
                for i, line in enumerate(item.text)
            )
            out.append(f'<text id="{item.id}" font-size="{item.size}" fill="{item.color}" '
                       f'text-anchor="{"middle" if item.align == "center" else "start"}" '
                       f'font-weight="{700 if item.bold else 400}">{content}</text>')
        elif item.kind == "icon":
            out.append(f'<image id="{item.id}" x="{item.x}" y="{item.y}" width="{item.w}" height="{item.h}" '
                       f'preserveAspectRatio="xMidYMid meet" href="{image_data(item.icon)}"/>')
        elif item.kind == "swatch":
            dash = ' stroke-dasharray="7 4"' if item.dashed else ""
            out.append(f'<path d="M{item.x},{item.y} h{item.w}" stroke="{item.color}" stroke-width="3"{dash}/>')
    return "\n".join(out + ["</g></svg>", ""])


def rect_svg(item):
    dash = ' stroke-dasharray="8 5"' if item.dashed else ""
    return (f'<rect id="{item.id}" x="{item.x}" y="{item.y}" width="{item.w}" height="{item.h}" '
            f'rx="7" fill="{item.fill}" stroke="{item.stroke}" stroke-width="1.5"{dash}/>')


def drawio_page(scene):
    colors = DARK_COLORS if scene.dark else COLORS
    background = DARK_BACKGROUND if scene.dark else "#FFFFFF"
    diagram = ET.Element("diagram", {"id": scene.name, "name": scene.title})
    model = ET.SubElement(diagram, "mxGraphModel", {
        "dx": str(WIDTH), "dy": str(scene.height), "grid": "1", "gridSize": "10",
        "guides": "1", "connect": "1", "page": "1", "pageScale": "1",
        "pageWidth": str(WIDTH), "pageHeight": str(scene.height), "background": background,
    })
    root = ET.SubElement(model, "root")
    ET.SubElement(root, "mxCell", {"id": "0"})
    ET.SubElement(root, "mxCell", {"id": "1", "parent": "0"})
    if scene.dark:
        encoded = base64.b64encode(grid_svg(scene.height).encode("utf-8")).decode("ascii")
        cell = ET.SubElement(root, "mxCell", {
            "id": "page-grid", "parent": "1", "vertex": "1",
            "style": "shape=image;imageAspect=0;locked=1;connectable=0;"
                     f"image=data:image/svg+xml,{encoded};",
        })
        ET.SubElement(cell, "mxGeometry", {
            "x": "0", "y": "0", "width": str(WIDTH),
            "height": str(scene.height), "as": "geometry",
        })
    items = {item.id: item for item in scene.items}
    for item in scene.items:
        style = "fontFamily=Segoe UI;html=1;whiteSpace=wrap;"
        attrs = {"id": item.id, "parent": item.parent, "vertex": "1"}
        if item.kind == "scope":
            style += (f"rounded=1;arcSize=4;container=1;collapsible=0;fillColor={item.fill};"
                      f"strokeColor={item.stroke};strokeWidth=1.5;dashed={int(item.dashed)};")
        elif item.kind == "node":
            if scene.cards:
                style += (f"rounded=1;arcSize=5;container=1;collapsible=0;"
                          f"fillColor={item.fill};strokeColor={item.stroke};"
                          f"strokeWidth=1.5;dashed={int(item.dashed)};")
            else:
                style += "group;container=1;collapsible=0;"
        elif item.kind in ("text", "edge-label"):
            attrs["value"] = "<br>".join(escape(line) for line in item.text)
            style += (f"text;align={item.align};verticalAlign=top;spacing=0;fontSize={item.size};"
                      f"fontColor={item.color};fontStyle={int(item.bold)};")
            if item.kind == "edge-label":
                style += f"fillColor={background};"
        elif item.kind == "icon":
            style += "shape=image;aspect=fixed;imageAspect=1;image=" + image_data(item.icon, True) + ";"
        elif item.kind == "swatch":
            cell = ET.SubElement(root, "mxCell", {
                "id": item.id, "parent": "1", "edge": "1",
                "style": f"endArrow=none;strokeColor={item.color};strokeWidth=3;dashed={int(item.dashed)};",
            })
            geometry = ET.SubElement(cell, "mxGeometry", {"relative": "1", "as": "geometry"})
            for name, x in (("sourcePoint", item.x), ("targetPoint", item.x + item.w)):
                ET.SubElement(geometry, "mxPoint", {"x": str(x), "y": str(item.y), "as": name})
            continue
        attrs["style"] = style
        holder = root
        if item.kind == "node":
            holder = ET.SubElement(root, "object", {
                "id": attrs.pop("id"), "label": "", "tooltip": "\n".join(item.text),
            })
        cell = ET.SubElement(holder, "mxCell", attrs)
        parent = items.get(item.parent)
        ET.SubElement(cell, "mxGeometry", {
            "x": str(item.x - parent.x if parent else item.x),
            "y": str(item.y - parent.y if parent else item.y),
            "width": str(item.w), "height": str(item.h), "as": "geometry",
        })
    for edge in scene.edges:
        source, target = items[edge.source], items[edge.target]
        start, end = edge.points[0], edge.points[-1]
        style = (
            f"edgeStyle=none;rounded=0;strokeColor={colors[edge.kind]};strokeWidth=2.5;"
            f"endArrow=block;endFill=1;dashed={int(edge.dashed or edge.kind in ('control', 'identity', 'audit'))};"
            f"exitX={(start[0] - source.x) / source.w:g};exitY={(start[1] - source.y) / source.h:g};"
            f"entryX={(end[0] - target.x) / target.w:g};entryY={(end[1] - target.y) / target.h:g};"
            "exitPerimeter=0;entryPerimeter=0;"
        )
        attributes = {
            "id": edge.id, "parent": "1", "edge": "1", "source": edge.source,
            "target": edge.target, "style": style,
        }
        if edge.caption:
            attributes["value"] = edge.caption
            attributes["style"] += f"fontFamily=Segoe UI;fontSize=14;fontColor={colors[edge.kind]};labelBackgroundColor={background};"
        cell = ET.SubElement(root, "mxCell", attributes)
        geometry = ET.SubElement(cell, "mxGeometry", {"relative": "1", "as": "geometry"})
        points = ET.SubElement(geometry, "Array", {"as": "points"})
        for x, y in edge.points[1:-1]:
            ET.SubElement(points, "mxPoint", {"x": str(x), "y": str(y)})
    return diagram


def on_boundary(item, point):
    x, y = point
    return (item.x <= x <= item.x + item.w and item.y <= y <= item.y + item.h
            and (x in (item.x, item.x + item.w) or y in (item.y, item.y + item.h)))


def validate(scene):
    identifiers = [item.id for item in scene.items] + [edge.id for edge in scene.edges]
    if len(identifiers) != len(set(identifiers)):
        raise ValueError(f"{scene.name}: duplicate identifiers")
    items = {item.id: item for item in scene.items}
    for item in scene.items:
        if not (0 <= item.x <= item.x + item.w <= WIDTH
                and 0 <= item.y <= item.y + item.h <= scene.height):
            raise ValueError(f"{scene.name}/{item.id}: outside canvas")
        if item.parent != "1":
            parent = items[item.parent]
            if not (parent.x <= item.x and item.x + item.w <= parent.x + parent.w
                    and parent.y <= item.y and item.y + item.h <= parent.y + parent.h):
                raise ValueError(f"{scene.name}/{item.id}: content overflows {parent.id}")
    nodes = [item for item in scene.items if item.kind == "node"]
    for i, node in enumerate(nodes):
        for other in nodes[i + 1:]:
            if (max(node.x, other.x) < min(node.x + node.w, other.x + other.w)
                    and max(node.y, other.y) < min(node.y + node.h, other.y + other.h)):
                raise ValueError(f"{scene.name}: overlapping nodes {node.id} and {other.id}")
    for edge in scene.edges:
        source = items[edge.source] if scene.cards else items.get(edge.source + "-icon", items[edge.source])
        target = items[edge.target] if scene.cards else items.get(edge.target + "-icon", items[edge.target])
        if not on_boundary(source, edge.points[0]) or not on_boundary(target, edge.points[-1]):
            raise ValueError(f"{scene.name}/{edge.id}: detached edge endpoint")
        for (x1, y1), (x2, y2) in zip(edge.points, edge.points[1:]):
            if x1 != x2 and y1 != y2:
                raise ValueError(f"{scene.name}/{edge.id}: non-orthogonal segment")
            if not (0 <= min(x1, x2) <= max(x1, x2) <= WIDTH
                    and 0 <= min(y1, y2) <= max(y1, y2) <= scene.height):
                raise ValueError(f"{scene.name}/{edge.id}: edge outside canvas")
            for node in nodes:
                if node.id in (edge.source, edge.target):
                    continue
                through_x = x1 == x2 and node.x < x1 < node.x + node.w and max(min(y1, y2), node.y) < min(max(y1, y2), node.y + node.h)
                through_y = y1 == y2 and node.y < y1 < node.y + node.h and max(min(x1, x2), node.x) < min(max(x1, x2), node.x + node.w)
                if through_x or through_y:
                    raise ValueError(f"{scene.name}/{edge.id}: connector crosses {node.id}")
    ET.fromstring(svg(scene))
    ET.fromstring(ET.tostring(drawio_page(scene)))


def outputs(dark=False):
    manifest = json.loads((HERE / "assets" / "manifest.json").read_text(encoding="utf-8"))
    for name, metadata in manifest["icons"].items():
        if sha256((HERE / "assets" / name).read_bytes()).hexdigest() != metadata["sha256"]:
            raise ValueError(f"Official icon changed: {name}")
    document = ET.Element("mxfile", {"host": "app.diagrams.net", "type": "device", "pages": "5"})
    result = {}
    views = scenes(dark)
    for scene in views:
        validate(scene)
        content = svg(scene)
        result[HERE / (scene.name + ".svg")] = content.encode("utf-8")
        document.append(drawio_page(scene))
    ET.indent(document)
    name = "onegrid-architecture-dark.drawio" if dark else "onegrid-architecture.drawio"
    result[HERE / name] = ET.tostring(document, encoding="utf-8", xml_declaration=True) + b"\n"
    if dark:
        result[HERE / "onegrid-dark-gallery.html"] = gallery(views).encode("utf-8")
    return result


def png_outputs(executable, document, dark=False):
    result = {}
    with tempfile.TemporaryDirectory(prefix="onegrid-drawio-") as directory:
        folder = Path(directory)
        source = folder / "onegrid-architecture.drawio"
        source.write_bytes(document)
        for index, scene in enumerate(scenes(dark), 1):
            output = folder / (scene.name + ".png")
            subprocess.run([
                str(executable), "--disable-update", "--export", "--format", "png",
                "--theme", "light", "--size", "page", "--width", str(WIDTH),
                "--page-index", str(index), "--timeout", "60", "--output", str(output),
                str(source),
            ], check=True, timeout=90)
            path = (HERE.parent / "onegrid-logical-architecture.png" if scene.name == "onegrid-logical-architecture"
                    else HERE / (scene.name + ".png"))
            result[path] = output.read_bytes()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--png", action="store_true", help="Render publication PNGs with draw.io Desktop.")
    parser.add_argument("--drawio", type=Path, help="Path to the draw.io Desktop executable (v27.0.2 or later).")
    parser.add_argument("--check", action="store_true", help="Validate and compare generated files without writing.")
    parser.add_argument("--dark", action="store_true", help="Build dark grid-backed service-card views and gallery.")
    args = parser.parse_args()
    if args.png and (args.drawio is None or not args.drawio.is_file()):
        parser.error("--png requires --drawio with the path to a draw.io Desktop executable")
    generated = outputs(args.dark)
    if args.png:
        name = "onegrid-architecture-dark.drawio" if args.dark else "onegrid-architecture.drawio"
        generated.update(png_outputs(args.drawio, generated[HERE / name], args.dark))
    stale = []
    for path, content in generated.items():
        if args.check:
            if not path.exists() or path.read_bytes() != content:
                stale.append(str(path.relative_to(HERE.parent)))
        else:
            path.write_bytes(content)
    if stale:
        raise SystemExit("Generated diagrams are out of date:\n" + "\n".join(stale))
    print(f"{'Verified' if args.check else 'Generated'} {len(generated)} files; five validated editable architecture views.")


if __name__ == "__main__":
    main()
