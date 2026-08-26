// Sample governance dataset + router — mirrors the report-app governance.js output shapes
// so the Governance persona renders fully in "local preview" mode (no live Fabric tenant).

const PRINCIPALS = [
  {
    id: "grp-exec",
    displayName: "OneGrid-Executive-Viewers",
    type: "Group",
    sources: ["persona group"],
  },
  {
    id: "grp-ops",
    displayName: "OneGrid-ControlRoom-Operators",
    type: "Group",
    sources: ["persona group"],
  },
  {
    id: "grp-maint",
    displayName: "OneGrid-Maintenance-Planners",
    type: "Group",
    sources: ["persona group"],
  },
  { id: "grp-ont", displayName: "OntologyReaders", type: "Group", sources: ["OneLake role"] },
  {
    id: "sp-app",
    displayName: "oge-report-app (service principal)",
    type: "ServicePrincipal",
    sources: ["workspace role"],
  },
  {
    id: "usr-eng",
    displayName: "data-eng-admin@contoso.com",
    type: "User",
    sources: ["direct grant"],
  },
];

const RESOURCES = [
  { resourceId: "tbl-dim_asset", resource: "/Tables/oge/dim_asset", source: "OneLake role" },
  { resourceId: "tbl-aakr_health", resource: "/Tables/oge/aakr_health", source: "OneLake role" },
  { resourceId: "tbl-watchlist", resource: "/Tables/oge/watchlist", source: "OneLake role" },
  { resourceId: "tbl-anomaly", resource: "/Tables/oge/anomaly_advisories", source: "OneLake role" },
  { resourceId: "tbl-workreq", resource: "/Tables/oge/fact_work_requests", source: "OneLake role" },
  { resourceId: "tbl-pred", resource: "/Tables/oge/predictions_shortterm", source: "OneLake role" },
  { resourceId: "files-manuals", resource: "/Files/manuals", source: "workspace role" },
];

// principal -> reachable resources (effective access)
const GRANTS = {
  "grp-exec": ["tbl-dim_asset", "tbl-aakr_health", "tbl-pred"],
  "grp-ops": ["tbl-dim_asset", "tbl-aakr_health", "tbl-watchlist", "tbl-anomaly", "tbl-pred"],
  "grp-maint": ["tbl-dim_asset", "tbl-workreq", "files-manuals"],
  "grp-ont": ["tbl-dim_asset"],
  "sp-app": RESOURCES.map((r) => r.resourceId),
  "usr-eng": ["tbl-workreq", "tbl-watchlist"],
};
const ROW_FILTER = {
  "grp-exec": "plant IN (assigned region)",
  "grp-maint": "site_name = assigned site",
};

const resById = Object.fromEntries(RESOURCES.map((r) => [r.resourceId, r]));

function accessFor(pid) {
  const p = PRINCIPALS.find((x) => x.id === pid);
  const isDirect = p?.type === "User";
  const resources = (GRANTS[pid] || []).map((rid) => ({
    resource: resById[rid].resource,
    resourceId: rid,
    action: rid.startsWith("files") ? "Read" : "ReadData",
    via: isDirect ? "direct user grant" : `${p.displayName} → OneLake role`,
    inherited: isDirect ? "direct" : "group",
    rowFilter: ROW_FILTER[pid] || null,
    allowedColumns: "all",
    confidence: isDirect ? "review" : "confirmed",
  }));
  return { id: pid, displayName: p?.displayName, type: p?.type, resources };
}

const FINDINGS = [
  {
    id: "f1",
    severity: "high",
    title: "Service principal has Contributor on the workspace",
    detail:
      "oge-report-app holds a Contributor workspace role, granting write access beyond the read-only reporting need.",
    fix: "Downgrade oge-report-app to Viewer + scoped OneLake ReadData roles.",
  },
  {
    id: "f2",
    severity: "medium",
    title: "Direct user grant detected",
    detail:
      "data-eng-admin@contoso.com is granted directly rather than via an Entra group, bypassing group-based governance.",
    fix: "Move the grant into an Entra security group and remove the direct assignment.",
  },
  {
    id: "f3",
    severity: "low",
    title: "OneLake role without row filter on work requests",
    detail:
      "MaintenancePlanners can read fact_work_requests for all sites; a site row-filter is recommended.",
    fix: "Apply a site_name row filter to the Maintenance OneLake role.",
  },
];

