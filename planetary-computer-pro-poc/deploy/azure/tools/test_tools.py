"""Unit tests for the template validation tools (stdlib unittest).

Run: python -m unittest discover -s planetary-computer-pro-poc/deploy/azure/tools -p "test_*.py"
"""
from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import check_parameter_files  # noqa: E402
import check_ui_definition as ui  # noqa: E402
import compare_arm  # noqa: E402


def template(**params):
    return {"parameters": params}


def form(outputs, steps=None, basics=None, regions=None):
    return {
        "parameters": {
            "config": {"basics": {"location": {"allowedValues": regions}}} if regions else {},
            "basics": basics or [],
            "steps": steps or [],
            "outputs": outputs,
        }
    }


def codes(report, level=None):
    return sorted(f.code for f in report.findings if level is None or f.level == level)


class ExpressionParserTests(unittest.TestCase):
    def test_nested_calls_and_property_paths(self):
        ast = ui.parse_expression("[if(and(contains(steps('a').selected, 'x'), not(steps('b').s.flag)), steps('b').s.name, 'it''s')]")
        self.assertEqual(ast.name, "if")
        cond, then, other = ast.args
        self.assertEqual(cond.name, "and")
        self.assertEqual(then.path, ["s", "name"])
        self.assertEqual(other.value, "it's")

    def test_plain_values_are_literals(self):
        self.assertEqual(ui.parse_expression("westeurope").value, "westeurope")
        self.assertEqual(ui.parse_expression("[[escaped]").value, "[[escaped]")

    def test_parse_and_type_inference(self):
        f = ui.Form(form({}))
        self.assertEqual(ui.infer_type(ui.parse_expression("[parse('[]')]"), f), "array")
        self.assertEqual(ui.infer_type(ui.parse_expression("[location()]"), f), "string")
        self.assertEqual(ui.infer_type(ui.parse_expression("[not(true)]"), f), "bool")

    def test_malformed_expression_raises(self):
        with self.assertRaises(ui.ExpressionError):
            ui.parse_expression("[steps('a'.x]")


class UiDefinitionCheckTests(unittest.TestCase):
    STEPS = [{
        "name": "s",
        "elements": [
            {"name": "flag", "type": "Microsoft.Common.CheckBox", "defaultValue": True},
            {"name": "sku", "type": "Microsoft.Common.DropDown", "defaultValue": "Big (B2)",
             "constraints": {"allowedValues": [{"label": "Small (B1)", "value": "B1"}, {"label": "Big (B2)", "value": "B2"}]}},
            {"name": "sec", "type": "Microsoft.Common.Section", "elements": [
                {"name": "name", "type": "Microsoft.Common.TextBox", "defaultValue": "x"}]},
        ],
    }]

    def test_clean_form_has_no_errors(self):
        t = template(
            location={"type": "string", "allowedValues": ["eastus"]},
            flag={"type": "bool", "defaultValue": True},
            sku={"type": "string", "defaultValue": "B2", "allowedValues": ["B1", "B2"]},
            name={"type": "string", "defaultValue": "x"},
        )
        f = form({"location": "[location()]", "flag": "[steps('s').flag]", "sku": "[steps('s').sku]",
                  "name": "[if(steps('s').flag, steps('s').sec.name, 'x')]"}, self.STEPS, regions=["eastus"])
        report = ui.check(f, t)
        self.assertEqual(codes(report, "ERROR"), [])
        self.assertEqual(codes(report, "WARN"), [])

    def test_unknown_output_and_unknown_element(self):
        t = template(flag={"type": "bool", "defaultValue": False})
        f = form({"flag": "[steps('s').flg]", "nope": "[steps('s').flag]"}, self.STEPS)
        report = ui.check(f, t)
        self.assertIn("unknown-parameter", codes(report, "ERROR"))
        self.assertIn("unknown-element", codes(report, "ERROR"))

    def test_required_parameter_type_and_allowed_values(self):
        t = template(
            needed={"type": "string"},
            flag={"type": "string", "defaultValue": "a"},
            sku={"type": "string", "defaultValue": "B1", "allowedValues": ["B1"]},
        )
        f = form({"flag": "[steps('s').flag]", "sku": "[steps('s').sku]"}, self.STEPS)
        report = ui.check(f, t)
        errors = codes(report, "ERROR")
        self.assertIn("required-parameter", errors)
        self.assertIn("type", errors)
        self.assertIn("allowed-values", errors)

    def test_fallback_default_unset_and_internal_parameters(self):
        t = template(
            name={"type": "string", "defaultValue": "y"},
            other={"type": "int", "defaultValue": 1},
            token={"type": "string", "defaultValue": "[utcNow()]", "metadata": {"description": "Internal: seed"}},
        )
        f = form({"name": "[if(steps('s').flag, steps('s').sec.name, 'x')]"}, self.STEPS)
        report = ui.check(f, t)
        warns = codes(report, "WARN")
        self.assertIn("fallback-default", warns)
        self.assertIn("unset-parameter", warns)
        self.assertIn("unset-parameter", codes(report, "NOTE"))
        self.assertIn("unused-element", warns)  # steps('s').sku is never read

    def test_region_lists(self):
        t = template(location={"type": "string", "allowedValues": ["eastus", "westus"]})
        report = ui.check(form({"location": "[location()]"}, regions=["eastus", "uksouth"]), t)
        self.assertIn("regions", codes(report, "ERROR"))
        self.assertIn("regions", codes(report, "WARN"))

    def test_repository_files_have_no_errors(self):
        deploy = HERE.parent
        t = json.loads((deploy / "azuredeploy.json").read_text(encoding="utf-8-sig"))
        f = json.loads((deploy / "createUiDefinition.json").read_text(encoding="utf-8-sig"))
        report = ui.check(f, t)
        self.assertEqual([x.message for x in report.findings if x.level == "ERROR"], [])


