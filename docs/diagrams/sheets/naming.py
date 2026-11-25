"""Resource naming: every Azure resource the baseline template creates, with its name pattern.

Drawn like the Azure Virtual Desktop landing zone accelerator's resource organization and
naming sheet: subscription row, resource group rows, then one row per resource with its
name and a purpose label. The left panels are generated from main.bicep (a small parser
resolves each resource's name expression into a readable pattern) and from the item names
the provisioner uses in Fabric. The right panel is a recommendation with illustrative names."""

from pathlib import Path
import re

from diagram_engine import Sheet

LABEL = "Resource naming"
SUMMARY = ("Every resource main.bicep and the provisioner create, with name patterns resolved from the "
           "template, and a recommended split into resource groups by lifecycle")

ROOT = Path(__file__).resolve().parents[3]
BICEP = ROOT / "planetary-computer-pro-poc" / "deploy" / "azure" / "main.bicep"

# Declarations the sheet leaves out: they have no name of their own to plan.
SKIP_TYPES = ("Microsoft.Authorization/roleAssignments",)
SKIP_SUFFIXES = ("/blobServices",)
SKIP_PREFIXES = ("Microsoft.Graph/",)

ICONS = {
    "Microsoft.Web/serverfarms": "app-service",
    "Microsoft.Web/sites": "app-service",
    "Microsoft.CognitiveServices/accounts": "ai-foundry",
    "Microsoft.CognitiveServices/accounts/deployments": "ai-foundry",
    "Microsoft.MachineLearningServices/workspaces": "machine-learning",
    "Microsoft.MachineLearningServices/workspaces/onlineEndpoints": "machine-learning",
    "Microsoft.MachineLearningServices/workspaces/onlineEndpoints/deployments": "machine-learning",
    "Microsoft.App/managedEnvironments": "container-apps-env",
    "Microsoft.App/jobs": "container-apps-job",
    "Microsoft.ContainerRegistry/registries": "container-registry",
    "Microsoft.Orbital/geoCatalogs": "geocatalog",
    "Microsoft.ManagedIdentity/userAssignedIdentities": "managed-identity",
    "Microsoft.Storage/storageAccounts": "blob-storage",
    "Microsoft.Storage/storageAccounts/blobServices/containers": "blob-storage",
    "Microsoft.KeyVault/vaults": "key-vault",
    "Microsoft.OperationalInsights/workspaces": "log-analytics",
    "Microsoft.Insights/components": "application-insights",
    "Microsoft.Fabric/capacities": "fabric",
    "Microsoft.Resources/deploymentScripts": None,   # no official icon in the asset set
}

# Purpose label and reading order (function) per symbolic resource name in main.bicep.
ORDER = ("web", "ai", "weather", "geo", "data", "security", "monitor", "capacity", "deploy")
PURPOSE = {
    "chatAgentPlan": ("web", "App Service plan (Linux) for the web app"),
    "chatAgentSite": ("web", "OneGrid web app (App Service, Node 22)"),
    "openAi": ("ai", "Microsoft Foundry account"),
    "openAiDeployment": ("ai", "Model deployment (gpt-5-mini)"),
    "amlWorkspace": ("weather", "Azure Machine Learning workspace for Aurora"),
    "auroraEndpoint": ("weather", "Aurora online endpoint"),
    "auroraDeployment": ("weather", "Aurora GPU deployment (A100)"),
    "containerAppsEnv": ("weather", "Container Apps environment for the forecast job"),
    "auroraJob": ("weather", "Scheduled Aurora forecast job"),
    "auroraAcr": ("weather", "Container Registry for the pipeline image"),
    "geoCatalog": ("geo", "GeoCatalog (Planetary Computer Pro)"),
    "ingestIdentity": ("geo", "Managed identity for GeoCatalog ingestion"),
    "sampleStorage": ("data", "Storage account: sample data, outputs, app package"),
    "sampleContainer": ("data", "Container: imagery and asset uploads"),
    "modelOutputsContainer": ("data", "Container: published forecast outputs"),
    "onegridAppPackageContainer": ("data", "Container: private web app package"),
    "auroraChannelContainer": ("data", "Container: Aurora transfer channel"),
    "scriptStorage": ("data", "Storage account for the deployment scripts"),
    "amlStorage": ("data", "Storage account for the Azure ML workspace"),
    "amlKeyVault": ("security", "Key Vault for the Azure ML workspace"),
    "fabricPlaneIdentity": ("security", "Managed identity that runs the provisioner"),
    "auroraJobIdentity": ("security", "Managed identity for the forecast job"),
    "logAnalytics": ("monitor", "Log Analytics for the job environment"),
    "amlApplicationInsights": ("monitor", "Application Insights for the Azure ML workspace"),
    "fabricCapacity": ("capacity", "Fabric capacity (F SKU)"),
    "appProvisionScript": ("deploy", "Deployment script: app plane"),
    "fabricPlaneScript": ("deploy", "Deployment script: Fabric plane"),
    "auroraImageBuild": ("deploy", "Deployment script: builds the pipeline image"),
}