const CHANGES = [
  { type: "granted", principalId: "grp-ops", resourceId: "tbl-pred" },
  { type: "revoked", principalId: "usr-eng", resourceId: "tbl-dim_asset" },
];

const TESTS = [
  {
    kind: "positive",
    persona: "Executive-Viewers",
    expectation: "CAN read dim_asset, aakr_health, predictions (fleet KPIs).",
  },
  {
    kind: "negative",
    persona: "Executive-Viewers",
    expectation: "CANNOT read fact_work_requests (maintenance detail).",
  },
  {
    kind: "positive",
    persona: "ControlRoom-Operators",
    expectation: "CAN read watchlist + anomaly_advisories (live ops).",
  },
  {
    kind: "row",
    persona: "Maintenance-Planners",
    expectation: "Row filter limits fact_work_requests to the assigned site.",
  },
  {
    kind: "negative",
    persona: "OntologyReaders",
    expectation: "CANNOT read raw telemetry tables — dim_asset metadata only.",
  },
];

export function governanceRoute(p, _params) {
  if (p === "/api/governance/posture") {
    return {
      source: "sample",
      connected: false,
      mode: "local preview",
      appGrant: "Contributor",
      lakehouse: "oge-lakehouse",
      generatedAt: null,
      workspaceId: null,
      collectors: { workspaceRoles: "sample", onelakeRoles: "sample", datasetUsers: "sample" },
      totals: { principals: PRINCIPALS.length, resources: RESOURCES.length, roles: 4 },
      findingCounts: {
        high: FINDINGS.filter((f) => f.severity === "high").length,
        medium: FINDINGS.filter((f) => f.severity === "medium").length,
        low: FINDINGS.filter((f) => f.severity === "low").length,
      },
      findings: FINDINGS,
    };
  }
  if (p === "/api/governance/principals") {
    return {
      principals: PRINCIPALS.map((x) => ({
        id: x.id,
        displayName: x.displayName,
        type: x.type,
        sources: x.sources,
        resourceCount: (GRANTS[x.id] || []).length,
      })),
    };
  }
  if (p.startsWith("/api/governance/principals/")) {
    return accessFor(decodeURIComponent(p.slice("/api/governance/principals/".length)));
  }
  if (p === "/api/governance/resources") {
    return {
      resources: RESOURCES.map((r) => ({
        resourceId: r.resourceId,
        resource: r.resource,
        source: r.source,
        principals: Object.values(GRANTS).filter((g) => g.includes(r.resourceId)).length,
      })),
    };
  }
  if (p.startsWith("/api/governance/resources/")) {
    const rid = decodeURIComponent(p.slice("/api/governance/resources/".length));
    const principals = PRINCIPALS.filter((x) => (GRANTS[x.id] || []).includes(rid)).map((x) => ({
      id: x.id,
      displayName: x.displayName,
      type: x.type,
      grant: {
        via: x.type === "User" ? "direct user grant" : "OneLake role",
        rowFilter: ROW_FILTER[x.id] || null,
      },
    }));
    return { principals };
  }
  if (p === "/api/governance/explain") {
    const principal = _params.get("principal");
    const resource = _params.get("resource");
    const pr = PRINCIPALS.find((x) => x.id === principal);
    return {
      steps: [
        { step: "Principal", detail: pr?.displayName || principal },
        {
          step: "Membership",
          detail:
            pr?.type === "User" ? "Direct assignment (no group)" : "Member of persona Entra group",
        },
        {
          step: "OneLake role",
          detail: `Role grants ReadData on ${resById[resource]?.resource || resource}`,
        },
        {
          step: "Row security",
          detail: ROW_FILTER[principal] || "No row filter — all rows visible",
        },
        { step: "Effective", detail: "Access confirmed via current grant graph." },
      ],
    };
  }
  if (p === "/api/governance/changes") {
    return { since: new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10), changes: CHANGES };
  }
  if (p === "/api/governance/tests") {
    return {
      note: "Expected access outcomes per persona — validate against native OneLake access testing.",
      tests: TESTS,
    };
  }
  return { items: [], error: "unknown governance route" };
}
