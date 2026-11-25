"""Tests for the OneGrid diagram engine, sheets, generated outputs and doc links."""

from pathlib import Path
import re
import sys
import unittest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))

import build_diagrams  # noqa: E402
import diagram_engine as engine  # noqa: E402
from sheets import ORDER  # noqa: E402


class SheetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = engine.verify_icons()
        cls.loaded = build_diagrams.load()
        cls.sheets = {key: sheet for key, _, sheet in cls.loaded}

    def test_every_sheet_builds_validates_and_is_named(self):
        self.assertEqual([key for key, _, _ in self.loaded], list(ORDER))
        for key, module, sheet in self.loaded:
            self.assertEqual(sheet.name, f"onegrid-reference-{key}")
            self.assertTrue(module.LABEL and module.SUMMARY, key)
            self.assertTrue(sheet.cards and sheet.flows, key)

    def test_committed_outputs_are_current(self):
        for _, _, sheet in self.loaded:
            for theme, suffix in (("light", ""), ("dark", "-dark")):
                svg = HERE / f"{sheet.name}{suffix}.svg"
                self.assertTrue(svg.is_file(), svg.name)
                self.assertEqual(svg.read_text(encoding="utf-8"), sheet.render(theme),
                                 f"{svg.name} is stale; run build_diagrams.py --png")
                self.assertTrue((HERE / f"{sheet.name}{suffix}.png").is_file(), f"{sheet.name}{suffix}.png")
        gallery = HERE / "onegrid-reference-gallery.html"
        self.assertEqual(gallery.read_bytes(), build_diagrams.gallery(self.loaded))

    def test_icons_are_official_and_recorded(self):
        for key, sheet in self.sheets.items():
            for item in (*sheet.cards, *sheet.groups):
                if item.icon and not item.icon.startswith("glyph:"):
                    self.assertIn(f"{item.icon}.svg", self.manifest["icons"], f"{key}: {item.id}")

    def test_svgs_are_self_contained(self):
        for key, sheet in self.sheets.items():
            for theme in ("light", "dark"):
                svg = sheet.render(theme)
                external = [h for h in re.findall(r'href="([^"]+)"', svg)
                            if not h.startswith(("#", "data:image/svg+xml;base64,"))]
                self.assertEqual(external, [], f"{key} {theme}")

    def test_steps_are_numbered_from_one(self):
        for key, sheet in self.sheets.items():
            # A number may repeat when one step happens on parallel paths (e.g. two DNS clients).
            numbers = sorted({n for n, _, _ in sheet.steps})
            self.assertTrue(numbers, f"{key} has no numbered steps")
            self.assertEqual(numbers, list(range(1, len(numbers) + 1)), key)

    def test_baseline_flow_semantics(self):
        sheet = self.sheets["baseline"]
        flows = {f.id: f for f in sheet.flows}
        self.assertEqual(sheet.style, "learn")
        # Both serving stages feed the web app; it calls Azure OpenAI but never the weather model.
        self.assertEqual({(flows[i].src, flows[i].dst) for i in ("e1", "e2")},
                         {("f-serve", "app"), ("a-serve", "app")})
        self.assertFalse(any(f.src == "app" and f.dst in {"aurora", "channel"} for f in sheet.flows))
        self.assertEqual((flows["e5"].src, flows["e5"].dst), ("app", "openai"))
        # Basemaps reach the browser directly; the ontology binding is control, not data.
        self.assertEqual((flows["e4"].src, flows["e4"].dst), ("basemap", "users"))
        self.assertEqual(flows["f8"].kind, "control")
        # Steps 1-8 match the README workflow.
        self.assertEqual(sorted(n for n, _, _ in sheet.steps), list(range(1, 9)))

    def test_validator_rejects_bad_layouts(self):
        sheet = engine.Sheet("t", "e", "t", "s", width=700, height=500)
        sheet.card("a", 40, 300, 200, "A title far too long to fit inside this card", ["x"], icon="app-service")
        with self.assertRaises(ValueError):
            sheet.validate()
        sheet = engine.Sheet("t", "e", "t", "s", width=700, height=500)
        sheet.card("a", 40, 300, 200, "A")
        sheet.card("b", 400, 300, 200, "B")
        sheet.flow("diagonal", "a", "b", [(240, 320), (400, 330)])
        with self.assertRaises(ValueError):
            sheet.validate()
        sheet = engine.Sheet("t", "e", "t", "s", width=900, height=500)
        sheet.card("a", 40, 300, 200, "A")
        sheet.card("m", 340, 300, 200, "M")
        sheet.card("b", 640, 300, 200, "B")
        sheet.flow("through", "a", "b", sides=("r", "l"))
        with self.assertRaises(ValueError):
            sheet.validate()


class LinkTests(unittest.TestCase):
    def test_doc_links_to_diagrams_resolve(self):
        pages = [ROOT / "README.md", *sorted((ROOT / "docs").rglob("*.md"))]
        pattern = re.compile(r'(?:\]\(|src="|srcset="|href=")([^)"#\s]+\.(?:png|svg|html|py|drawio))')
        for page in pages:
            for target in pattern.findall(page.read_text(encoding="utf-8")):
                if target.startswith(("http://", "https://")):
                    continue
                if "diagrams" in target or page.parent == HERE:
                    self.assertTrue((page.parent / target).resolve().exists(),
                                    f"{page.relative_to(ROOT)} links to missing {target}")


if __name__ == "__main__":
    unittest.main()
