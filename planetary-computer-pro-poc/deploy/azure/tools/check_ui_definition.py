#!/usr/bin/env python3
"""Check that createUiDefinition.json stays aligned with the ARM template it deploys.

The portal form (createUiDefinition.json), the Bicep source (main.bicep) and the compiled
template (azuredeploy.json) are kept in sync by hand. This check reads the compiled template,
because that is what the portal deploys, and reports:

  ERROR  an output that is not a template parameter
  ERROR  a required template parameter (no default, not nullable) that the form never sets
  ERROR  a steps()/basics() reference to an element that does not exist
  ERROR  an output whose inferred type does not match the parameter type
  ERROR  a region or DropDown value the form offers that the template does not allow
  WARN   a template parameter the form never sets (it always deploys with the default)
  WARN   an if(condition, element, 'literal') fallback that differs from the template default
  WARN   regions the template allows that the form does not offer
  WARN   an input element that no output reads (the user's choice is ignored)
  NOTE   an element default that differs from the template default (often deliberate)
  NOTE   allowed values the template accepts but the form does not offer
  NOTE   parameters whose description starts with "Internal" and are not in the form

Standard library only. Exit code 1 when any ERROR is reported (or any WARN with --strict).
Inside GitHub Actions the findings are also emitted as workflow annotations.

Usage:
  python check_ui_definition.py [--template PATH] [--ui PATH] [--strict] [--json OUT]
"""
from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass, field
import json
import os
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
DEPLOY_DIR = HERE.parent

BOOL_FUNCTIONS = {
    "and", "or", "not", "contains", "equals", "greater", "greaterOrEquals", "less",
    "lessOrEquals", "empty", "startsWith", "endsWith", "bool",
}
STRING_FUNCTIONS = {
    "concat", "string", "toLower", "toUpper", "replace", "substring", "trim", "guid",
    "location", "uriComponent", "uriComponentToString", "base64", "base64ToString",
    "decodeUriComponent", "encodeUriComponent", "format", "padLeft",
}
INT_FUNCTIONS = {"int", "length", "add", "sub", "mul", "div", "mod", "indexOf", "lastIndexOf"}
ARRAY_FUNCTIONS = {"split", "skip", "take", "filter", "map", "createArray"}
OBJECT_FUNCTIONS = {"resourceGroup", "subscription", "createObject"}

INPUT_TYPES = {
    "Microsoft.Common.TextBox": "string",
    "Microsoft.Common.PasswordBox": "string",
    "Microsoft.Common.CheckBox": "bool",
    "Microsoft.Common.OptionsGroup": "string",
    "Microsoft.Common.Slider": "int",
}
TEMPLATE_TYPES = {
    "string": "string", "securestring": "string", "int": "int", "bool": "bool",
    "array": "array", "object": "object", "secureobject": "object",
}

_MISSING = object()


# ----------------------------------------------------------------------------------------
# Findings
# ----------------------------------------------------------------------------------------
@dataclass
class Finding:
    level: str  # ERROR | WARN | NOTE
    code: str
    subject: str
    message: str
    file: str = ""
    line: int = 0


@dataclass
class Report:
    findings: list[Finding] = field(default_factory=list)

    def add(self, level, code, subject, message, file="", line=0):
        self.findings.append(Finding(level, code, subject, message, file, line))

    def count(self, level):
        return sum(1 for f in self.findings if f.level == level)


# ----------------------------------------------------------------------------------------
# A small parser for createUiDefinition / ARM-style expressions: [fn('a', fn2(x)).prop]
# ----------------------------------------------------------------------------------------
class ExpressionError(ValueError):
    pass


@dataclass
class Lit:
    value: object


@dataclass
class Call:
    name: str
    args: list
    path: list  # property accessors applied to the call result, e.g. ['aiAgentSection', 'x']