# Conditions that the portal's default selection turns on read as unconditional.
DEFAULT_ON = {"deployGeoCatalog", "deploySampleStorage", "deployAiAgent", "deployOneGridAppEffective",
              "deployFabricPlaneEffective", "deployAppProvision"}
CONDITION = {
    "deployAuroraJob": "if forecast job",
    "deployAuroraModel": "if Aurora",
    "deployAuroraDeployment": "if model asset set",
    "buildAuroraImage": "if forecast job",
    "deployAuroraJob && empty(auroraJobImage)": "if forecast job",
    "createFabricCapacityEffective": "if capacity created",
    "deployScriptStorage": "if policy exemption",
}

# Placeholders the resolver produces, explained in the note.
PLACEHOLDERS = {
    "<unique>": "<unique> = uniqueString(resourceGroup().id): 13 characters, stable per resource group "
                "(example a1b2c3d4e5f6g)",
    "<suffix>": "<suffix> = first 8 characters of <unique> (amlSuffix; example a1b2c3d4)",
    "<unique12>": "<unique12> = first 12 characters of <unique>",
    "<run>": "<run> = 13 characters of uniqueString(resourceGroup().id, deploymentToken); new each deployment",
}

# Recommended resource groups (illustrative CAF-style names) and where each resource moves.
ENTERPRISE_RGS = (
    ("app", "Web front end; changes with each app release"),
    ("ai", "Model account and deployments; quota-bound"),
    ("weather", "Aurora inference and the forecast job; GPU quota"),
    ("geo", "Geospatial catalog and its ingestion identity"),
    ("data", "Stateful storage and Fabric capacity; longest retention"),
    ("monitor", "Shared telemetry; owned by operations"),
    ("deploy", "Provisioner identity, scripts and their storage"),
)
ENTERPRISE = {
    "chatAgentPlan": ("app", "asp-onegrid-<env>-<region>"),
    "chatAgentSite": ("app", "app-onegrid-<env>-<region>"),
    "openAi": ("ai", "aif-onegrid-<env>-<region>"),
    "openAiDeployment": ("ai", "gpt-5-mini"),
    "amlWorkspace": ("weather", "mlw-onegrid-<env>-<region>"),
    "auroraEndpoint": ("weather", "aurora-<env>-<region>"),
    "auroraDeployment": ("weather", "aurora"),
    "containerAppsEnv": ("weather", "cae-onegrid-<env>-<region>"),
    "auroraJob": ("weather", "caj-onegrid-<env>-<region>-aurora"),
    "auroraAcr": ("weather", "cronegrid<env><region>"),
    "auroraJobIdentity": ("weather", "id-onegrid-<env>-<region>-aurora"),
    "amlStorage": ("weather", "stmlonegrid<env><region>"),
    "amlKeyVault": ("weather", "kv-onegrid-<env>-<region>"),
    "geoCatalog": ("geo", "geoonegrid<env><region>"),
    "ingestIdentity": ("geo", "id-onegrid-<env>-<region>-ingest"),
    "sampleStorage": ("data", "stonegrid<env><region>"),
    "sampleContainer": ("data", "sample-assets"),
    "modelOutputsContainer": ("data", "model-outputs"),
    "onegridAppPackageContainer": ("data", "onegrid-app-package"),
    "auroraChannelContainer": ("data", "aurora-channel"),
    "fabricCapacity": ("data", "fconegrid<env><region>"),
    "logAnalytics": ("monitor", "log-onegrid-<env>-<region>"),
    "amlApplicationInsights": ("monitor", "appi-onegrid-<env>-<region>"),
    "fabricPlaneIdentity": ("deploy", "id-onegrid-<env>-<region>-provisioner"),
    "scriptStorage": ("deploy", "stonegrid<env><region>scr"),
    "appProvisionScript": ("deploy", "ds-onegrid-<env>-<region>-app"),
    "fabricPlaneScript": ("deploy", "ds-onegrid-<env>-<region>-fabric"),
    "auroraImageBuild": ("deploy", "ds-onegrid-<env>-<region>-image"),
}

