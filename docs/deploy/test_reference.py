"""Tests for the OneGrid deployment docs, parameter reference, and shipped parameter files.

Run: python -m unittest discover -s docs/deploy -p "test_*.py"
"""

from __future__ import annotations

import contextlib
import io
import json
import re
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import build_reference as ref  # noqa: E402

ROOT = ref.ROOT
AZURE = ref.AZURE
PARAMETER_DIR = AZURE / "parameters"
SCHEMA = "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#"
PLACEHOLDER = re.compile(r"<your-[a-z0-9-]+>")

# Validation scripts referenced by the deploy docs that a parallel change adds. A missing
# target in this set doesn't fail the link test; every other relative link must resolve.
PENDING_TARGETS = {
    AZURE / "scripts" / "Test-OneGridPrerequisites.ps1",
    AZURE / "scripts" / "Test-OneGridDeployment.ps1",
}

PARAMS = ref.parse_bicep()
BY_NAME = {p.name: p for p in PARAMS}


def parameter_files() -> list[Path]:
    return sorted(PARAMETER_DIR.glob("*.parameters.json"))


def effective(values: dict, name: str):
    """Value a deployment sees: the file's value, else the template default."""
    entry = values.get(name)
    if entry is None:
        return BY_NAME[name].default
    return entry.get("value", "<key-vault-reference>")


