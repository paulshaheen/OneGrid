import base64
from html.parser import HTMLParser
import ipaddress
import re
import struct
import unittest
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET

import build_architecture_diagrams as drawing
import build_reference_architecture as reference


SVG = "{http://www.w3.org/2000/svg}"
SHEETS = (
    "baseline", "fabric", "enterprise", "dns", "weather",
    "identity", "monitoring", "regulated", "multiregion",
)


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []
        self.ids = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.urls.extend(attrs[key] for key in ("href", "src") if key in attrs)
        if "id" in attrs:
            self.ids.add(attrs["id"])


class ReferenceArchitectureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.views = reference.scenes()
        cls.dark = reference.scenes(dark=True)
        cls.by_name = dict(zip(SHEETS, cls.views))

    def text(self, sheet):
        return "\n".join("\n".join(item.text) for item in self.by_name[sheet].items)

    def paths(self, sheet):
        return {(edge.source, edge.target) for edge in self.by_name[sheet].edges}

    def test_exact_nine_sheets_per_theme(self):
        self.assertEqual(len(self.views), 9)
        self.assertEqual(len(self.dark), 9)
        self.assertEqual([s.name for s in self.views],
                         ["onegrid-reference-" + name for name in SHEETS])
        self.assertEqual([s.name for s in self.dark],
                         [s.name + "-dark" for s in self.views])

    def test_all_geometry_validates(self):
        for scene in self.views + self.dark:
            with self.subTest(scene=scene.name):
                drawing.validate(scene)
                notes = [item for item in scene.items
                         if item.kind == "scope" and item.parent == "1"]
                self.assertTrue(all(item.y + item.h < scene.height - 100 for item in notes))

    def test_themes_preserve_topology_and_full_descriptions(self):
        for light, dark in zip(self.views, self.dark):
            self.assertEqual([(e.id, e.source, e.target, e.points) for e in light.edges],
                             [(e.id, e.source, e.target, e.points) for e in dark.edges])
            self.assertEqual([(i.id, i.text) for i in light.items if i.kind == "node"],
                             [(i.id, i.text) for i in dark.items if i.kind == "node"])

    def test_scope_headings_do_not_overlap_cards_or_connectors(self):
        for scene in self.views:
            nodes = [item for item in scene.items if item.kind == "node"]
            node_ids = {item.id for item in nodes}
            for text in (item for item in scene.items
                         if item.kind == "text" and item.parent not in node_ids):
                for node in nodes:
                    overlap = (
                        max(text.x, node.x) < min(text.x + text.w, node.x + node.w)
                        and max(text.y, node.y) < min(text.y + text.h, node.y + node.h)
                    )
                    self.assertFalse(overlap, (scene.name, text.id, node.id))
                for edge in scene.edges:
                    for a, b in zip(edge.points, edge.points[1:]):
                        if a[0] == b[0]:
                            crosses = (
                                text.x < a[0] < text.x + text.w
                                and max(min(a[1], b[1]), text.y)
                                < min(max(a[1], b[1]), text.y + text.h)
                            )
                        else:
                            crosses = (
                                text.y < a[1] < text.y + text.h
                                and max(min(a[0], b[0]), text.x)
                                < min(max(a[0], b[0]), text.x + text.w)
                            )
                        self.assertFalse(crosses, (scene.name, edge.id, text.id))

    def test_native_pages_are_editable_and_source_attached(self):
        for dark, views in ((False, self.views), (True, self.dark)):
            root = ET.fromstring(reference.document(dark))
            self.assertEqual(root.attrib["pages"], "9")
            for page, scene in zip(root.findall("diagram"), views):
                self.assertEqual(page.attrib["id"], scene.name)
                graph = page.find("mxGraphModel/root")
                groups = {item.attrib["id"]: item for item in graph.findall("object")}
                for node in (item for item in scene.items if item.kind == "node"):
                    self.assertIn(node.text[0], groups[node.id].attrib["tooltip"])
                    self.assertIn("container=1", groups[node.id].find("mxCell").attrib["style"])
                cells = {cell.attrib["id"]: cell for cell in graph.findall("mxCell")}
                for edge in scene.edges:
                    self.assertEqual(cells[edge.id].attrib["source"], edge.source)
                    self.assertEqual(cells[edge.id].attrib["target"], edge.target)
                    self.assertEqual(cells[edge.id].attrib.get("value", ""), edge.caption)

    def test_light_cards_are_white_without_dark_background_grid(self):
        for scene in self.views:
            page = drawing.drawio_page(scene)
            self.assertEqual(page.find("mxGraphModel").attrib["background"], "#FFFFFF")
            self.assertIsNone(page.find(".//mxCell[@id='page-grid']"))
            for group in page.findall(".//object"):
                self.assertIn("fillColor=#FFFFFF;", group.find("mxCell").attrib["style"])
                self.assertIn("strokeColor=#6D8CA6;", group.find("mxCell").attrib["style"])

    def test_dark_grid_is_locked_and_cards_have_contrast(self):
        for scene in self.dark:
            page = drawing.drawio_page(scene)
            cell = page.find(".//mxCell[@id='page-grid']")
            self.assertIn("locked=1", cell.attrib["style"])
            self.assertEqual(page.find("mxGraphModel").attrib["background"],
                             drawing.DARK_BACKGROUND)
            for group in page.findall(".//object"):
                self.assertIn("fillColor=#0F171F;", group.find("mxCell").attrib["style"])

    def test_native_icons_use_valid_embedded_svg(self):
        for scene in self.views:
            images = [cell for cell in drawing.drawio_page(scene).findall(".//mxCell")
                      if "shape=image;" in cell.attrib.get("style", "")]
            self.assertGreater(len(images), 0)
            for cell in images:
                data = cell.attrib["style"].split("image=data:image/svg+xml,", 1)[1].split(";", 1)[0]
                self.assertEqual(ET.fromstring(base64.b64decode(data)).tag, SVG + "svg")

    def test_sources_are_current_and_deterministic(self):
        for dark, name in ((False, "onegrid-reference-architecture.drawio"),
                           (True, "onegrid-reference-architecture-dark.drawio")):
            expected = reference.document(dark)
            self.assertEqual(expected, reference.document(dark))
            self.assertEqual((reference.HERE / name).read_bytes(), expected)
        self.assertEqual((reference.HERE / "onegrid-reference-gallery.html").read_bytes(),
                         reference.gallery())

    def test_png_exports_have_exact_full_page_dimensions(self):
        for scene in self.views + self.dark:
            with self.subTest(scene=scene.name):
                data = (reference.HERE / (scene.name + ".png")).read_bytes()
                self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
                width, height = struct.unpack(">II", data[16:24])
                self.assertEqual(width, drawing.WIDTH)
                self.assertIn(height, (scene.height, scene.height + 1))

    def test_svg_exports_have_full_page_geometry_and_embedded_icons(self):
        for scene in self.views + self.dark:
            with self.subTest(scene=scene.name):
                root = ET.parse(reference.HERE / (scene.name + ".svg")).getroot()
                self.assertEqual(root.attrib["viewBox"],
                                 f"0 0 {drawing.WIDTH} {scene.height}")
                self.assertEqual(root.attrib["width"], f"{drawing.WIDTH}px")
                self.assertEqual(root.attrib["height"], f"{scene.height}px")
                self.assertFalse(root.findall(".//" + SVG + "script"))
                images = root.findall(".//" + SVG + "image")
                self.assertGreater(len(images), 0)
                for image in images:
                    uri = image.attrib.get("href", image.attrib.get(
                        "{http://www.w3.org/1999/xlink}href", ""))
                    self.assertTrue(uri.startswith("data:image/"), uri[:80])

    def test_captions_remain_inside_native_page_bounds(self):
        for scene in self.views:
            for edge in (edge for edge in scene.edges if edge.caption):
                segments = list(zip(edge.points, edge.points[1:]))
                half = sum(abs(a[0] - b[0]) + abs(a[1] - b[1])
                           for a, b in segments) / 2
                for a, b in segments:
                    length = abs(a[0] - b[0]) + abs(a[1] - b[1])
                    if length and half <= length:
                        x = a[0] + (b[0] - a[0]) * half / length
                        y = a[1] + (b[1] - a[1]) * half / length
                        break
                    half -= length
                with self.subTest(scene=scene.name, edge=edge.id):
                    margin = len(edge.caption) * 4 + 4
                    self.assertGreaterEqual(x - margin, 0)
                    self.assertLessEqual(x + margin, drawing.WIDTH)
                    self.assertGreaterEqual(y - 10, 0)
                    self.assertLessEqual(y + 10, scene.height)

    def test_baseline_covers_real_runtime_and_control_paths(self):
        required = {
            ("connector", "stream"), ("stream", "eventhouse"), ("app", "eventhouse"),
            ("app", "semantic"), ("app", "agent"), ("app", "openai"),
            ("app", "catalog"), ("app", "blob"), ("app", "arm"), ("arm", "job"),
            ("job", "ml"), ("job", "outputs"), ("app", "outputs"), ("users", "maps"),
            ("catalog", "blob"), ("notebooks", "lake"), ("ontology", "lake"),
            ("lake", "outputs"),
        }
        self.assertTrue(required <= self.paths("baseline"))
        self.assertNotIn(("app", "ml"), self.paths("baseline"))
        self.assertIn("publicNetworkAccess = Enabled", self.text("baseline"))
        self.assertIn("120 h from analysis time", self.text("baseline"))

    def test_enterprise_separates_inbound_outbound_and_job_networks(self):
        scene = self.by_name["enterprise"]
        items = {item.id: item for item in scene.items}
        self.assertEqual(items["app-pe"].parent, "app-pe-subnet")
        self.assertEqual(items["integration"].parent, "integration-subnet")
        self.assertEqual(items["job"].parent, "ca-subnet")
        self.assertEqual(items["app"].parent, "service-hosted")
        for id in ("blob", "openai", "fabric", "ml", "acr"):
            self.assertIn((id + "-pe", id), self.paths("enterprise"))
        self.assertIn(("job", "ml-pe"), self.paths("enterprise"))
        self.assertNotIn(("integration", "ml-pe"), self.paths("enterprise"))
        text = self.text("enterprise")
        for marker in ("outboundVnetRouting.allTraffic = true", "Microsoft.Web/serverFarms",
                       "Microsoft.App/environments", "Premium", "Baseline",
                       "PE /32", "managed", "GeoCatalog"):
            self.assertIn(marker.lower(), text.lower())

    def test_illustrative_subnets_are_contained_and_non_overlapping(self):
        for vnet, subnets in (
            ("10.10.0.0/16", ("10.10.0.0/26", "10.10.1.0/28", "10.10.1.16/28")),
            ("10.20.0.0/16", ("10.20.0.0/24", "10.20.1.0/24", "10.20.2.0/26", "10.20.4.0/23")),
        ):
            networks = [ipaddress.ip_network(value) for value in subnets]
            self.assertTrue(all(net.subnet_of(ipaddress.ip_network(vnet)) for net in networks))
            for index, net in enumerate(networks):
                self.assertTrue(all(not net.overlaps(other) for other in networks[index + 1:]))

    def test_dns_has_distinct_resolution_and_forwarding_branches(self):
        self.assertTrue({
            ("app-dns", "inbound"), ("job-dns", "inbound"), ("corporate-dns", "inbound"),
            ("inbound", "azure-dns"), ("azure-dns", "zones"), ("azure-dns", "rules"),
            ("rules", "outbound"), ("outbound", "corporate-dns"),
        } <= self.paths("dns"))
        self.assertNotIn(("outbound", "inbound"), self.paths("dns"))
        text = self.text("dns")
        for marker in ("privatelink.azurewebsites.net", "privatelink.blob.core.windows.net",
                       "privatelink.openai.azure.com", "privatelink.azurecr.io",
                       "privatelink.api.azureml.ms", "Cross-region", "actual KQL"):
            self.assertIn(marker, text)

    def test_fabric_protocol_permissions_and_source_connection_contracts(self):
        text = self.text("fabric")
        for marker in ("ProcessedIngestion", "TDS TCP 1433", "Import", "connection ID",
                       "workspace-identity", "ADLS", "No Eventhouse-to-Lakehouse",
                       "not per-user", "semantic-model datasource"):
            self.assertIn(marker, text)
        self.assertNotIn(("app", "sql"), self.paths("fabric"))
        self.assertIn(("agent", "import"), self.paths("fabric"))
        self.assertIn(("ontology", "lake"), self.paths("fabric"))
        self.assertIn(("pipeline", "lake"), self.paths("fabric"))

    def test_weather_job_model_and_storage_are_separate(self):
        text = self.text("weather")
        for marker in ("00 and 06 UTC", "20 six-hour steps", "AZURE_CLIENT_ID",
                       "AADToken", "SAS", "firewall", "not calibrated", "NHC",
                       "No inbound HTTP", "prior output"):
            self.assertIn(marker.lower(), text.lower())
        self.assertTrue({("entry", "registry"), ("consumer", "outputs")} <= self.paths("weather"))
        self.assertTrue({("entry", "prepare"), ("prepare", "invoke"),
                         ("invoke", "normalize")} <= self.paths("weather"))

    def test_seven_distinct_identity_scopes(self):
        scene = self.by_name["identity"]
        for id in ("user", "app", "job", "ingest", "refresh", "workspace", "deploy"):
            self.assertIn((id, id + "-credential"), self.paths("identity"))
            self.assertIn((id + "-credential", id + "-scope"), self.paths("identity"))
        self.assertTrue(all(edge.kind == "identity" for edge in scene.edges))
        for marker in ("GeoCatalog Administrator", "AzureML Data Scientist",
                       "User Access Administrator", "WorkspaceIdentity",
                       "not automatic row filtering", "dedicated", "scoped to the one job"):
            self.assertIn(marker.lower(), self.text("identity").lower())

    def test_monitoring_is_out_of_band_and_marks_actual_wiring(self):
        scene = self.by_name["monitoring"]
        self.assertEqual(len(scene.edges), 12)
        self.assertTrue(all(edge.kind == "audit" for edge in scene.edges))
        for marker in ("BASELINE WIRED", "ENTERPRISE ADDITION", "AMPLS",
                       "retention", "redaction", "alert", "Application Insights",
                       "diagnostic", "does not automatically export"):
            self.assertIn(marker.lower(), self.text("monitoring").lower())

    def test_regulated_application_cannot_follow_a_path_into_ot(self):
        reachable = {"app"}
        edges = self.by_name["regulated"].edges
        while True:
            expanded = reachable | {edge.target for edge in edges if edge.source in reachable}
            if expanded == reachable:
                break
            reachable = expanded
        self.assertFalse(reachable & {"historian", "connector"})
        self.assertIn("not blanket enforcement", self.by_name["regulated"].description)
        self.assertIn("Governance configuration is disabled", self.text("regulated"))

    def test_multiregion_is_gated_and_does_not_claim_automatic_recovery(self):
        scene = self.by_name["multiregion"]
        edges = {edge.id: edge for edge in scene.edges}
        for id in ("G03-recovery-origin", "G04-fabric-recovery", "G05-storage-recovery"):
            self.assertTrue(edges[id].dashed)
        for marker in ("Premium", "managed", "fence", "LRS", "actual", "sole-publisher",
                       "X-Azure-FDID", "not", "refresh"):
            self.assertIn(marker.lower(), self.text("multiregion").lower())

    def test_gallery_targets_and_fragments_resolve(self):
        links = Links()
        links.feed(reference.gallery().decode("utf-8"))
        for url in links.urls:
            target = urlsplit(url)
            if target.path:
                self.assertTrue((reference.HERE / unquote(target.path)).is_file(), url)
            elif target.fragment:
                self.assertIn(target.fragment, links.ids)

    def test_related_documentation_links_resolve(self):
        architecture = reference.HERE.parent / "architecture"
        paths = [architecture / name for name in (
            "traffic-and-security.md", "baseline.md", "fabric.md",
            "enterprise-landing-zone.md", "regulated-workload.md", "multiregion.md",
        )]
        paths.append(reference.HERE / "README.md")
        for path in paths:
            for url in re.findall(r"\]\(([^)]+)\)", path.read_text(encoding="utf-8")):
                target = urlsplit(url.strip("<>"))
                if target.scheme or not target.path:
                    continue
                with self.subTest(path=path.name, url=url):
                    self.assertTrue((path.parent / unquote(target.path)).exists())


if __name__ == "__main__":
    unittest.main()