# Fabric items the provisioner creates (deploy.ps1 and onegrid-solution-provision.ps1), with depth.
FABRIC_ITEMS = (
    (0, "lh_poc", "Lakehouse with og.* tables and SQL analytics endpoint", "lakehouse"),
    (0, "pi-realtime-eventhouse", "Eventhouse for real-time telemetry", "event-house"),
    (1, "pi-realtime-db", "KQL database", "kql-database"),
    (0, "generate_onegrid_data, ...", "Notebooks, one per folder in infra/fabric/notebooks", "notebook"),
    (0, "Prediction_Pipeline", "Data pipeline for the prediction workflow", "pipeline"),
    (0, "semantic-main-import", "Semantic model: asset reliability", "semantic-model"),
    (0, "semantic-oge", "Semantic model: OGE twin", "semantic-model"),
    (0, "OneGridModelImport", "Import semantic model the app queries", "semantic-model"),
    (0, "OneGridOntology", "Ontology (Digital Twin Builder)", "ontology"),
    (0, "OneGridOntologyAgent", "Data agent", "data-agent"),
    (0, "pcp_model_outputs", "OneLake shortcut to model-outputs · if connection set", "one-lake"),
)


# ----- main.bicep parser ---------------------------------------------------------------------------
def _split_top(text, sep):
    """Split on sep at bracket depth 0, outside string literals."""
    parts, depth, quote, start = [], 0, False, 0
    for i, ch in enumerate(text):
        if ch == "'":
            quote = not quote
        elif not quote:
            if ch in "([{":
                depth += 1
            elif ch in ")]}":
                depth -= 1
            elif ch == sep and depth == 0:
                parts.append(text[start:i])
                start = i + 1
    parts.append(text[start:])
    return parts


def _ternary(expr):
    head = _split_top(expr, "?")
    if len(head) != 2:
        return None
    branches = _split_top(head[1], ":")
    return (head[0].strip(), branches[0].strip(), branches[1].strip()) if len(branches) == 2 else None


class Bicep:
    """Just enough of Bicep to read main.bicep: params, single-line vars, resources and names."""

    def __init__(self, text):
        self.params, self.vars, self.resources = {}, {}, []
        lines = text.splitlines()
        i = 0
        while i < len(lines):
            line = lines[i]
            if m := re.match(r"param (\w+) [\w\[\]]+(?: = (.+))?$", line):
                self.params[m.group(1)] = (m.group(2) or "").strip()
            elif m := re.match(r"var (\w+) = (.+)$", line):
                self.vars[m.group(1)] = m.group(2).strip()
            elif m := re.match(r"resource (\w+) '([^'@]+)@[^']*'( existing)? = (?:if \((.*)\) )?\{", line):
                block = []
                i += 1
                while i < len(lines) and lines[i] != "}":
                    block.append(lines[i])
                    i += 1
                body = "\n".join(block)
                name = re.search(r"^  name: (.+)$", body, re.M)
                parent = re.search(r"^  parent: (\w+)$", body, re.M)
                self.resources.append({
                    "symbol": m.group(1), "type": m.group(2), "existing": bool(m.group(3)),
                    "condition": (m.group(4) or "").strip(), "name": name.group(1).strip() if name else None,
                    "parent": parent.group(1) if parent else None,
                })
            i += 1

    def resolve(self, expr):
        """Readable pattern for a Bicep string expression."""
        e = expr.strip()
        if t := _ternary(e):
            return self.resolve(t[1])
        if e.startswith("'") and e.endswith("'"):
            return self._interpolate(e[1:-1])
        if m := re.fullmatch(r"(\w+)\((.*)\)", e, re.S):
            fn, args = m.group(1), [a.strip() for a in _split_top(m.group(2), ",")]
            if fn in ("toLower", "toUpper"):
                return self.resolve(args[0])
            if fn == "uniqueString":
                return "<run>" if any("deploymentToken" in a for a in args) else "<unique>"
            if fn == "take":
                inner, n = self.resolve(args[0]), int(args[1])
                if inner == "<unique>":
                    return "<suffix>" if n == 8 else f"<unique{n}>"
                return inner if inner.startswith("<") else inner[:n]
            return f"<{fn}()>"
        if e in self.vars:
            return self.resolve(self.vars[e])
        if e in self.params:
            default = self.params[e]
            return self.resolve(default) if default.startswith("'") else f"<{e}>"
        return f"<{e}>"

    def _interpolate(self, body):
        out, i = [], 0
        while i < len(body):
            if body.startswith("${", i):
                depth, j = 1, i + 2
                while depth:
                    depth += {"{": 1, "}": -1}.get(body[j], 0)
                    j += 1
                out.append(self.resolve(body[i + 2:j - 1]))
                i = j
            else:
                out.append(body[i])
                i += 1
        return "".join(out)

    def alternative(self, expr):
        """For `empty(p) ? generated : p` names, the parameter that overrides the generated name."""
        e = expr.strip()
        while e in self.vars:
            e = self.vars[e]
        t = _ternary(e)
        return t[2] if t and re.fullmatch(r"\w+", t[2]) else None