class CompareArmTests(unittest.TestCase):
    def test_generator_and_line_endings_are_ignored(self):
        a = {"metadata": {"_generator": {"version": "1", "templateHash": "1"}}, "variables": {"s": "a\r\nb"}}
        b = {"metadata": {"_generator": {"version": "2", "templateHash": "2"}}, "variables": {"s": "a\nb"}}
        self.assertEqual(compare_arm.canonical(a), compare_arm.canonical(b))

    def test_real_differences_are_reported(self):
        a = {"variables": {"x": 1}}
        b = {"variables": {"x": 2}}
        self.assertNotEqual(compare_arm.canonical(a), compare_arm.canonical(b))
        lines, total = compare_arm.diff_lines(a, b)
        self.assertGreater(total, 0)

    def test_cli_exit_codes(self):
        with tempfile.TemporaryDirectory() as tmp:
            left, right = Path(tmp, "a.json"), Path(tmp, "b.json")
            left.write_text(json.dumps({"metadata": {"_generator": {"version": "0.1"}}, "x": 1}), encoding="utf-8")
            right.write_text(json.dumps({"x": 1}), encoding="utf-8")
            self.assertEqual(compare_arm.main(["--committed", str(left), "--built", str(right)]), 0)
            right.write_text(json.dumps({"x": 2}), encoding="utf-8")
            self.assertEqual(compare_arm.main(["--committed", str(left), "--built", str(right)]), 1)


class ParameterFileTests(unittest.TestCase):
    TEMPLATE = template(
        sku={"type": "string", "defaultValue": "B1", "allowedValues": ["B1", "B2"]},
        count={"type": "int", "defaultValue": 1, "maxValue": 5},
        secret={"type": "securestring", "defaultValue": ""},
        needed={"type": "bool"},
    )

    def run_check(self, parameters):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp, "p.json")
            path.write_text(json.dumps({
                "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
                "parameters": parameters}), encoding="utf-8")
            return check_parameter_files.check_file(path, self.TEMPLATE)

    def test_valid_file(self):
        errors, warnings = self.run_check({"sku": {"value": "B2"}, "needed": {"value": True}})
        self.assertEqual((errors, warnings), ([], []))

    def test_invalid_values(self):
        errors, _ = self.run_check({
            "sku": {"value": "P1"}, "count": {"value": 9}, "secret": {"value": "hunter2"},
            "bogus": {"value": 1}, "needed": {"value": "yes"}})
        text = " ".join(errors)
        for fragment in ("sku", "count", "secret", "bogus", "needed"):
            self.assertIn(fragment, text)

    def test_missing_required_and_key_vault_reference(self):
        errors, _ = self.run_check({"secret": {"reference": {"keyVault": {"id": "/x"}, "secretName": "s"}}})
        self.assertEqual(errors, ["needed: required template parameter is missing"])


if __name__ == "__main__":
    unittest.main()