class _Parser:
    def __init__(self, text: str):
        self.s = text
        self.i = 0

    def ws(self):
        while self.i < len(self.s) and self.s[self.i].isspace():
            self.i += 1

    def peek(self):
        self.ws()
        return self.s[self.i] if self.i < len(self.s) else ""

    def take(self, ch):
        if self.peek() != ch:
            raise ExpressionError(f"expected {ch!r} at {self.i} in {self.s!r}")
        self.i += 1

    def parse(self):
        node = self.expr()
        self.ws()
        if self.i != len(self.s):
            raise ExpressionError(f"unexpected {self.s[self.i:]!r} in {self.s!r}")
        return node

    def expr(self):
        node = self.primary()
        while True:
            ch = self.peek()
            if ch == ".":
                self.i += 1
                name = self.ident()
                node = self._access(node, name)
            elif ch == "[":
                self.i += 1
                index = self.expr()
                self.take("]")
                node = self._access(node, str(index.value) if isinstance(index, Lit) else "*")
            else:
                return node

    @staticmethod
    def _access(node, name):
        if isinstance(node, Call):
            node.path.append(name)
            return node
        return Call("__property__", [node], [name])

    def ident(self):
        self.ws()
        m = re.compile(r"[A-Za-z_][A-Za-z0-9_]*").match(self.s, self.i)
        if not m:
            raise ExpressionError(f"expected a name at {self.i} in {self.s!r}")
        self.i = m.end()
        return m.group(0)

    def primary(self):
        ch = self.peek()
        if ch == "'":
            return Lit(self.string())
        if ch == "-" or ch.isdigit():
            m = re.compile(r"-?\d+(\.\d+)?").match(self.s, self.i)
            if not m:
                raise ExpressionError(f"bad number at {self.i} in {self.s!r}")
            self.i = m.end()
            text = m.group(0)
            return Lit(float(text) if "." in text else int(text))
        if ch == "(":
            self.i += 1
            node = self.expr()
            self.take(")")
            return node
        name = self.ident()
        if self.peek() == "(":
            self.i += 1
            args = []
            if self.peek() != ")":
                while True:
                    args.append(self.expr())
                    if self.peek() == ",":
                        self.i += 1
                        continue
                    break
            self.take(")")
            return Call(name, args, [])
        lowered = name.lower()
        if lowered in ("true", "false"):
            return Lit(lowered == "true")
        if lowered == "null":
            return Lit(None)
        raise ExpressionError(f"unknown identifier {name!r} in {self.s!r}")

    def string(self):
        self.take("'")
        out = []
        while self.i < len(self.s):
            ch = self.s[self.i]
            if ch == "'":
                if self.s[self.i + 1:self.i + 2] == "'":
                    out.append("'")
                    self.i += 2
                    continue
                self.i += 1
                return "".join(out)
            out.append(ch)
            self.i += 1
        raise ExpressionError(f"unterminated string in {self.s!r}")


def is_expression(value) -> bool:
    return isinstance(value, str) and value.startswith("[") and value.endswith("]") and not value.startswith("[[")


def parse_expression(value):
    """Return the AST for an expression string, or Lit(value) for a plain value."""
    if not is_expression(value):
        return Lit(value)
    return _Parser(value[1:-1]).parse()


def iter_calls(node):
    if isinstance(node, Call):
        yield node
        for arg in node.args:
            yield from iter_calls(arg)


def is_reference(node) -> bool:
    if not isinstance(node, Call) or not node.args or not isinstance(node.args[0], Lit):
        return False
    if node.name == "basics":
        return True
    return node.name == "steps" and bool(node.path)


# ----------------------------------------------------------------------------------------
# Form model
# ----------------------------------------------------------------------------------------
class Form:
    def __init__(self, ui: dict):
        params = ui.get("parameters", {})
        self.ui = ui
        self.basics = {e.get("name"): e for e in params.get("basics", []) if isinstance(e, dict)}
        self.steps = {
            s.get("name"): {e.get("name"): e for e in s.get("elements", []) if isinstance(e, dict)}
            for s in params.get("steps", []) if isinstance(s, dict)
        }
        self.outputs = params.get("outputs", {})
        self.location = (params.get("config", {}).get("basics", {}) or {}).get("location", {}) or {}

    def resolve(self, ref: Call):
        """Return (element, display path, error). element is None when unresolved."""
        key = ref.args[0].value
        if ref.name == "basics":
            element = self.basics.get(key)
            label = f"basics('{key}')"
            if element is None:
                return None, label, f"basics element '{key}' does not exist"
            path = list(ref.path)
        else:
            step = self.steps.get(key)
            label = f"steps('{key}')"
            if step is None:
                return None, label, f"step '{key}' does not exist"
            if not ref.path:
                return {"type": "__step__"}, label, None
            first, path = ref.path[0], list(ref.path[1:])
            label += f".{first}"
            element = step.get(first)
            if element is None:
                return None, label, f"element '{first}' does not exist in step '{key}'"
        while path and element.get("type") == "Microsoft.Common.Section":
            child_name = path.pop(0)
            label += f".{child_name}"
            children = {e.get("name"): e for e in element.get("elements", []) if isinstance(e, dict)}
            if child_name not in children:
                return None, label, f"element '{child_name}' does not exist in section '{element.get('name')}'"
            element = children[child_name]
        return element, label, None

    def input_elements(self):
        """Yield (label, element) for every element that collects input."""
        def walk(prefix, elements):
            for element in elements:
                if not isinstance(element, dict):
                    continue
                kind = element.get("type", "")
                label = f"{prefix}.{element.get('name')}"
                if kind == "Microsoft.Common.Section":
                    yield from walk(label, element.get("elements", []))
                elif kind in INPUT_TYPES or kind == "Microsoft.Common.DropDown" or (
                        kind.startswith("Microsoft.") and kind not in (
                            "Microsoft.Common.InfoBox", "Microsoft.Common.TextBlock")):
                    yield label, element
        params = self.ui.get("parameters", {})
        yield from walk("basics()", params.get("basics", []))
        for step in params.get("steps", []):
            yield from walk(f"steps('{step.get('name')}')", step.get("elements", []))