def template_resources():
    """(shown, skipped, total): resources in reading order with depth, pattern, purpose and condition."""
    bicep = Bicep(BICEP.read_text(encoding="utf-8"))
    by_symbol = {r["symbol"]: r for r in bicep.resources}
    shown, skipped = [], []
    for r in bicep.resources:
        if (r["existing"] or r["type"] in SKIP_TYPES or r["type"].endswith(SKIP_SUFFIXES)
                or r["type"].startswith(SKIP_PREFIXES) or r["name"] is None):
            skipped.append(r)
            continue
        parent = r["parent"]
        while parent and by_symbol[parent]["type"].endswith(SKIP_SUFFIXES):
            parent = by_symbol[parent]["parent"]
        r["display_parent"] = parent
        r["pattern"] = bicep.resolve(r["name"])
        r["alt"] = bicep.alternative(r["name"])
        group, purpose = PURPOSE.get(r["symbol"], ("deploy", r["type"].split("/")[-1]))
        if r["alt"]:
            purpose += f"; {r['alt']} overrides"
        condition = r["condition"]
        if condition and condition not in DEFAULT_ON:
            purpose += " · " + CONDITION.get(condition, "conditional")
        r.update(group=group, purpose=purpose, icon=ICONS.get(r["type"], "resource-group"))
        shown.append(r)

    # Reading order: function group, then declaration order, children straight after their parent.
    roots = [r for r in shown if not r["display_parent"]]
    roots.sort(key=lambda r: ORDER.index(r["group"]))
    ordered = []

    def visit(r, depth):
        r["depth"] = depth
        ordered.append(r)
        for child in shown:
            if child["display_parent"] == r["symbol"]:
                visit(child, depth + 1)

    for r in roots:
        visit(r, 0)
    return ordered, skipped, len(bicep.resources)


# ----- sheet -----------------------------------------------------------------------------------------
ROW, TOP = 32, 148                 # row pitch, first row
PURPOSE_W = 400                    # purpose label column, both panels
LX, LP = 40, 410                   # left panel x and purpose column (longest name ends near 390)
LR = LP + PURPOSE_W + 16
RR = 1760                          # right panel right edge
RX = RR - 16 - PURPOSE_W - 417     # right panel x; its longest name needs 397 px after RX
RP = RX + 417
INDENT = 24


def rows(s, prefix, panel_x, panel_right, purpose_x, y, entries):
    """Lay out (depth, kind, name, purpose, icon) rows; depth 0 is the subscription column."""
    for i, (depth, kind, name, purpose, icon) in enumerate(entries):
        x = panel_x + 20 + depth * INDENT
        s.row(f"{prefix}-{i}", x, y, kind, name, purpose, icon,
              name_w=purpose_x - x - 34, purpose_w=panel_right - 16 - purpose_x)
        y += ROW
    return y