class ReferenceTests(unittest.TestCase):
    def test_generated_reference_is_current(self):
        self.assertTrue(ref.OUTPUT.exists(), "run python docs/deploy/build_reference.py")
        self.assertEqual(ref.OUTPUT.read_text(encoding="utf-8"), ref.render(),
                         "reference/parameters.md is stale; run python docs/deploy/build_reference.py")

    def test_check_mode_passes(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(ref.main(["--check"]), 0)

    def test_parser_reads_every_param_declaration(self):
        declared = re.findall(r"^param\s+(\w+)\s", ref.BICEP.read_text(encoding="utf-8"), re.M)
        self.assertEqual([p.name for p in PARAMS], declared)

    def test_every_parameter_is_grouped_and_documented(self):
        grouped = [name for _, _, names in ref.GROUPS for name in names]
        self.assertEqual(len(grouped), len(set(grouped)), "a parameter is in two groups")
        self.assertEqual(set(grouped), set(BY_NAME), "GROUPS must list every main.bicep parameter")
        text = ref.OUTPUT.read_text(encoding="utf-8")
        self.assertNotIn(f"## {ref.UNGROUPED}", text)
        for p in PARAMS:
            self.assertIn(f'<a id="{ref._anchor(p.name)}"></a>`{p.name}`', text, p.name)
            self.assertTrue(p.description, f"{p.name} has no @description")

    def test_notes_name_real_parameters(self):
        self.assertLessEqual(set(ref.NOTES), set(BY_NAME))

    def test_compiled_template_matches_bicep(self):
        compiled = json.loads((AZURE / "azuredeploy.json").read_text(encoding="utf-8"))["parameters"]
        self.assertEqual(list(compiled), [p.name for p in PARAMS])
        for p in PARAMS:
            arm = compiled[p.name]
            expected_type = "securestring" if p.secure else p.type
            self.assertEqual(arm["type"].lower(), expected_type.lower(), p.name)
            if p.allowed is not None:
                self.assertEqual(arm.get("allowedValues"), p.allowed, p.name)
            if p.max_length is not None:
                self.assertEqual(arm.get("maxLength"), p.max_length, p.name)
            if p.default_expr is None:
                self.assertEqual(arm.get("defaultValue"), p.default, p.name)

    def test_portal_outputs_are_template_parameters(self):
        form = ref.PortalForm()
        self.assertLessEqual(set(form.outputs), set(BY_NAME))
        for name in form.outputs:
            info = form.describe(name)
            self.assertIn(info["step"], form.step_labels, name)
            self.assertTrue(info["where"], name)


class ParameterFileTests(unittest.TestCase):
    def test_files_exist_with_twins(self):
        stems = {p.name[: -len(".parameters.json")] for p in parameter_files()}
        self.assertEqual(stems, {"baseline-required", "baseline-full",
                                 "brownfield-existing-capacity", "weather-aurora"})
        for stem in stems:
            self.assertTrue((PARAMETER_DIR / f"{stem}.bicepparam").exists(), stem)

    def test_json_files_use_real_parameters_and_valid_values(self):
        required = {p.name for p in PARAMS if not p.has_default}
        for path in parameter_files():
            with self.subTest(file=path.name):
                data = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(data.get("$schema"), SCHEMA)
                self.assertEqual(data.get("contentVersion"), "1.0.0.0")
                values = data["parameters"]
                unknown = set(values) - set(BY_NAME)
                self.assertFalse(unknown, f"not main.bicep parameters: {sorted(unknown)}")
                self.assertLessEqual(required, set(values), "missing required parameters")
                self.assertNotIn("deploymentToken", values, "deploymentToken is internal")
                for name, entry in values.items():
                    self._check_entry(BY_NAME[name], entry)

    def _check_entry(self, param: ref.Param, entry: dict):
        if param.secure:
            self.assertIn("reference", entry, f"{param.name}: pass secure values from Key Vault")
            kv = entry["reference"]
            self.assertIn("/providers/Microsoft.KeyVault/vaults/", kv["keyVault"]["id"])
            self.assertTrue(kv["secretName"])
            return
        self.assertEqual(set(entry), {"value"}, param.name)
        value = entry["value"]
        expected = {"string": str, "bool": bool, "int": int, "array": list, "object": dict}[param.type]
        self.assertIsInstance(value, expected, param.name)
        if expected is int:
            self.assertNotIsInstance(value, bool, param.name)
        if isinstance(value, str) and PLACEHOLDER.search(value):
            self.assertRegex(value, rf"^{PLACEHOLDER.pattern}$", f"{param.name}: one placeholder per value")
            return
        if param.allowed is not None:
            self.assertIn(value, param.allowed, param.name)
        if param.max_length is not None:
            self.assertLessEqual(len(value), param.max_length, param.name)
        if param.name == "oneGridModules":
            allowed = {"exec", "weather", "twin", "infra", "sap", "esu", "onerig", "copilot"}
            self.assertLessEqual(set(value), allowed)

    def test_component_dependencies_hold(self):
        for path in parameter_files():
            with self.subTest(file=path.name):
                values = json.loads(path.read_text(encoding="utf-8"))["parameters"]
                on = lambda name: bool(effective(values, name))  # noqa: E731
                if on("deployOneGridApp"):
                    self.assertTrue(on("deployFabricPlane"), "the web app needs the Fabric plane")
                if on("deployFabricPlane"):
                    self.assertTrue(on("deploySampleStorage"), "the Fabric plane needs sample storage")
                    if not on("createFabricCapacity"):
                        self.assertTrue(effective(values, "fabricCapacityId"),
                                        "an existing-capacity deployment needs fabricCapacityId")
                if on("deployAuroraSchedule"):
                    self.assertTrue(on("deployAuroraModel") and on("deploySampleStorage"),
                                    "the forecast job needs the Aurora model and sample storage")
                if effective(values, "refreshServicePrincipalClientId"):
                    self.assertTrue(effective(values, "refreshServicePrincipalObjectId"))
                    self.assertIn("refreshServicePrincipalSecret", values)
                if "copilot" in effective(values, "oneGridModules") and on("deployOneGridApp"):
                    self.assertTrue(on("deployAiAgent"), "Copilot chat needs the AI agent component")

    def test_baseline_required_matches_portal_defaults(self):
        form = ref.PortalForm()
        values = json.loads((PARAMETER_DIR / "baseline-required.parameters.json")
                            .read_text(encoding="utf-8"))["parameters"]
        # The file creates a capacity instead of requiring an existing one, which the form's
        # defaults would; every other value the form sends by default must match.
        capacity_choice = {"createFabricCapacity", "fabricCapacityId"}
        for name in form.outputs:
            known, form_value = form.form_default(name)
            if not known or name in capacity_choice:
                continue
            self.assertEqual(effective(values, name), form_value, name)
        self.assertIs(effective(values, "createFabricCapacity"), True)

    def test_bicepparam_twins_match_json(self):
        for path in parameter_files():
            stem = path.name[: -len(".parameters.json")]
            with self.subTest(file=stem):
                text = (PARAMETER_DIR / f"{stem}.bicepparam").read_text(encoding="utf-8")
                self.assertRegex(text, r"(?m)^using '\.\./main\.bicep'\s*$")
                twin = parse_bicepparam(text)
                values = json.loads(path.read_text(encoding="utf-8"))["parameters"]
                self.assertEqual(list(twin), list(values), "same parameters in the same order")
                for name, entry in values.items():
                    if "reference" in entry:
                        kv = entry["reference"]
                        parts = kv["keyVault"]["id"].split("/")
                        expected = ("getSecret", parts[2], parts[4], parts[8], kv["secretName"])
                        self.assertEqual(twin[name], expected, name)
                    else:
                        self.assertEqual(twin[name], entry["value"], name)


def parse_bicepparam(text: str) -> dict:
    """Minimal .bicepparam reader for the shipped files: literals and az.getSecret()."""
    out, lines, i = {}, text.splitlines(), 0
    while i < len(lines):
        line = ref._strip_comment(lines[i]).strip()
        i += 1
        m = re.match(r"param\s+(\w+)\s*=\s*(.*)$", line)
        if not m:
            continue
        name, expr = m.groups()
        while ref._depth(expr) > 0:
            expr += "\n" + ref._strip_comment(lines[i]).strip()
            i += 1
        secret = re.fullmatch(r"az\.getSecret\((.*)\)", expr.strip(), re.S)
        if secret:
            args = re.findall(r"'([^']*)'", secret.group(1))
            out[name] = ("getSecret", *args)
            continue
        ok, value = ref._literal(expr)
        if not ok:
            raise ValueError(f"unsupported value for {name}: {expr}")
        out[name] = value
    return out


# --------------------------------------------------------------------------------------
# Links
# --------------------------------------------------------------------------------------

LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)|(?:src|srcset|href)=\"([^\"]+)\"|^\[[^\]]+\]:\s*(\S+)", re.M)