def element_type(element: dict):
    kind = element.get("type", "")
    if kind == "__step__":
        return "object"
    if kind == "Microsoft.Common.DropDown":
        return "array" if element.get("multiselect") else "string"
    return INPUT_TYPES.get(kind)


def dropdown_values(element: dict):
    allowed = (element.get("constraints") or {}).get("allowedValues") or []
    return [a.get("value") for a in allowed if isinstance(a, dict)]


def element_default(element: dict):
    kind = element.get("type", "")
    if kind == "Microsoft.Common.CheckBox":
        return bool(element.get("defaultValue", False))
    if kind == "Microsoft.Common.TextBox":
        return element.get("defaultValue", "")
    if kind == "Microsoft.Common.DropDown":
        default = element.get("defaultValue", _MISSING)
        allowed = (element.get("constraints") or {}).get("allowedValues") or []
        if element.get("multiselect"):
            if isinstance(default, list):
                return [d.get("value") if isinstance(d, dict) else d for d in default]
            return _MISSING
        for option in allowed:  # the DropDown defaultValue is the option label
            if isinstance(option, dict) and default in (option.get("label"), option.get("value")):
                return option.get("value")
        return _MISSING
    return _MISSING


def infer_type(node, form: Form):
    if isinstance(node, Lit):
        value = node.value
        if isinstance(value, bool):
            return "bool"
        if isinstance(value, int):
            return "int"
        if isinstance(value, str):
            return "string"
        if isinstance(value, list):
            return "array"
        if isinstance(value, dict):
            return "object"
        return None
    if not isinstance(node, Call):
        return None
    if is_reference(node):
        element, _, error = form.resolve(node)
        if error or element is None:
            return None
        if element.get("type") == "Microsoft.Common.Section":
            return "object"
        return element_type(element)
    if node.path:
        return None
    name = node.name
    if name in BOOL_FUNCTIONS:
        return "bool"
    if name in STRING_FUNCTIONS:
        return "string"
    if name in INT_FUNCTIONS:
        return "int"
    if name in ARRAY_FUNCTIONS:
        return "array"
    if name in OBJECT_FUNCTIONS:
        return "object"
    if name == "if" and len(node.args) == 3:
        a, b = infer_type(node.args[1], form), infer_type(node.args[2], form)
        if a and b and a != b:
            return "mixed"
        return a or b
    if name == "coalesce":
        for arg in node.args:
            t = infer_type(arg, form)
            if t:
                return t
        return None
    if name == "parse" and node.args and isinstance(node.args[0], Lit) and isinstance(node.args[0].value, str):
        try:
            return infer_type(Lit(json.loads(node.args[0].value)), form)
        except ValueError:
            return None
    return None


def value_source(node):
    """Return (reference, fallback literal) when an output passes one element's value through."""
    if is_reference(node):
        return node, _MISSING
    if isinstance(node, Call) and not node.path:
        if node.name == "if" and len(node.args) == 3:
            a, b = node.args[1], node.args[2]
            if is_reference(a):
                return a, (b.value if isinstance(b, Lit) else _MISSING)
            if is_reference(b):
                return b, (a.value if isinstance(a, Lit) else _MISSING)
        if node.name == "and" and node.args and is_reference(node.args[-1]):
            return node.args[-1], _MISSING
    return None, _MISSING