def build():
    resources, skipped, total = template_resources()
    s = Sheet(
        "onegrid-reference-naming",
        "OneGrid · resource organization and naming",
        "OneGrid resource organization and naming",
        "Every resource the baseline template and its provisioner create, with name patterns resolved from "
        "main.bicep, and a recommended split into resource groups by lifecycle.",
        width=1800, height=1700, style="learn",
    )
    s.footnote = ("Left: names as main.bicep and the provisioner resolve them. Right: a recommendation with "
                  "illustrative Cloud Adoption Framework names; the template does not deploy it.")

    # ----- Left: as deployed ------------------------------------------------------------------------
    entries = [(0, "sub", "OneGrid workload subscription", "Subscription that holds the OneGrid resource group", None),
               (1, "rg", "<resource group you choose>", "All OneGrid Azure resources", None)]
    entries += [(2 + r["depth"], "res", r["pattern"], r["purpose"], r["icon"]) for r in resources]
    bottom = TOP + len(entries) * ROW + 12
    s.app("as-deployed", LX, 100, LR - LX, bottom - 100, "As deployed by the baseline template",
          note=f"main.bicep, {len(resources)} resources in one resource group")
    rows(s, "l", LX, LR, LP, TOP, entries)

    fabric_top = bottom + 30
    fabric = [(0, "rg", "OneGrid", "Fabric workspace (fabricWorkspaceName)", "fabric")]
    fabric += [(1 + depth, "res", name, purpose, icon) for depth, name, purpose, icon in FABRIC_ITEMS]
    fabric_bottom = fabric_top + 48 + len(fabric) * ROW + 12
    s.app("fabric", LX, fabric_top, LR - LX, fabric_bottom - fabric_top, "Microsoft Fabric workspace",
          note="created by the provisioner", icon="fabric")
    rows(s, "f", LX, LR, LP, fabric_top + 48, fabric)

    # ----- Right: enterprise recommendation -------------------------------------------------------------
    by_symbol = {r["symbol"]: r for r in resources}
    missing = sorted(set(by_symbol) - set(ENTERPRISE))
    if missing:
        raise ValueError(f"naming: place these main.bicep resources in a recommended group: {missing}")
    entries = [(0, "sub", "sub-onegrid-<env>", "One subscription per environment (workload landing zone)", None)]
    gaps = []
    for key, purpose in ENTERPRISE_RGS:
        if len(entries) > 1:
            gaps.append(len(entries))
        entries.append((1, "rg", f"rg-onegrid-<env>-<region>-{key}", purpose, None))
        for r in resources:
            target, name = ENTERPRISE[r["symbol"]]
            if target == key:
                entries.append((2 + (r["depth"] if r["display_parent"] in by_symbol and
                                     ENTERPRISE[r["display_parent"]][0] == key else 0),
                                "res", name, r["purpose"].split("; ")[0], r["icon"]))
    entries.append((1, "res", "workload, env, owner, costCenter", "Tags on every resource group; Policy inherits them",
                    "policy"))
    gaps.append(len(entries) - 1)
    y, right_rows = TOP, []
    for i, entry in enumerate(entries):
        if i in gaps:
            y += 10
        right_rows.append((y, entry))
        y += ROW
    right_bottom = y + 12
    s.app("recommended", RX, 100, RR - RX, right_bottom - 100, "Enterprise recommendation",
          note="illustrative names, not deployed by the template")
    for i, (ry, (depth, kind, name, purpose, icon)) in enumerate(right_rows):
        x = RX + 20 + depth * INDENT
        s.row(f"r-{i}", x, ry, kind, name, purpose, icon, name_w=RP - x - 34, purpose_w=RR - 16 - RP)

    # The baseline resource group splits into the recommended groups.
    rg_row = s.item("l-1")
    y_mid = rg_row.y + rg_row.h / 2
    s.flow("split", "l-1", "recommended", [(rg_row.x + rg_row.w, y_mid), (RX, y_mid)], "control",
           label="split", at=((LR + RX) / 2, y_mid - 8))

    # ----- Example inputs -----------------------------------------------------------------------------
    patterns = " ".join(r["pattern"] for r in resources)
    lines = ["namePrefix = 'pcpro' (variable in main.bicep); container and deployment names are fixed strings"]
    lines += [text for key, text in PLACEHOLDERS.items() if key in patterns]
    lines += [f"Parsed {total} declarations; {len(skipped)} skipped (role assignments, blob service, Microsoft Graph)",
              "pi-events-stream (Eventstream) is published separately, not by the provisioner",
              "Purposes ending in '· if ...' are off in the portal's default selection",
              "Recommendation: <env> = dev, test or prod; <region> = short code such as weu"]
    s.note("inputs", RX, right_bottom + 30, RR - RX, "Example inputs used for the patterns", lines)
    s.height = max(fabric_bottom, s.item("inputs").y + s.item("inputs").h) + 60
    return s
