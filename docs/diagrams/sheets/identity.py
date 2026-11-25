"""Identity and authorization, drawn in Azure Architecture Center style.

Read left to right: who (seven principals) -> the credential each presents through
Microsoft Entra ID -> what it can reach (resources in the resource group and Fabric).
Each principal has one row; a secondary grant leaves from the top or bottom of its icon
and runs in the gap between rows, so no flow crosses another. Role names and scopes are
in the Identity flow list in docs/architecture/traffic-and-security.md."""

from diagram_engine import Sheet

LABEL = "Identity and authorization"
SUMMARY = ("Seven principals, each traced from the credential it presents through Microsoft "
           "Entra ID to the resources it can reach")

P, N, M, F = 150, 760, 1010, 1405            # principal, near, middle and Fabric columns
ROWS = [220 + 120 * i for i in range(7)]       # icon tops, one row per principal
MID = [r + 22 for r in ROWS]
ENTRA = 450                                    # credential labels sit on the Entra column


def build():
    s = Sheet(
        "onegrid-reference-identity",
        "OneGrid · identity and authorization",
        "Identity and authorization",
        "Each principal presents its own credential through Microsoft Entra ID; network reachability "
        "never substitutes for data permission.",
        width=1600, height=1100, style="learn",
    )
    s.footnote = ("Numbered principals match the Identity flow list in the traffic and security guide, "
                  "which names every role and scope. Dashed lines are optional paths.")

    # Containers
    s.stage("principals", 40, 200, 220, 840, "Principals")
    s.zone("entra", 330, 160, 240, 880, "Microsoft Entra ID", icon="entra-id")
    s.zone("rg", 640, 160, 540, 880, "Resource group", icon="resource-group")
    s.zone("fabric", 1250, 160, 310, 880, "Microsoft Fabric", icon="fabric")

    # Principals (who)
    for i, (id, name, caption, icon) in enumerate((
        ("user", "Signed-in user", "Entra user or group", "users"),
        ("app-mi", "App Service identity", "system-assigned", "managed-identity"),
        ("ingest-mi", "Ingestion identity", "for GeoCatalog", "managed-identity"),
        ("job-mi", "Forecast job identity", "user-assigned", "managed-identity"),
        ("refresh-sp", "Import refresh", "service principal", "entra-id"),
        ("ws-id", "Workspace identity", "Fabric, optional", "managed-identity"),
        ("deploy-mi", "Deployment identity", "provisioning only", "managed-identity"),
    )):
        s.node(id, P, ROWS[i], name, caption, icon, w=200)

    # Resources (what it can reach)
    s.node("app", N, ROWS[0], "OneGrid web app", "App Service", "app-service", w=170)
    s.node("geocatalog", N, ROWS[1], "GeoCatalog", "Planetary Computer Pro", "geocatalog", w=170)
    s.node("blob", N, ROWS[2], "Blob storage", "sample account", "blob-storage", w=170)
    s.node("aml", N, ROWS[3], "Azure Machine Learning", "Aurora endpoint", "machine-learning", w=170)
    s.node("acr", M, ROWS[3], "Container Registry", "pipeline image", "container-registry", w=170)
    s.node("source", N, ROWS[5], "Shortcut source", "ADLS Gen2 or Blob", "blob-storage", w=170)
    s.node("items", F, ROWS[1], "Fabric items", "KQL, DAX, Data Agent", "kql-database", w=170)
    s.node("model", F, ROWS[4], "Semantic model", "Import, SQL endpoint", "semantic-model", w=170)
    s.node("shortcut", F, ROWS[5], "OneLake shortcut", "Lakehouse files", "one-lake", w=170)

    # One row per principal: the label is the credential it presents
    rows = (
        ("user", "app", "OIDC sign-in", {}),
        ("app-mi", "geocatalog", "Managed identity", {}),
        ("ingest-mi", "blob", "Managed identity", {}),
        ("job-mi", "aml", "Managed identity", {}),
        ("refresh-sp", "model", "Client secret", {}),
        ("ws-id", "source", "Connection", {"dashed": True}),
    )
    for i, (src, dst, credential, extra) in enumerate(rows):
        s.flow(f"i{i + 1}", src, dst, [s.port(src, "r"), s.port(dst, "l")], "identity",
               label=credential, at=(ENTRA, MID[i] - 8), **extra)
    s.flow("i7", "deploy-mi", "rg", [s.port("deploy-mi", "r"), (640, MID[6])], "identity",
           label="Managed identity", at=(ENTRA, MID[6] - 8))

    # Secondary grants run in the gaps between rows
    def above(i):
        return ROWS[i] - 20

    def below(i):
        return ROWS[i] + 80 + 20

    s.flow("app-fabric", "app-mi", "items",
           [s.port("app-mi", "t"), (P, above(1)), (F, above(1)), s.port("items", "t")], "identity")
    s.flow("app-blob", "app-mi", "blob",
           [s.port("app-mi", "b"), (P, below(1)), (N, below(1)), s.port("blob", "t")], "identity")
    s.flow("job-blob", "job-mi", "blob",
           [s.port("job-mi", "t"), (P, above(3)), (N, above(3)), s.port("blob", "b")], "identity")
    s.flow("job-acr", "job-mi", "acr",
           [s.port("job-mi", "b"), (P, below(3)), (M, below(3)), s.port("acr", "b")], "identity")
    s.flow("deploy-fabric", "deploy-mi", "fabric",
           [s.port("deploy-mi", "t"), (P, above(6)), (1250, above(6))], "identity",
           label="Fabric APIs", at=(1080, above(6) - 8))

    # Context: the shortcut reads its source with the workspace identity's connection
    s.flow("shortcut-data", "source", "shortcut", sides=("r", "l"), dashed=True)

    # Numbered principals (Identity flow list in traffic-and-security.md)
    for i in range(7):
        s.step(i + 1, 295, MID[i])
    return s