def template_default(spec: dict):
    if "defaultValue" not in spec:
        return _MISSING
    value = spec["defaultValue"]
    if is_expression(value):
        return _MISSING  # computed at deployment time, e.g. [utcNow()]
    return value


def short(value, limit=80):
    text = json.dumps(value) if not isinstance(value, str) else repr(value)
    return text if len(text) <= limit else text[:limit - 3] + "..."


# ----------------------------------------------------------------------------------------
# The check
# ----------------------------------------------------------------------------------------
def collect_expressions(node, where=""):
    """Yield (location, expression string) for every expression in the UI definition."""
    if isinstance(node, dict):
        for key, value in node.items():
            yield from collect_expressions(value, f"{where}.{key}" if where else key)
    elif isinstance(node, list):
        for i, value in enumerate(node):
            label = value.get("name") if isinstance(value, dict) and value.get("name") else str(i)
            yield from collect_expressions(value, f"{where}[{label}]")
    elif is_expression(node):
        yield where, node


def check(ui: dict, template: dict, ui_file: str = "", ui_text: str = "") -> Report:
    report = Report()
    form = Form(ui)
    tparams = template.get("parameters", {})

    def line_of(key):
        if not ui_text:
            return 0
        start = ui_text.find('"outputs"')
        pos = ui_text.find(f'"{key}"', max(start, 0))
        return ui_text.count("\n", 0, pos) + 1 if pos >= 0 else 0

    # Every reference anywhere in the form must resolve (outputs, visibility, constraints).
    for where, text in collect_expressions(ui.get("parameters", {}), "parameters"):
        try:
            ast = parse_expression(text)
        except ExpressionError as exc:
            report.add("WARN", "parse", where, f"could not parse expression ({exc}); it was not checked", ui_file)
            continue
        for call in iter_calls(ast):
            if is_reference(call):
                _, label, error = form.resolve(call)
                if error:
                    report.add("ERROR", "unknown-element", where, f"{label}: {error}", ui_file)

    referenced_by_outputs = set()
    for name, expression in form.outputs.items():
        subject = f"outputs.{name}"
        line = line_of(name)
        spec = tparams.get(name)
        if spec is None:
            report.add("ERROR", "unknown-parameter", subject,
                       f"'{name}' is not a parameter of the template; the deployment would fail with "
                       "an unexpected-parameter error. Rename the output or add the parameter.", ui_file, line)
            continue
        try:
            ast = parse_expression(expression)
        except ExpressionError:
            continue  # already reported as a parse warning
        for call in iter_calls(ast):
            if is_reference(call):
                element, label, error = form.resolve(call)
                if not error:
                    referenced_by_outputs.add(label)
        ptype = TEMPLATE_TYPES.get(str(spec.get("type", "")).lower())
        otype = infer_type(ast, form)
        if otype == "mixed":
            report.add("WARN", "type", subject, "the if() branches return different types", ui_file, line)
        elif otype and ptype and otype != ptype:
            report.add("ERROR", "type", subject,
                       f"the form sends a {otype} but parameter '{name}' is {spec.get('type')}", ui_file, line)

        allowed = spec.get("allowedValues")
        default = template_default(spec)
        ref, fallback = value_source(ast)
        if fallback is not _MISSING:
            if default is not _MISSING and fallback != default:
                report.add("WARN", "fallback-default", subject,
                           f"when the element is hidden the form sends {short(fallback)}, but the template "
                           f"default is {short(default)}; align them or document why", ui_file, line)
            if allowed and fallback not in allowed:
                report.add("ERROR", "allowed-values", subject,
                           f"fallback {short(fallback)} is not in the template's allowedValues", ui_file, line)
        if ref is not None:
            element, label, error = form.resolve(ref)
            if element and not error:
                if element.get("type") == "Microsoft.Common.DropDown" and not element.get("multiselect") and allowed:
                    values = dropdown_values(element)
                    extra = [v for v in values if v not in allowed]
                    if extra:
                        report.add("ERROR", "allowed-values", subject,
                                   f"{label} offers {extra} which the template does not allow", ui_file, line)
                    missing = [v for v in allowed if v not in values]
                    if missing:
                        report.add("NOTE", "allowed-values", subject,
                                   f"the template also allows {missing}, which {label} does not offer", ui_file, line)
                edefault = element_default(element)
                if edefault is not _MISSING and default is not _MISSING and edefault != default:
                    report.add("NOTE", "element-default", subject,
                               f"{label} defaults to {short(edefault)}; the template default is {short(default)}",
                               ui_file, line)

    # Region list: config.basics.location.allowedValues vs the template's location parameter.
    location_spec = tparams.get("location", {})
    form_regions = form.location.get("allowedValues")
    template_regions = location_spec.get("allowedValues")
    if form_regions and template_regions:
        extra = [r for r in form_regions if r not in template_regions]
        missing = [r for r in template_regions if r not in form_regions]
        if extra:
            report.add("ERROR", "regions", "config.basics.location",
                       f"the form offers {extra}, which the template's location parameter does not allow", ui_file)
        if missing:
            report.add("WARN", "regions", "config.basics.location",
                       f"the template allows {missing}, which the form does not offer", ui_file)
    if "location" in tparams and "location" not in form.outputs:
        report.add("WARN", "regions", "outputs.location",
                   "the form does not pass location; the template default region is always used", ui_file)

    # Parameters the form never sets.
    for name, spec in tparams.items():
        if name in form.outputs:
            continue
        description = (spec.get("metadata") or {}).get("description", "")
        required = "defaultValue" not in spec and not spec.get("nullable", False)
        if required:
            report.add("ERROR", "required-parameter", f"parameters.{name}",
                       "required template parameter (no default) is not set by the form; the portal "
                       "deployment would fail", ui_file)
        elif description.lower().startswith("internal"):
            report.add("NOTE", "unset-parameter", f"parameters.{name}",
                       "internal parameter, not exposed in the form (by design)", ui_file)
        else:
            report.add("WARN", "unset-parameter", f"parameters.{name}",
                       f"not set by the form, so portal deployments always use the default "
                       f"{short(spec.get('defaultValue'))}", ui_file)

    # Input elements that no output reads.
    for label, element in form.input_elements():
        if label.startswith("basics()."):
            label = f"basics('{element.get('name')}')"
        if label not in referenced_by_outputs and not any(r.startswith(label + ".") for r in referenced_by_outputs):
            report.add("WARN", "unused-element", label,
                       "no output reads this element, so the user's choice is ignored", ui_file)
    return report