def _slugs(markdown: str) -> set[str]:
    slugs, counts = set(), {}
    in_fence = False
    for line in markdown.splitlines():
        if line.startswith("```"):
            in_fence = not in_fence
            continue
        m = re.match(r"#{1,6}\s+(.*)", line)
        if in_fence or not m:
            continue
        title = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", m.group(1))
        title = re.sub(r"[`*]", "", title).strip()
        slug = re.sub(r"[^\w\- ]", "", title.lower()).replace(" ", "-")
        n = counts.get(slug, 0)
        counts[slug] = n + 1
        slugs.add(slug if n == 0 else f"{slug}-{n}")
    slugs.update(re.findall(r'<a id="([^"]+)"', markdown))
    return slugs


def deploy_pages() -> list[Path]:
    return [*sorted(HERE.rglob("*.md")), PARAMETER_DIR / "README.md"]


class LinkTests(unittest.TestCase):
    def test_pages_have_front_matter_and_design_guide_line(self):
        for page in sorted(HERE.rglob("*.md")):
            with self.subTest(page=page.relative_to(ROOT).as_posix()):
                text = page.read_text(encoding="utf-8")
                self.assertTrue(text.startswith("---\ntitle: "), "front matter")
                for key in ("description:", "ms.date:", "ms.topic:"):
                    self.assertIn("\n" + key, text.split("\n---", 2)[0] + "\n")
                design = Path("../" * (len(page.relative_to(HERE).parts) - 1)) / "../architecture/design-guide.md"
                self.assertIn(f"Part of the [OneGrid landing zone design guide]({design.as_posix()}).", text)

    def test_relative_links_and_anchors_resolve(self):
        for page in deploy_pages():
            text = page.read_text(encoding="utf-8")
            body = re.sub(r"```.*?```", "", text, flags=re.S)
            body = re.sub(r"`[^`\n]*`", "", body)
            for match in LINK.finditer(body):
                target = match.group(1) or match.group(2) or match.group(3)
                if re.match(r"[a-z]+:", target) or target.startswith("mailto:"):
                    continue
                with self.subTest(page=page.relative_to(ROOT).as_posix(), link=target):
                    path, _, anchor = target.partition("#")
                    dest = (page.parent / path).resolve() if path else page
                    if dest in PENDING_TARGETS and not dest.exists():
                        continue
                    self.assertTrue(dest.exists(), f"missing {target}")
                    if anchor and dest.suffix == ".md":
                        self.assertIn(anchor, _slugs(dest.read_text(encoding="utf-8")),
                                      f"missing anchor #{anchor}")

    def test_terminology(self):
        banned = re.compile(r"Azure OpenAI(?! User)(?! Service)")
        for page in deploy_pages():
            if page.parent.name == "reference":
                continue  # reproduces template descriptions verbatim
            for n, line in enumerate(page.read_text(encoding="utf-8").splitlines(), 1):
                # Code, and bold or italic UI labels, are literal text from the form or code.
                stripped = re.sub(r"`[^`]*`|\*\*[^*]+\*\*|\*[^*]+\*", "", line)
                with self.subTest(page=page.name, line=n):
                    self.assertIsNone(banned.search(stripped), line)


if __name__ == "__main__":
    unittest.main()
