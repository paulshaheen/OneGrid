"""Generate the OneGrid deployment parameter reference from the template and portal form.

Reads every ``param`` in ``main.bicep`` (type, default, ``@allowed``, ``@description``,
``@secure``, ``@minLength``/``@maxLength``, ``@minValue``/``@maxValue``) and every output of
``createUiDefinition.json``, works out which portal step and control sets each parameter and
what the form sends by default, and writes ``docs/deploy/reference/parameters.md``.

Usage:
    python docs/deploy/build_reference.py           # write the reference
    python docs/deploy/build_reference.py --check   # exit 1 if the committed file is stale

Standard library only.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
AZURE = ROOT / "planetary-computer-pro-poc" / "deploy" / "azure"
BICEP = AZURE / "main.bicep"
UI_DEFINITION = AZURE / "createUiDefinition.json"
OUTPUT = HERE / "reference" / "parameters.md"

# Bump when the page's hand-written framing changes. Kept constant so --check is stable.
MS_DATE = "11/24/2026"

# Functional groups, in reading order. Every main.bicep parameter must appear exactly once;
# anything missing lands in UNGROUPED and test_reference.py fails until it's classified.
GROUPS: list[tuple[str, str, list[str]]] = [
    (
        "Region and components",
        "Choose the region and the components to deploy. The web app needs the Fabric plane, "
        "the Fabric plane needs sample storage, and the forecast job needs the Aurora model "
        "and sample storage; the template skips a component whose dependency is off.",
        ["location", "deployGeoCatalog", "deploySampleStorage", "deployAiAgent",
         "deployAuroraModel", "deployAuroraSchedule", "deployFabricPlane",
         "deployOneGridApp", "deployOneGridData"],
    ),
    (
        "Storage policy exemption",
        "Use only when Azure Policy disables shared-key or public network access on new "
        "storage accounts and your organization approves the exemption.",
        ["exemptStorageFromPolicy", "storagePolicyExemptionTagName",
         "storagePolicyExemptionTagValue"],
    ),
    (
        "GeoCatalog",
        "Planetary Computer Pro GeoCatalog settings. Used only when `deployGeoCatalog` is "
        "`true`.",
        ["geoCatalogName", "geoCatalogTier"],
    ),
    (
        "Microsoft Foundry model",
        "The Microsoft Foundry account and model deployment that the AI agent component "
        "creates. Only the deployment name is on the portal form.",
        ["openAiDeploymentName", "openAiModelName", "openAiModelVersion", "openAiSkuName",
         "openAiCapacity"],
    ),
    (
        "Aurora weather model",
        "The Azure Machine Learning workspace, managed online endpoint, and optional GPU "
        "deployment for Aurora. Used only when `deployAuroraModel` is `true`.",
        ["auroraInstanceType", "createAuroraModelDeployment", "auroraModelAssetId"],
    ),
    (
        "Forecast job",
        "The scheduled Azure Container Apps job that runs the Aurora pipeline. Used only when "
        "`deployAuroraSchedule`, `deployAuroraModel`, and `deploySampleStorage` are all "
        "`true`.",
        ["auroraJobImage", "auroraJobImageTag", "auroraJobCron"],
    ),
    (
        "Microsoft Fabric",
        "The Fabric capacity, workspace, storage connection, and unified asset model that "
        "the Fabric-plane deployment script provisions. Used only when the Fabric plane is "
        "deployed.",
        ["createFabricCapacity", "fabricCapacitySku", "fabricCapacityAdmin",
         "fabricCapacityId", "fabricWorkspaceName", "createFabricConnection",
         "fabricConnectionId", "deployUnifiedModel"],
    ),
    (
        "Web app",
        "The App Service plan, the enabled app modules, and the application package. Used "
        "only when the web app is deployed.",
        ["chatAgentAppServiceSku", "oneGridModules", "oneGridAppPackageUrl"],
    ),
    (
        "Identity and sign-in",
        "Microsoft Entra sign-in for the web app and the identity that binds and refreshes "
        "the Import semantic model.",
        ["enableEntraSignIn", "entraSignInClientId", "grantProvisionerGraphPermission",
         "refreshServicePrincipalClientId", "refreshServicePrincipalObjectId",
         "refreshServicePrincipalSecret"],
    ),
    (
        "Source and internal",
        "Where the deployment scripts get the provisioner, and the internal per-deployment "
        "seed. Pin the source for production environments.",
        ["oneGridRepoUrl", "oneGridRef", "deploymentToken"],
    ),
]
UNGROUPED = "Ungrouped"

# Curated notes rendered after the template description, where the description alone can
# mislead. Each one is traceable to code; see docs/deploy/known-issues.md.
NOTES: dict[str, str] = {
    "location": "The allowed list applies even when `deployGeoCatalog` is `false`.",
    "auroraJobImage": "When this is blank, the deployment builds the image into the "
                      "provisioned registry for you; run `az acr build` only to rebuild it.",
    "deployOneGridData": "The portal form preselects this component although the template "
                         "default is `false`.",
    "deployAuroraSchedule": "The template builds the pipeline image into its own registry "
                            "(`pcpro-aurora-image-build`), so no prebuilt image is needed "
                            "unless you set `auroraJobImage`.",
    "createFabricConnection": "The portal form checks this box by default; the template "
                              "default is `false`.",
    "enableEntraSignIn": "The portal form sends `true` whenever the web app is selected. "
                         "Set `false` from the command line to skip sign-in wiring.",
    "entraSignInClientId": "The provisioner doesn't add the redirect URI to a pre-created "
                           "registration; add `https://<app-host>/auth/callback` yourself.",
    "refreshServicePrincipalSecret": "Pass it from Azure Key Vault (a parameter-file "
                                     "reference or `az.getSecret()`), never as plain text.",
    "oneGridAppPackageUrl": "The default points at the mutable `app-latest` release. Pin a "
                            "versioned package for production.",
    "oneGridRef": "The scripts clone with `git clone --depth 1 --branch`, which accepts a "
                  "branch or tag but not a commit SHA. Pin a tag for production.",
    "deploymentToken": "Don't set it. Every deployment gets a new Aurora Key Vault name and "
                       "re-runs the deployment scripts because of it.",
}

STEP_LABELS = {"basics": "Basics"}


# --------------------------------------------------------------------------------------
# Bicep parsing
# --------------------------------------------------------------------------------------

@dataclass
class Param:
    name: str
    type: str
    default: Any = None
    has_default: bool = False
    default_expr: str | None = None  # non-literal default such as utcNow()
    description: str = ""
    allowed: list[Any] | None = None
    secure: bool = False
    min_length: int | None = None
    max_length: int | None = None
    min_value: int | None = None
    max_value: int | None = None


_ESCAPES = {"n": "\n", "r": "\r", "t": "\t", "\\": "\\", "'": "'", "$": "$"}


def _read_bicep_string(text: str, i: int) -> tuple[str, int]:
    """Read a single-quoted Bicep string starting at text[i] == "'"; return (value, next)."""
    assert text[i] == "'"
    out, i = [], i + 1
    while i < len(text):
        ch = text[i]
        if ch == "\\" and i + 1 < len(text):
            nxt = text[i + 1]
            if nxt == "u" and text[i + 2:i + 3] == "{":
                end = text.index("}", i + 3)
                out.append(chr(int(text[i + 3:end], 16)))
                i = end + 1
                continue
            out.append(_ESCAPES.get(nxt, nxt))
            i += 2
            continue
        if ch == "'":
            return "".join(out), i + 1
        out.append(ch)
        i += 1
    raise ValueError("unterminated Bicep string")


def _depth(text: str) -> int:
    """Bracket depth change of a Bicep fragment, ignoring brackets inside strings."""
    depth, i = 0, 0
    while i < len(text):
        ch = text[i]
        if ch == "'":
            try:
                _, i = _read_bicep_string(text, i)
            except ValueError:
                break
            continue
        if text.startswith("//", i):
            break
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        i += 1
    return depth


def _strip_comment(line: str) -> str:
    i = 0
    while i < len(line):
        if line[i] == "'":
            try:
                _, i = _read_bicep_string(line, i)
            except ValueError:  # string continues past this line; keep the line as-is
                return line.rstrip()
            continue
        if line.startswith("//", i):
            return line[:i].rstrip()
        i += 1
    return line.rstrip()


def _literal(text: str) -> tuple[bool, Any]:
    """Parse a Bicep literal (string, bool, int, or array of literals)."""
    text = text.strip()
    if not text:
        return False, None
    if text.startswith("'"):
        value, end = _read_bicep_string(text, 0)
        return (end == len(text)), value
    if text in ("true", "false"):
        return True, text == "true"
    if re.fullmatch(r"-?\d+", text):
        return True, int(text)
    if text.startswith("[") and text.endswith("]"):
        items, i, inner = [], 0, text[1:-1]
        while i < len(inner):
            ch = inner[i]
            if ch in " \t\r\n,":
                i += 1
            elif ch == "'":
                value, i = _read_bicep_string(inner, i)
                items.append(value)
            else:
                m = re.match(r"-?\d+|true|false", inner[i:])
                if not m:
                    return False, None
                ok, value = _literal(m.group(0))
                items.append(value)
                i += len(m.group(0))
        return True, items
    return False, None


def _apply_decorator(param: Param, decorator: str) -> None:
    m = re.match(r"@(\w+)\s*\((.*)\)\s*$", decorator, re.S)
    if not m:
        return
    name, body = m.group(1), m.group(2).strip()
    if name == "description":
        param.description = _read_bicep_string(body, 0)[0]
    elif name == "allowed":
        ok, values = _literal(body)
        if ok:
            param.allowed = values
    elif name == "secure":
        param.secure = True
    elif name in ("minLength", "maxLength", "minValue", "maxValue"):
        value = int(body)
        attr = {"minLength": "min_length", "maxLength": "max_length",
                "minValue": "min_value", "maxValue": "max_value"}[name]
        setattr(param, attr, value)


def parse_bicep(path: Path = BICEP) -> list[Param]:
    """Return main.bicep parameters in declaration order."""
    lines = path.read_text(encoding="utf-8").splitlines()
    params: list[Param] = []
    decorators: list[str] = []
    i = 0
    while i < len(lines):
        line = _strip_comment(lines[i]).strip()
        if not line:
            i += 1
            continue
        if line.startswith("@"):
            chunk = line
            while _depth(chunk) > 0:
                i += 1
                chunk += "\n" + _strip_comment(lines[i]).strip()
            decorators.append(chunk)
            i += 1
            continue
        m = re.match(r"param\s+(\w+)\s+(\w+)\s*(?:=\s*(.*))?$", line)
        if m:
            name, ptype, default = m.group(1), m.group(2), m.group(3)
            if default is not None:
                while _depth(default) > 0:
                    i += 1
                    default += "\n" + _strip_comment(lines[i]).strip()
            param = Param(name=name, type=ptype)
            for decorator in decorators:
                _apply_decorator(param, decorator)
            if default is not None:
                param.has_default = True
                ok, value = _literal(default)
                if ok:
                    param.default = value
                else:
                    param.default_expr = " ".join(default.split())
            params.append(param)
        decorators = []
        i += 1
    return params


# --------------------------------------------------------------------------------------
# createUiDefinition expressions
# --------------------------------------------------------------------------------------

@dataclass
class Lit:
    value: Any


@dataclass
class Call:
    name: str
    args: list[Any] = field(default_factory=list)
    props: list[str] = field(default_factory=list)


_TOKEN = re.compile(r"\s*(?:(?P<str>'(?:[^']|'')*')|(?P<num>-?\d+)|(?P<id>[A-Za-z_]\w*)|(?P<op>[(),.]))")


def _tokens(expr: str) -> list[tuple[str, str]]:
    out, i = [], 0
    while i < len(expr):
        if expr[i].isspace():
            i += 1
            continue
        m = _TOKEN.match(expr, i)
        if not m:
            raise ValueError(f"can't tokenize {expr!r} at {i}")
        kind = m.lastgroup
        out.append((kind, m.group(kind)))
        i = m.end()
    return out


def parse_expression(text: str) -> Any:
    """Parse an ARM/createUiDefinition expression such as "[if(a, b, 'c')]"."""
    text = text.strip()
    if not (text.startswith("[") and text.endswith("]")):
        return Lit(text)
    tokens, pos = _tokens(text[1:-1]), 0

    def peek(kind=None, value=None):
        if pos >= len(tokens):
            return False
        k, v = tokens[pos]
        return (kind is None or k == kind) and (value is None or v == value)

    def take():
        nonlocal pos
        pos += 1
        return tokens[pos - 1]

    def node():
        kind, value = take()
        if kind == "str":
            return Lit(value[1:-1].replace("''", "'"))
        if kind == "num":
            return Lit(int(value))
        if kind != "id":
            raise ValueError(f"unexpected {value!r} in {text!r}")
        call = Call(value)
        if peek("op", "("):
            take()
            while not peek("op", ")"):
                call.args.append(node())
                if peek("op", ","):
                    take()
            take()
        while peek("op", "."):
            take()
            call.props.append(take()[1])
        return call

    result = node()
    if pos != len(tokens):
        raise ValueError(f"trailing tokens in {text!r}")
    return result


def _flatten_and(node: Any) -> list[Any]:
    if isinstance(node, Call) and node.name == "and" and not node.props:
        out = []
        for arg in node.args:
            out.extend(_flatten_and(arg))
        return out
    return [node]


def _is_ref(node: Any) -> bool:
    return isinstance(node, Call) and node.name in ("steps", "basics", "location")


def _has_ref(node: Any) -> bool:
    if _is_ref(node):
        return True
    return isinstance(node, Call) and any(_has_ref(arg) for arg in node.args)


# --------------------------------------------------------------------------------------
# Portal form model
# --------------------------------------------------------------------------------------

@dataclass
class Control:
    step: str          # step name, or "basics"
    path: list[str]    # element names from the step down to the control
    element: dict
    ancestors: list[dict]  # enclosing Microsoft.Common.Section elements

    @property
    def sections(self) -> list[str]:
        return [a.get("label", a.get("name")) for a in self.ancestors]

    @property
    def label(self) -> str:
        label = self.element.get("label", self.element.get("name"))
        if isinstance(label, dict):  # PasswordBox
            label = label.get("password", self.element.get("name"))
        return label

    def default(self) -> Any:
        el, kind = self.element, self.element.get("type")
        if kind == "Microsoft.Common.CheckBox":
            return bool(el.get("defaultValue", False))
        if kind == "Microsoft.Common.DropDown":
            options = el.get("constraints", {}).get("allowedValues", [])
            dv = el.get("defaultValue")
            if el.get("multiselect"):
                return [item["value"] if isinstance(item, dict) else item for item in dv or []]
            for opt in options:
                if dv in (opt.get("label"), opt.get("value")):
                    return opt["value"]
            return dv
        if kind == "Microsoft.Common.PasswordBox":
            return ""
        return el.get("defaultValue", "")

    def option_label(self, value: str) -> str:
        for opt in self.element.get("constraints", {}).get("allowedValues", []):
            if opt.get("value") == value:
                return opt.get("label", value)
        return value


class PortalForm:
    def __init__(self, path: Path = UI_DEFINITION):
        data = json.loads(path.read_text(encoding="utf-8"))
        self.parameters = data["parameters"]
        self.outputs: dict[str, str] = self.parameters["outputs"]
        self.step_order = ["basics"] + [s["name"] for s in self.parameters["steps"]]
        self.step_labels = dict(STEP_LABELS)
        self._elements = {"basics": self.parameters.get("basics", [])}
        for step in self.parameters["steps"]:
            self.step_labels[step["name"]] = step["label"]
            self._elements[step["name"]] = step["elements"]
        self.region_label = self.parameters["config"]["basics"]["location"].get("label", "Region")

    def control(self, step: str, path: list[str]) -> Control | None:
        elements, ancestors, element = self._elements.get(step, []), [], None
        for depth, name in enumerate(path):
            element = next((e for e in elements if e.get("name") == name), None)
            if element is None:
                return None
            if depth < len(path) - 1:
                ancestors.append(element)
                elements = element.get("elements", [])
        return Control(step, list(path), element, ancestors) if element else None

    def controls(self):
        """Yield every input control (sections are walked, not yielded)."""
        def walk(step, elements, path, ancestors):
            for element in elements:
                here = [*path, element["name"]]
                if element.get("type") == "Microsoft.Common.Section":
                    yield from walk(step, element.get("elements", []), here, [*ancestors, element])
                elif element.get("type") != "Microsoft.Common.InfoBox":
                    yield Control(step, here, element, ancestors)
        for step in self.step_order:
            yield from walk(step, self._elements[step], [], [])

    def _truthy(self, flag: Any, default: bool) -> bool:
        if flag is None:
            return default
        if isinstance(flag, str) and flag.startswith("["):
            return bool(self.evaluate(parse_expression(flag)))
        return bool(flag)

    def visible_by_default(self, control: Control) -> bool:
        return all(self._truthy(e.get("visible"), True) for e in [*control.ancestors, control.element])

    def required_blank_by_default(self) -> list[tuple[str, Control]]:
        """Controls the form requires, shows, and leaves blank when every default is kept."""
        by_path = {}
        for param in self.outputs:
            control = self.value_control(param)
            if control:
                by_path[(control.step, tuple(control.path))] = param
        out = []
        for control in self.controls():
            required = control.element.get("constraints", {}).get("required")
            if (self._truthy(required, False) and self.visible_by_default(control)
                    and control.default() in ("", [], None)):
                out.append((by_path.get((control.step, tuple(control.path)), ""), control))
        return out

    def resolve(self, node: Call) -> Control | None:
        if node.name == "basics":
            return self.control("basics", [node.args[0].value, *node.props])
        if node.name == "steps":
            return self.control(node.args[0].value, node.props)
        return None

    # -- evaluation of an output expression with every control at its default -----------
    def evaluate(self, node: Any) -> Any:
        if isinstance(node, Lit):
            return node.value
        name, args = node.name, node.args
        if name in ("steps", "basics"):
            control = self.resolve(node)
            if control is None:
                raise KeyError(f"unknown control {name}{args}{node.props}")
            return control.default()
        if name == "location":
            raise LookupError("region is chosen on the form")
        values = [self.evaluate(a) for a in args] if name != "if" else None
        if name == "if":
            return self.evaluate(args[1] if self.evaluate(args[0]) else args[2])
        if name == "contains":
            return values[1] in values[0]
        if name == "and":
            return all(values)
        if name == "or":
            return any(values)
        if name == "not":
            return not values[0]
        if name == "empty":
            return not values[0]
        if name == "parse":
            return json.loads(values[0])
        raise ValueError(f"unsupported function {name}")

    def form_default(self, param: str) -> tuple[bool, Any]:
        try:
            return True, self.evaluate(parse_expression(self.outputs[param]))
        except LookupError:
            return False, None

    # -- describe which control sets a parameter and when it's sent ----------------------
    def _split(self, param: str) -> tuple[Any, list[Any], Any]:
        """Split an output expression into (value node, gating conditions, fallback)."""
        tree = parse_expression(self.outputs[param])
        value, conditions, fallback = tree, [], None
        if isinstance(tree, Call) and tree.name == "if":
            cond, then, other = tree.args
            if _has_ref(then):
                value, conditions = then, _flatten_and(cond)
                fallback = other.value if isinstance(other, Lit) else None
            else:
                value = other
        elif isinstance(tree, Call) and tree.name == "and":
            items = _flatten_and(tree)
            value, conditions, fallback = items[-1], items[:-1], False
        return value, conditions, fallback

    def value_control(self, param: str) -> Control | None:
        """The control whose value becomes the parameter (None for region or options)."""
        value, _, _ = self._split(param)
        if _is_ref(value) and value.name != "location":
            return self.resolve(value)
        return None

    def describe(self, param: str) -> dict:
        value, conditions, fallback = self._split(param)
        info: dict[str, Any] = {"step": None, "where": "", "conditions": [], "fallback": fallback}
        if isinstance(value, Call) and value.name == "location":
            info["step"], info["where"] = "basics", self.region_label
        elif isinstance(value, Call) and value.name == "contains" and _is_ref(value.args[0]):
            control = self.resolve(value.args[0])
            option = value.args[1].value
            info["step"] = control.step
            info["where"] = f"{control.label}: *{control.option_label(option)}*"
        elif _is_ref(value):
            control = self.resolve(value)
            info["step"] = control.step
            info["where"] = " › ".join([*control.sections, control.label])
        for cond in conditions:
            text = self._condition(cond)
            if text:
                info["conditions"].append(text)
        return info

    def _condition(self, node: Any) -> str | None:
        if isinstance(node, Call) and node.name == "contains" and _is_ref(node.args[0]):
            control = self.resolve(node.args[0])
            return f"*{control.option_label(node.args[1].value)}* is selected"
        negated = isinstance(node, Call) and node.name == "not"
        inner = node.args[0] if negated else node
        if isinstance(inner, Call) and inner.name == "empty" and _is_ref(inner.args[0]):
            control = self.resolve(inner.args[0])
            return f"*{control.label}* {'has a value' if negated else 'is blank'}"
        if _is_ref(inner):
            control = self.resolve(inner)
            return f"*{control.label}* is {'cleared' if negated else 'checked'}"
        return None


# --------------------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------------------

def _code(value: Any) -> str:
    if isinstance(value, bool):
        return f"`{str(value).lower()}`"
    if isinstance(value, str):
        return "*(empty)*" if value == "" else f"`{value}`"
    if isinstance(value, list):
        if not value:
            return "`[]`"
        return "`[" + ", ".join(json.dumps(v) for v in value) + "]`"
    return f"`{value}`"


def _cell(text: str) -> str:
    return " ".join(text.split()).replace("|", "\\|")


def _escape_html(text: str) -> str:
    """Escape < and > outside code spans so placeholders like <app-host> stay visible."""
    parts = text.split("`")
    for i in range(0, len(parts), 2):
        parts[i] = parts[i].replace("<", "&lt;").replace(">", "&gt;")
    return "`".join(parts)


def _type(param: Param) -> str:
    return f"{param.type} (secure)" if param.secure else param.type


def _default(param: Param) -> str:
    if not param.has_default:
        return "*(required)*"
    if param.default_expr:
        return f"`{param.default_expr}` (expression)"
    return _code(param.default)


def _constraints(param: Param) -> str:
    parts = []
    if param.allowed is not None:
        parts.append("**Allowed:** " + ", ".join(_code(v) for v in param.allowed) + ".")
    for label, value in (("Minimum length", param.min_length), ("Maximum length", param.max_length),
                         ("Minimum value", param.min_value), ("Maximum value", param.max_value)):
        if value is not None:
            parts.append(f"**{label}:** {value}.")
    return " ".join(parts)


def _portal_cell(form: PortalForm, param: Param) -> str:
    if param.name not in form.outputs:
        return "Not on the form; the template default applies."
    info = form.describe(param.name)
    text = f"**{form.step_labels[info['step']]}** › {info['where']}."
    known, value = form.form_default(param.name)
    if known:
        text += f" Form default: {_code(value)}."
    if info["conditions"]:
        text += " Sent when " + " and ".join(info["conditions"])
        if info["fallback"] is not None:
            text += f"; otherwise {_code(info['fallback'])}"
        text += "."
    return text


def _anchor(name: str) -> str:
    return "param-" + name.lower()


def grouped(params: list[Param]) -> list[tuple[str, str, list[Param]]]:
    by_name = {p.name: p for p in params}
    seen: set[str] = set()
    out = []
    for title, intro, names in GROUPS:
        members = [by_name[n] for n in names if n in by_name]
        seen.update(p.name for p in members)
        out.append((title, intro, members))
    rest = [p for p in params if p.name not in seen]
    if rest:
        out.append((UNGROUPED, "Parameters not yet classified in build_reference.py.", rest))
    return out


def _slug(title: str) -> str:
    return re.sub(r"[^\w\- ]", "", title.lower()).strip().replace(" ", "-")


def render(params: list[Param] | None = None, form: PortalForm | None = None) -> str:
    params = params if params is not None else parse_bicep()
    form = form or PortalForm()
    on_form = [p for p in params if p.name in form.outputs]
    off_form = [p for p in params if p.name not in form.outputs]
    required = [p for p in params if not p.has_default]
    groups = grouped(params)

    lines = [
        "---",
        "title: OneGrid deployment parameter reference",
        "description: Every parameter of the OneGrid Bicep template, with its type, default, "
        "allowed values, and the portal form step that sets it.",
        f"ms.date: {MS_DATE}",
        "ms.topic: reference",
        "---",
        "",
        "<!-- Generated by docs/deploy/build_reference.py from main.bicep and "
        "createUiDefinition.json. Don't edit this file by hand: change the template or the "
        "generator, then run `python docs/deploy/build_reference.py`. -->",
        "",
        "# OneGrid deployment parameter reference",
        "",
        "Part of the [OneGrid landing zone design guide](../../architecture/design-guide.md).",
        "",
        "[Deploy OneGrid](../README.md) | [Deploy from the command line](../deploy-cli.md) | "
        "[Parameter files](../../../planetary-computer-pro-poc/deploy/azure/parameters/README.md)",
        "",
        f"The OneGrid template, [`main.bicep`](../../../planetary-computer-pro-poc/deploy/azure/main.bicep), "
        f"declares {len(params)} parameters. The compiled "
        "[`azuredeploy.json`](../../../planetary-computer-pro-poc/deploy/azure/azuredeploy.json) "
        "declares the same set. This page is generated from the template and the "
        "[portal form](../../../planetary-computer-pro-poc/deploy/azure/createUiDefinition.json), "
        "so it always matches the code.",
        "",
        f"- **{len(on_form)}** parameters are set by the portal form; **{len(off_form)}** are "
        "available only from the command line or a parameter file.",
    ]
    if required:
        lines.append(f"- **{len(required)}** parameters have no default and are required: "
                     + ", ".join(f"`{p.name}`" for p in required) + ".")
    else:
        lines.append("- No parameter is required: every parameter has a default. A "
                     "deployment with no parameters creates only GeoCatalog, sample storage, "
                     "and the Microsoft Foundry model, because those are the only components "
                     "whose switches default to `true`.")
    lines += [
        "- The **Template description** column reproduces each parameter's `@description` "
        "text verbatim, including the template's own product names. A **Note** adds context "
        "where the code behaves differently from the description.",
        "- **Form default** is what the portal form sends when you accept every default on "
        "every step. A command-line deployment uses the **Default** column instead, so set "
        "component switches explicitly; see "
        "[Portal defaults that differ from the template](#portal-defaults-that-differ-from-the-template).",
        "",
        "## Parameter groups",
        "",
        "| Group | Parameters |",
        "| --- | --- |",
    ]
    for title, _, members in groups:
        links = ", ".join(f"[`{p.name}`](#{_anchor(p.name)})" for p in members)
        lines.append(f"| [{title}](#{_slug(title)}) | {links} |")
    lines.append("")

    for title, intro, members in groups:
        lines += [f"## {title}", "", intro, "",
                  "| Parameter | Type | Default | Portal form | Template description |",
                  "| --- | --- | --- | --- | --- |"]
        for p in members:
            description = _escape_html(p.description) or "*(no description)*"
            constraints = _constraints(p)
            if constraints:
                description += " " + constraints
            if p.name in NOTES:
                description += " **Note:** " + _escape_html(NOTES[p.name])
            lines.append(
                f'| <a id="{_anchor(p.name)}"></a>`{p.name}` | {_type(p)} | {_cell(_default(p))} | '
                f"{_cell(_portal_cell(form, p))} | {_cell(description)} |")
        lines.append("")

    lines += [
        "## Portal form coverage",
        "",
        "Each portal step sets these parameters. The step names match the tabs of the "
        "**Deploy to Azure** form; [Deploy from the Azure portal](../deploy-portal.md) walks "
        "through them.",
        "",
        "| Portal step | Parameters |",
        "| --- | --- |",
    ]
    by_step: dict[str, list[str]] = {}
    for p in on_form:
        by_step.setdefault(form.describe(p.name)["step"], []).append(p.name)
    for step in form.step_order:
        if step in by_step:
            names = ", ".join(f"[`{n}`](#{_anchor(n)})" for n in by_step[step])
            lines.append(f"| {form.step_labels[step]} | {names} |")
    off = ", ".join(f"[`{p.name}`](#{_anchor(p.name)})" for p in off_form)
    lines += [f"| Not on the form | {off} |", ""]

    lines += [
        "## Portal defaults that differ from the template",
        "",
        "When you accept every default, the portal form sends these values, which differ "
        "from the template defaults. Set them explicitly in a command-line deployment to get "
        "the same result as the portal; the "
        "[`baseline-required`](../../../planetary-computer-pro-poc/deploy/azure/parameters/README.md) "
        "parameter file does.",
        "",
        "| Parameter | Template default | Portal form default |",
        "| --- | --- | --- |",
    ]
    for p in on_form:
        known, value = form.form_default(p.name)
        if known and p.has_default and not p.default_expr and value != p.default:
            lines.append(f"| [`{p.name}`](#{_anchor(p.name)}) | {_code(p.default)} | {_code(value)} |")
    lines += [
        "",
        "The form's region has no fixed default: you choose it on the **Basics** step from "
        "the allowed list. The template default is " + _code(params_by_name(params)["location"].default)
        + ".",
        "",
    ]
    blanks = form.required_blank_by_default()
    if blanks:
        lines += [
            "With every default kept, the form also requires these values before **Review + "
            "create** succeeds, because their controls are shown, required, and blank:",
            "",
        ]
        for param, control in blanks:
            where = " › ".join([*control.sections, control.label])
            name = f"[`{param}`](#{_anchor(param)})" if param else "*(no parameter)*"
            lines.append(f"- {name}: **{form.step_labels[control.step]}** › {where}.")
        lines.append("")
    lines += [
        "## Regenerate this page",
        "",
        "Run the generator after you change `main.bicep` or `createUiDefinition.json`, and "
        "commit the result with the template change:",
        "",
        "```powershell",
        "python docs/deploy/build_reference.py",
        "python -m unittest discover -s docs/deploy -p \"test_*.py\"",
        "```",
        "",
        "`python docs/deploy/build_reference.py --check` exits with an error when this page "
        "is stale. The tests also check that every parameter is documented and that the "
        "shipped parameter files use only real parameter names.",
        "",
    ]
    return "\n".join(lines)


def params_by_name(params: list[Param]) -> dict[str, Param]:
    return {p.name: p for p in params}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true",
                        help="fail if the committed reference is out of date")
    args = parser.parse_args(argv)
    content = render()
    shown = OUTPUT.relative_to(ROOT) if OUTPUT.is_relative_to(ROOT) else OUTPUT
    if args.check:
        current = OUTPUT.read_text(encoding="utf-8") if OUTPUT.exists() else ""
        if current != content:
            print(f"{shown} is stale; run python docs/deploy/build_reference.py", file=sys.stderr)
            return 1
        print(f"{shown} is current")
        return 0
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(content, encoding="utf-8", newline="\n")
    print(f"wrote {shown} ({len(parse_bicep())} parameters)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
