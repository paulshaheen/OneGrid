import base64
import copy
import re
import struct
import unittest
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET

import build_architecture_diagrams as diagrams


SVG = "{http://www.w3.org/2000/svg}"


class ArchitectureDiagramsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scenes = diagrams.scenes()
        cls.by_name = {scene.name: scene for scene in cls.scenes}
        cls.generated = diagrams.outputs()

    def test_exact_five_architecture_views(self):
        self.assertEqual(len(self.scenes), 5)
        self.assertEqual(set(self.by_name), {
            "onegrid-logical-architecture", "onegrid-fabric",
            "onegrid-enterprise-landing-zone", "onegrid-regulated-workload",
            "onegrid-multiregion",
        })

    def test_all_layouts_validate(self):
        for scene in self.scenes:
            with self.subTest(scene=scene.name):
                diagrams.validate(scene)

    def test_generated_sources_are_current(self):
        for path, content in self.generated.items():
            with self.subTest(path=path.name):
                self.assertEqual(path.read_bytes(), content)

    def test_generation_is_deterministic(self):
        self.assertEqual(self.generated, diagrams.outputs())

    def test_svg_icons_are_embedded_and_valid(self):
        for scene in self.scenes:
            root = ET.fromstring(diagrams.svg(scene))
            self.assertIsNotNone(root.find(SVG + "title"))
            self.assertIsNotNone(root.find(SVG + "desc"))
            images = root.findall(".//" + SVG + "image")
            self.assertGreater(len(images), 0)
            for image in images:
                uri = image.attrib["href"]
                self.assertTrue(uri.startswith("data:image/svg+xml;base64,"))
                self.assertEqual(ET.fromstring(base64.b64decode(uri.split(",", 1)[1])).tag, SVG + "svg")
                self.assertEqual(image.attrib["preserveAspectRatio"], "xMidYMid meet")
            self.assertFalse(root.findall(".//" + SVG + "script"))

    def test_drawio_has_five_editable_native_pages(self):
        root = ET.fromstring(self.generated[diagrams.HERE / "onegrid-architecture.drawio"])
        self.assertEqual(root.attrib["pages"], "5")
        for page, scene in zip(root.findall("diagram"), self.scenes):
            self.assertEqual(page.attrib["id"], scene.name)
            graph = page.find("mxGraphModel/root")
            self.assertIsNotNone(graph)
            groups = {item.attrib["id"]: item for item in graph.findall("object")}
            for node in (item for item in scene.items if item.kind == "node"):
                cell = groups[node.id].find("mxCell")
                self.assertIn("group;", cell.attrib["style"])
                self.assertNotIn("strokeColor", cell.attrib["style"])
                self.assertIn(node.text[0], groups[node.id].attrib["tooltip"])
            cells = {cell.attrib["id"]: cell for cell in graph.findall("mxCell")}
            for edge in scene.edges:
                cell = cells[edge.id]
                self.assertEqual(cell.attrib["source"], edge.source)
                self.assertEqual(cell.attrib["target"], edge.target)
                self.assertIn("exitPerimeter=0", cell.attrib["style"])
                self.assertIn("entryPerimeter=0", cell.attrib["style"])
            for kind in diagrams.COLORS:
                cell = cells["legend-" + kind]
                self.assertEqual(cell.attrib["edge"], "1")
                self.assertEqual(len(cell.findall("mxGeometry/mxPoint")), 2)

    def test_drawio_images_use_native_data_uri_format(self):
        for scene in self.scenes:
            page = diagrams.drawio_page(scene)
            for cell in page.findall(".//mxCell"):
                style = cell.attrib.get("style", "")
                if "shape=image;" in style:
                    encoded = style.split("image=data:image/svg+xml,", 1)[1].split(";", 1)[0]
                    self.assertEqual(ET.fromstring(base64.b64decode(encoded)).tag, SVG + "svg")

    def test_png_previews_are_full_page_native_exports(self):
        for scene in self.scenes:
            path = (diagrams.HERE.parent / "onegrid-logical-architecture.png"
                    if scene.name == "onegrid-logical-architecture"
                    else diagrams.HERE / (scene.name + ".png"))
            data = path.read_bytes()
            self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
            width, height = struct.unpack(">II", data[16:24])
            self.assertEqual(width, diagrams.WIDTH)
            # draw.io's full-page PNG export can include the final page boundary pixel.
            self.assertIn(height, (scene.height, scene.height + 1))

    def assert_flow(self, scene, edge_id, source, target, kind):
        edge = next(edge for edge in self.by_name[scene].edges if edge.id == edge_id)
        self.assertEqual((edge.source, edge.target, edge.kind), (source, target, kind))

    def test_baseline_runtime_and_weather_flow_contracts(self):
        scene = "onegrid-logical-architecture"
        for contract in (
            ("app-kql", "app", "eventhouse", "request"),
            ("app-dax", "app", "semantic", "request"),
            ("agent-grounding", "dataagent", "semantic", "request"),
            ("import-refresh", "lakehouse", "semantic", "data"),
            ("catalog-ingest", "catalog", "assets", "request"),
            ("aurora-invoke", "job", "aml", "request"),
            ("forecast-publish", "job", "outputs", "data"),
            ("weather-read", "app", "outputs", "request"),
            ("job-start", "app", "job", "control"),
            ("shortcut-read", "lakehouse", "outputs", "request"),
        ):
            with self.subTest(edge=contract[0]):
                self.assert_flow(scene, *contract)

    def test_fabric_sources_and_serving_are_distinct(self):
        scene = self.by_name["onegrid-fabric"]
        self.assert_flow(scene.name, "agent-model", "agent", "import", "request")
        self.assert_flow(scene.name, "model-refresh", "sql", "import", "data")
        self.assert_flow(scene.name, "app-dax", "app", "import", "request")
        self.assert_flow(scene.name, "ontology-binding", "ontology", "lake", "control")
        self.assertFalse(any(edge.source in ("raw", "kql") and edge.target == "lake"
                             for edge in scene.edges))
        self.assertFalse(any(edge.source == "app" and edge.target == "sql" for edge in scene.edges))

    def test_enterprise_network_separates_inbound_and_outbound(self):
        scene = self.by_name["onegrid-enterprise-landing-zone"]
        nodes = {item.id: item for item in scene.items}
        self.assertEqual(nodes["app-pe"].parent, "pe-subnet")
        self.assertEqual(nodes["integration"].parent, "integration-subnet")
        self.assertEqual(nodes["app"].parent, "1")
        self.assertEqual(nodes["fabric"].parent, "saas")
        self.assert_flow(scene.name, "gateway-origin", "gateway", "app-pe", "request")
        self.assert_flow(scene.name, "origin-app", "app-pe", "app", "request")
        self.assert_flow(scene.name, "app-outbound", "app", "integration", "request")
        self.assert_flow(scene.name, "egress", "integration", "firewall", "request")

    def test_regulated_workload_has_no_application_to_ot_request_path(self):
        scene = self.by_name["onegrid-regulated-workload"]
        reachable = {"app"}
        while True:
            expanded = reachable | {edge.target for edge in scene.edges
                                    if edge.kind == "request" and edge.source in reachable}
            if expanded == reachable:
                break
            reachable = expanded
        self.assertFalse(reachable & {"pi", "connector"})
        self.assert_flow(scene.name, "ot-publication", "connector", "eventstream", "data")
        self.assert_flow(scene.name, "audit-export", "app", "evidence", "audit")

    def test_browser_map_requests_do_not_use_app_vnet_integration(self):
        scene = self.by_name["onegrid-enterprise-landing-zone"]
        self.assert_flow(scene.name, "browser-map-access", "users", "browsermaps", "request")
        self.assertFalse(any(edge.source == "app" and edge.target == "browsermaps"
                             for edge in scene.edges))

    def test_recovery_is_explicitly_gated(self):
        scene = self.by_name["onegrid-multiregion"]
        edges = {edge.id: edge for edge in scene.edges}
        self.assertFalse(edges["primary-traffic"].dashed)
        self.assertTrue(edges["recovery-traffic"].dashed)
        self.assertTrue(edges["fabric-recovery"].dashed)
        self.assertTrue(edges["blob-recovery"].dashed)
        gates = next(item for item in scene.items if item.id == "gates-subtitle")
        self.assertIn("Fence primary writers", " ".join(gates.text))
        for suffix in ("a", "b"):
            self.assert_flow(scene.name, "app-fabric-" + suffix,
                             "app-" + suffix, "fabric-" + suffix, "request")

    def test_updated_markdown_links_resolve(self):
        root = diagrams.HERE.parent.parent
        documents = [root / "README.md", diagrams.HERE / "README.md"]
        documents.extend((root / "docs" / "architecture").glob("*.md"))
        documents.extend(root / "docs" / name for name in (
            "deployment-and-data-guide.md", "implementations.md",
            "operations.md", "operations-runbook.md",
        ))
        for document in documents:
            text = document.read_text(encoding="utf-8")
            for target in re.findall(r"!?\[[^\]]*\]\(([^)]+)\)", text):
                target = target.strip("<>")
                if urlsplit(target).scheme or target.startswith("#"):
                    continue
                path = document.parent / unquote(target.split("#", 1)[0])
                with self.subTest(document=document.name, target=target):
                    self.assertTrue(path.exists())
            if document.parent.name == "architecture":
                self.assertNotIn("```mermaid", text)

    def test_validator_rejects_duplicate_ids(self):
        scene = copy.deepcopy(self.scenes[0])
        scene.items.append(copy.copy(scene.items[0]))
        with self.assertRaisesRegex(ValueError, "duplicate identifiers"):
            diagrams.validate(scene)

    def test_validator_rejects_detached_icon_connectors(self):
        scene = copy.deepcopy(self.scenes[0])
        edge = next(edge for edge in scene.edges if edge.id == "app-dax")
        edge.points = ((1, 1), *edge.points[1:])
        with self.assertRaisesRegex(ValueError, "detached edge endpoint"):
            diagrams.validate(scene)

    def test_validator_rejects_content_overflow(self):
        scene = copy.deepcopy(self.scenes[0])
        label = next(item for item in scene.items if item.id == "eventstream-title")
        label.h = 1000
        with self.assertRaisesRegex(ValueError, "content overflows"):
            diagrams.validate(scene)


if __name__ == "__main__":
    unittest.main()