# ----------------------------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------------------------
def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def emit(report: Report, strict: bool):
    github = os.environ.get("GITHUB_ACTIONS") == "true"
    order = {"ERROR": 0, "WARN": 1, "NOTE": 2}
    for f in sorted(report.findings, key=lambda x: (order[x.level], x.subject)):
        print(f"{f.level:<5}  {f.subject}: {f.message}")
        if github and f.level in ("ERROR", "WARN"):
            kind = "error" if f.level == "ERROR" or strict else "warning"
            props = [f"file={f.file}"] if f.file else []
            if f.file and f.line:
                props.append(f"line={f.line}")
            props.append(f"title=createUiDefinition {f.code}")
            message = f"{f.subject}: {f.message}".replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
            print(f"::{kind} {','.join(props)}::{message}")
    print(f"\n{report.count('ERROR')} error(s), {report.count('WARN')} warning(s), {report.count('NOTE')} note(s).")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--template", type=Path, default=DEPLOY_DIR / "azuredeploy.json",
                        help="Compiled ARM template (default: ../azuredeploy.json).")
    parser.add_argument("--ui", type=Path, default=DEPLOY_DIR / "createUiDefinition.json",
                        help="Portal form definition (default: ../createUiDefinition.json).")
    parser.add_argument("--strict", action="store_true", help="Treat warnings as errors.")
    parser.add_argument("--json", type=Path, help="Also write the findings to this JSON file.")
    args = parser.parse_args(argv)

    try:
        template = load_json(args.template)
        ui_text = args.ui.read_text(encoding="utf-8-sig")
        ui = json.loads(ui_text)
    except (OSError, ValueError) as exc:
        print(f"ERROR  could not read input: {exc}")
        return 1
    try:
        display = str(args.ui.resolve().relative_to(Path.cwd().resolve())).replace("\\", "/")
    except ValueError:
        display = str(args.ui).replace("\\", "/")
    report = check(ui, template, display, ui_text)
    print(f"Checked {args.ui.name} ({len(Form(ui).outputs)} outputs) against "
          f"{args.template.name} ({len(template.get('parameters', {}))} parameters).\n")
    emit(report, args.strict)
    if args.json:
        args.json.write_text(json.dumps([asdict(f) for f in report.findings], indent=2), encoding="utf-8")
    failed = report.count("ERROR") or (args.strict and report.count("WARN"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
