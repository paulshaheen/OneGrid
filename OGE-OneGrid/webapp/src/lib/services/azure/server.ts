// Server-only Azure integration. Everything in this module runs inside the SSR
// server function boundary, so @tanstack/react-start strips it (and the Managed
// Identity token calls, process.env access and Azure endpoints) from the browser
// bundle. The client reaches these only through the exported server functions.

import { createServerFn } from "@tanstack/react-start";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

import type {
  Asset,
  AssetType,
  CopilotAnswer,
  GateId,
  GateState,
  GeospatialLayer,
  OperatingStatus,
  OpsAlert,
  ThresholdRule,
  WeatherEvent,
} from "@/lib/domain/types";

// Data-plane audiences for Managed Identity tokens.
const GEOCATALOG_RESOURCE = "https://geocatalog.spatio.azure.com";
const COGNITIVE_RESOURCE = "https://cognitiveservices.azure.com";
const STORAGE_RESOURCE = "https://storage.azure.com";
const DEFAULT_GEOCATALOG_API_VERSION = "2026-04-15";

// Public Microsoft Planetary Computer (open catalog) — used only as a source of
// public sample imagery to pre-seed an empty tenant GeoCatalog. No auth needed to
// search; asset hrefs are public blob URLs.
const PUBLIC_PC_STAC = "https://planetarycomputer.microsoft.com/api/stac/v1";

function geoCatalogApiUrl(baseUrl: string, path: string): string {
  const url = new URL(path, `${baseUrl.replace(/\/$/, "")}/`);
  url.searchParams.set(
    "api-version",
    process.env["GEOCATALOG_API_VERSION"] || DEFAULT_GEOCATALOG_API_VERSION,
  );
  return url.toString();
}

/**
 * Acquire a Managed Identity access token for a resource. On Azure App Service
 * (and Container Apps) the platform injects IDENTITY_ENDPOINT / IDENTITY_HEADER;
 * we fall back to the IMDS endpoint for VMs. No SDK, no secrets — the identity is
 * the site's system-assigned managed identity, granted data-plane roles in
 * main.bicep.
 *
 * LOCAL DEV: when neither is present (running on a laptop, not Azure) we fall back
 * to the developer's Azure CLI session (`az account get-access-token`), so the
 * exact same code paths — Foundry chat, storage, GeoCatalog — light up locally
 * for anyone who has run `az login`, matching the deployed behaviour.
 */
async function getManagedIdentityToken(resource: string): Promise<string | null> {
  const endpoint = process.env["IDENTITY_ENDPOINT"];
  const header = process.env["IDENTITY_HEADER"];
  try {
    if (endpoint && header) {
      const url = `${endpoint}?resource=${encodeURIComponent(resource)}&api-version=2019-08-01`;
      const res = await fetch(url, { headers: { "X-IDENTITY-HEADER": header } });
      if (!res.ok) return null;
      const json = (await res.json()) as { access_token?: string };
      return json.access_token ?? null;
    }
    // Not on App Service / Container Apps → try the local Azure CLI session first
    // (fast path for developers), then IMDS for VM-hosted managed identities.
    const cli = await getAzureCliToken(resource);
    if (cli) return cli;
    const imds = `http://169.254.169.254/metadata/identity/oauth2/token?resource=${encodeURIComponent(resource)}&api-version=2018-02-01`;
    const res = await fetch(imds, { headers: { Metadata: "true" } });
    if (!res.ok) return null;
    const json = (await res.json()) as { access_token?: string };
    return json.access_token ?? null;
  } catch {
    return null;
  }
}

// Cached Azure CLI tokens per audience (az is slow to spawn; tokens last ~1h).
const cliTokenCache = new Map<string, { token: string; exp: number }>();

/**
 * Local-dev token fallback: shell out to the Azure CLI for an access token for
 * `resource`. Returns null when az is not installed / not logged in (so the app
 * degrades exactly as before on a bare server). Never used on Azure App Service,
 * where IDENTITY_ENDPOINT short-circuits above.
 */
async function getAzureCliToken(resource: string): Promise<string | null> {
  const cached = cliTokenCache.get(resource);
  if (cached && cached.exp - Date.now() > 60_000) return cached.token;
  // `resource` is always a fixed audience constant (see *_RESOURCE above); guard
  // anyway so nothing but a bare https audience is ever interpolated into the shell.
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(resource)) return null;
  try {
    // The default shell resolves `az` → `az.cmd` on Windows via PATHEXT.
    const { stdout } = await execAsync(
      `az account get-access-token --resource ${resource} -o json`,
      { timeout: 15_000, windowsHide: true, maxBuffer: 1024 * 1024 },
    );
    const json = JSON.parse(stdout) as { accessToken?: string; expires_on?: number; expiresOn?: string };
    if (!json.accessToken) return null;
    const exp = json.expires_on
      ? json.expires_on * 1000
      : json.expiresOn
        ? Date.parse(json.expiresOn) || Date.now() + 3_000_000
        : Date.now() + 3_000_000;
    cliTokenCache.set(resource, { token: json.accessToken, exp });
    return json.accessToken;
  } catch {
    return null;
  }
}

/**
 * Browse the tenant's GeoCatalog STAC collections and present them as operator-
 * facing geospatial layers. Returns [] when the catalog is empty or unreachable
 * — never synthetic layers.
 */
export const listStacLayers = createServerFn({ method: "GET" }).handler(
  async (): Promise<GeospatialLayer[]> => {
    const geoCatalogUrl = process.env["GEOCATALOG_URI"];
    if (!geoCatalogUrl) return [];

    const token = await getManagedIdentityToken(GEOCATALOG_RESOURCE);
    if (!token) return [];

    try {
      const res = await fetch(geoCatalogApiUrl(geoCatalogUrl, "stac/collections"), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      const body = (await res.json()) as {
        collections?: Array<{ id: string; title?: string; description?: string }>;
      };
      return Promise.all(
        (body.collections ?? []).map(async (c) => {
          const itemsRes = await fetch(
            geoCatalogApiUrl(geoCatalogUrl, `stac/collections/${c.id}/items`),
            { headers: { Authorization: `Bearer ${token}` } },
          );
          const data = itemsRes.ok
            ? ((await itemsRes.json()) as {
                type: "FeatureCollection";
                features?: Array<Record<string, unknown>>;
              })
            : { type: "FeatureCollection" as const, features: [] };
          const features = data.features ?? [];
          return {
            id: c.id,
            name: c.title || c.id,
            description: c.description || "STAC collection",
            updatedLabel: `${features.length} item${features.length === 1 ? "" : "s"} from GeoCatalog`,
            defaultOn: features.length > 0,
            itemCount: features.length,
            data: { type: "FeatureCollection" as const, features },
          };
        }),
      );
    } catch {
      return [];
    }
  },
);

/**
 * Grounded operations assistant backed by Azure OpenAI (Foundry). When the
 * endpoint is not configured it returns an honest "not configured" answer rather
 * than a canned demo response.
 */
// Compact, model-friendly summary of the console's live data (active weather events +
// asset exposure) so the assistant answers from real tenant data in a single call —
// no slow, rate-limit-prone multi-tool agent loop.
function buildOpsContext(
  events: unknown,
  exposure: unknown,
  outages?: unknown,
  workOrders?: unknown,
  sites?: unknown,
): string {
  const evs = Array.isArray(events) ? (events as Array<Record<string, unknown>>) : [];
  const exp = Array.isArray(exposure) ? (exposure as Array<Record<string, unknown>>) : [];
  // Site-code legend so the model never guesses site names (e.g. PF = Port Fourchon,
  // not "Pegasus Field"). Asset ids are "<CODE>_U<n>_<Equipment>" where CODE maps to
  // a site (SITE_<CODE> in dim_site).
  const siteRows = Array.isArray(sites) ? (sites as Array<Record<string, unknown>>) : [];
  const codeToName = new Map<string, string>();
  for (const s of siteRows) {
    const id = String(s["id"] ?? "");
    const name = String(s["name"] ?? "");
    const code = id.replace(/^SITE_/, "");
    if (code && name) codeToName.set(code, name);
  }
  const active = evs.filter((e) => e["status"] === "active");
  const evLines = (active.length ? active : evs)
    .slice(0, 8)
    .map(
      (e) =>
        `- ${e["name"]} — ${e["hazardKind"] ?? e["kind"]}, cat ${e["currentCategory"] ?? "?"}, ${e["currentWindMph"] ?? "?"} mph sustained${e["gustMph"] ? ` / ${e["gustMph"]} gust` : ""}, region ${e["region"] ?? "?"}, status ${e["status"]}`,
    );
  const byLevel: Record<string, number> = {};
  for (const e of exp) {
    const lvl = String(e["level"] ?? "unknown");
    byLevel[lvl] = (byLevel[lvl] ?? 0) + 1;
  }
  const expLines = exp
    .filter((e) => e["level"] && e["level"] !== "normal" && e["level"] !== "monitor")
    .sort((a, b) => Number(b["score"] ?? 0) - Number(a["score"] ?? 0))
    .slice(0, 12)
    .map(
      (e) =>
        `- ${e["assetId"]} (${e["level"]}, score ${e["score"]}, ${e["forecastWindMph"] ?? "?"} mph, ${e["hoursToImpact"] ?? "?"}h to impact${e["insideCone"] ? ", INSIDE cone" : ""}, event ${e["eventId"]})`,
    );
  // Downtime / outage history (recent trips, derates, restorations).
  const outs = Array.isArray(outages) ? (outages as Array<Record<string, unknown>>) : [];
  const outLines = outs
    .slice(0, 12)
    .map(
      (o) =>
        `- ${o["asset_id"] ?? o["assetId"] ?? o["unit"] ?? "?"}: ${o["reason"] ?? o["cause"] ?? o["event_type"] ?? o["status"] ?? "outage"}${o["start_date"] || o["start"] ? `, from ${o["start_date"] ?? o["start"]}` : ""}${o["end_date"] || o["end"] ? ` to ${o["end_date"] ?? o["end"]}` : ""}${o["status"] ? ` (${o["status"]})` : ""}`,
    );
  // Open maintenance work orders (near-term maintenance backlog).
  const wos = Array.isArray(workOrders) ? (workOrders as Array<Record<string, unknown>>) : [];
  const woLines = wos
    .slice(0, 12)
    .map(
      (w) =>
        `- ${w["wr_id"] ?? "WR"}: ${w["entity_descr"] ?? "?"} — ${w["problem_descr"] ?? "?"}${w["location"] ? ` @ ${w["location"]}` : ""}, P${w["priority"] ?? "?"}, ${w["wr_status"] ?? "?"}`,
    );
  const today = new Date().toLocaleDateString("en-CA");
  const codeLegend =
    codeToName.size > 0
      ? `SITE CODES (asset-id prefix = site — use the exact names, do not invent): ${[...codeToName.entries()]
          .map(([c, n]) => `${c}=${n}`)
          .join(", ")}`
      : "";
  return [
    `DATA CONTEXT — live tenant data (as of ${today}):`,
    ...(codeLegend ? ["", codeLegend] : []),
    "",
    `ACTIVE WEATHER EVENTS (${active.length} active of ${evs.length} total):`,
    ...(evLines.length ? evLines : ["- none"]),
    "",
    `ASSET EXPOSURE (${exp.length} assets scored) — counts by level: ${
      Object.entries(byLevel)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ") || "none"
    }`,
    "Most exposed assets:",
    ...(expLines.length ? expLines : ["- none above monitor"]),
    "",
    `RECENT OUTAGES / DOWNTIME (${outs.length} record${outs.length === 1 ? "" : "s"}):`,
    ...(outLines.length ? outLines : ["- none in the current data"]),
    "",
    `OPEN WORK ORDERS (${wos.length} shown):`,
    ...(woLines.length ? woLines : ["- none"]),
  ].join("\n");
}

// GitHub OAuth device-flow client. Defaults to the public VS Code / Copilot app
// (device-flow enabled, Copilot-capable); deployers can register their own OAuth
// app and set GITHUB_CLIENT_ID to override.
const GITHUB_CLIENT_ID = process.env["GITHUB_CLIENT_ID"] || "Iv1.b507a08c87ecfe98";

const OPS_SYSTEM =
  "You are OneGrid's operations assistant for weather and asset risk in energy infrastructure. Answer concisely and specifically using ONLY the DATA CONTEXT provided below. The tenant's live data is already included — NEVER ask the user to supply data that is present in the context. If a specific detail is missing, state what additional query would be needed.\n\n" +
  "FORMAT the answer as clean GitHub-Flavoured Markdown so it renders beautifully:\n" +
  "- Use `##` / `###` headings for sections (never a bare bold line as a heading).\n" +
  "- Use `-` bullet lists for enumerations, and `**bold**` for key values/labels.\n" +
  "- When presenting per-asset or comparative data (assets, scores, wind, lead-time, etc.), use a Markdown TABLE with a header row and `|---|` separators.\n" +
  "- Keep paragraphs short. Do not use raw HTML.\n\n" +
  "At the very END of your response, add a section titled exactly `### How I reasoned` with 2-4 short bullet points describing which data you used and how you cross-referenced it to reach the answer.";

// Data sources folded into the grounding context — surfaced as answer citations.
const OPS_CITATIONS: CopilotCitation[] = [
  { label: "weather events", kind: "event" },
  { label: "asset exposure", kind: "risk" },
  { label: "outages", kind: "dataset" },
  { label: "work orders", kind: "dataset" },
];

// Persona lens: steer tone/focus without changing the grounding. Mirrors the
// report-app chat personas (executive / control room / maintenance).
function personaDirective(persona?: string): string {
  switch (String(persona || "").toLowerCase()) {
    case "executive":
      return "PERSONA: Executive. Lead with the bottom line and business/operational impact. Keep it brief (2-4 sentences or a few bullets), quantify risk, and recommend the single most important action. Avoid deep technical tag-level detail.";
    case "controlroom":
    case "control room":
    case "analyst":
      return "PERSONA: Control-room analyst. Be precise and technical — cite specific assets, tags, scores, wind/lead-time and event ids. Prioritise what to watch right now and the next few hours.";
    case "maintenance":
      return "PERSONA: Maintenance planner. Focus on work orders, equipment condition, and concrete next maintenance actions with priority and location. Tie recommendations to specific assets/units.";
    default:
      return "";
  }
}

// Ground the assistant in the tenant's live ops data with a single fetch. Shared
// by the Azure and GitHub-Copilot answer paths. Also returns an evidence summary
// (data sources + counts) that powers the chat's "Thought process" panel.
async function groundOps(): Promise<{
  dataContext: string;
  highlightAssetIds: string[];
  evidence: { label: string; detail: string }[];
}> {
  let dataContext = "";
  let highlightAssetIds: string[] = [];
  const evidence: { label: string; detail: string }[] = [];
  try {
    const apiBase = reportApiBase();
    const getJson = (path: string) =>
      fetch(`${apiBase}${path}`, { headers: { Accept: "application/json" } })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []);
    const [events, exposure, outagesRaw, workOrders, sites] = await Promise.all([
      getJson("/api/weather/events"),
      getJson("/api/exposure"),
      getJson("/api/outages"),
      getJson("/api/work-orders?limit=12"),
      getJson("/api/sites-geo"),
    ]);
    // /api/outages returns { rows, summary }; other feeds are plain arrays.
    const outages =
      Array.isArray(outagesRaw)
        ? outagesRaw
        : ((outagesRaw as { rows?: unknown[] } | null)?.rows ?? []);
    dataContext = buildOpsContext(events, exposure, outages, workOrders, sites);
    const evs = Array.isArray(events) ? (events as Array<Record<string, unknown>>) : [];
    const exp = Array.isArray(exposure) ? (exposure as Array<Record<string, unknown>>) : [];
    const wos = Array.isArray(workOrders) ? (workOrders as unknown[]) : [];
    highlightAssetIds = exp
      .filter((e) => e["level"] && e["level"] !== "normal" && e["level"] !== "monitor")
      .sort((a, b) => Number(b["score"] ?? 0) - Number(a["score"] ?? 0))
      .slice(0, 12)
      .map((e) => String(e["assetId"] ?? ""))
      .filter(Boolean);
    // Evidence summary — the datasets (and counts) the answer was grounded on.
    const activeEv = evs.filter((e) => e["status"] === "active").length;
    const byLevel: Record<string, number> = {};
    for (const e of exp) {
      const l = String(e["level"] ?? "unknown");
      byLevel[l] = (byLevel[l] ?? 0) + 1;
    }
    const lvlStr = ["critical", "high", "elevated", "monitor"]
      .filter((l) => byLevel[l])
      .map((l) => `${byLevel[l]} ${l}`)
      .join(", ");
    const outs = Array.isArray(outages) ? (outages as Array<Record<string, unknown>>) : [];
    const activeOut = outs.filter(
      (o) => o["outage_status"] === "Active" || o["status"] === "Active" || o["active"] === true,
    ).length;
    evidence.push(
      { label: "Weather events", detail: `${activeEv} active of ${evs.length}` },
      { label: "Asset exposure", detail: `${exp.length} scored${lvlStr ? ` — ${lvlStr}` : ""}` },
      { label: "Outages", detail: `${outs.length}${outs.length ? ` (${activeOut} active)` : ""}` },
      { label: "Work orders", detail: `${wos.length} open` },
    );
  } catch {
    /* grounding is best-effort */
  }
  return { dataContext, highlightAssetIds, evidence };
}

// ── Ontology / semantic-model grounding ─────────────────────────────────────
const ONTOLOGY_SYSTEM =
  "You are OneGrid's data-model assistant. Answer questions about the semantic model / knowledge graph — its entities (tables), columns, keys, grain and relationships — using ONLY the ONTOLOGY CONTEXT provided below. Be specific: name the exact entities, keys and relationships involved, and describe how tables join. Do NOT reference live operational metrics (weather, outages, work orders) unless the user explicitly asks. Format the answer in clean Markdown: short paragraphs, **bold** key names, and bullet lists. At the very END, add a section titled exactly `### How I reasoned` with 2-4 short bullets naming which entities and relationships you referenced.";

const ONTOLOGY_CITATIONS: CopilotCitation[] = [
  { label: "semantic model", kind: "dataset" },
  { label: "knowledge graph", kind: "dataset" },
];

// Compact text view of the knowledge graph: entities (table, grain, columns) and
// the typed relationships between them — grounds schema/ontology questions.
function buildOntologyContext(onto: Record<string, unknown>): string {
  const nodes = Array.isArray(onto["nodes"]) ? (onto["nodes"] as Array<Record<string, unknown>>) : [];
  const edges = Array.isArray(onto["edges"]) ? (onto["edges"] as Array<Record<string, unknown>>) : [];
  const cats = (onto["categories"] as Record<string, { label?: string }>) || {};
  const byId: Record<string, Record<string, unknown>> = {};
  for (const n of nodes) byId[String(n["id"])] = n;
  const nodeLines = nodes.map((n) => {
    const cols = Array.isArray(n["columns"])
      ? (n["columns"] as Array<Record<string, unknown>>)
          .map((c) => `${c["name"]}${c["key"] === "pk" ? " (PK)" : c["key"] === "fk" ? " (FK)" : ""}`)
          .join(", ")
      : "";
    const cat = cats[String(n["category"])]?.label ?? n["category"] ?? "";
    return `- ${n["label"]} [table ${n["table"] ?? "?"}${n["source"] ? `, ${n["source"]}` : ""}] — ${cat}; grain: ${n["grain"] ?? "?"}; columns: ${cols || "—"}`;
  });
  const edgeLines = edges.map(
    (e) =>
      `- ${byId[String(e["from"])]?.["label"] ?? e["from"]} ${e["label"] ?? "relates to"} ${byId[String(e["to"])]?.["label"] ?? e["to"]} (${e["kind"] ?? "relationship"})`,
  );
  return [
    `ONTOLOGY CONTEXT — OneGrid semantic model${onto["source"] ? ` (source: ${onto["source"]})` : ""}: ${nodes.length} entities, ${edges.length} relationships.`,
    "",
    "ENTITIES:",
    ...(nodeLines.length ? nodeLines : ["- none"]),
    "",
    "RELATIONSHIPS:",
    ...(edgeLines.length ? edgeLines : ["- none"]),
  ].join("\n");
}

// Ground a schema/ontology question in the knowledge graph (entities + relationships).
async function groundOntology(): Promise<{
  dataContext: string;
  evidence: { label: string; detail: string }[];
}> {
  let dataContext = "";
  const evidence: { label: string; detail: string }[] = [];
  try {
    const onto = await fetch(`${reportApiBase()}/api/ontology`, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (onto && Array.isArray(onto["nodes"])) {
      dataContext = buildOntologyContext(onto);
      const nodes = onto["nodes"] as unknown[];
      const edges = Array.isArray(onto["edges"]) ? (onto["edges"] as unknown[]) : [];
      const nCats = onto["categories"] ? Object.keys(onto["categories"] as object).length : 0;
      evidence.push(
        { label: "Entities", detail: `${nodes.length}${nCats ? ` across ${nCats} categories` : ""}` },
        { label: "Relationships", detail: `${edges.length}` },
        { label: "Source", detail: String(onto["source"] ?? "semantic model") },
      );
    }
  } catch {
    /* grounding is best-effort */
  }
  return { dataContext, evidence };
}

// Schema/ontology intent: questions about the data model, entities, keys or how
// tables relate. These get knowledge-graph grounding instead of live ops data.
function isOntologyQuestion(q: string): boolean {
  return /\b(ontolog\w*|knowledge graph|semantic model|data model|schema|entit(?:y|ies)|relationship\w*|foreign key|primary key|\bpk\b|\bfk\b|grain|dimension table|fact table|star schema|\berd\b|data dictionary|which tables?|what tables?|how (?:are|do|does)\b[^?]*\b(?:connect|relate|join|link)\w*)\b/i.test(
    String(q || ""),
  );
}

type Grounding = {
  dataContext: string;
  evidence: { label: string; detail: string }[];
  highlightAssetIds: string[];
  system: string;
  citations: CopilotCitation[];
};

// Route a question to the right grounding: schema/ontology → knowledge graph;
// everything else → live ops data. Stops ontology questions from "reviewing"
// weather/outage/work feeds that are irrelevant to the model's structure.
async function selectGrounding(question: string): Promise<Grounding> {
  if (isOntologyQuestion(question)) {
    const g = await groundOntology();
    return {
      dataContext: g.dataContext,
      evidence: g.evidence,
      highlightAssetIds: [],
      system: ONTOLOGY_SYSTEM,
      citations: g.dataContext ? ONTOLOGY_CITATIONS : [],
    };
  }
  const g = await groundOps();
  return {
    dataContext: g.dataContext,
    evidence: g.evidence,
    highlightAssetIds: g.highlightAssetIds,
    system: OPS_SYSTEM,
    citations: g.dataContext ? OPS_CITATIONS : [],
  };
}

// Answer via the user's own GitHub Copilot license (GitHub token → Copilot API).
async function answerViaGithubCopilot(
  question: string,
  copilotToken: string,
  model: string,
  dataContext: string,
  highlightAssetIds: string[],
  persona?: string,
  evidence?: { label: string; detail: string }[],
  system: string = OPS_SYSTEM,
  citations: CopilotCitation[] = OPS_CITATIONS,
): Promise<CopilotAnswer> {
  const pd = personaDirective(persona);
  const messages = [
    { role: "system", content: system },
    ...(pd ? [{ role: "system", content: pd }] : []),
    ...(dataContext ? [{ role: "system", content: dataContext }] : []),
    { role: "user", content: question },
  ];
  const FALLBACK_MODEL = "gpt-4o";
  const chat = (bearer: string, modelId: string) =>
    fetch("https://api.githubcopilot.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
        // A device-flow (GitHub App) token exchanged for a Copilot token only
        // accepts a KNOWN integration id — a custom one returns 400 "unknown
        // Copilot-Integration-Id". `vscode-chat` is accepted by both exchanged
        // Copilot tokens and direct editor tokens.
        "Copilot-Integration-Id": "vscode-chat",
        "Editor-Version": "vscode/1.99.0",
        "Editor-Plugin-Version": "copilot-chat/0.26.7",
        "User-Agent": "GitHubCopilotChat/0.26.7",
      },
      body: JSON.stringify({ model: modelId, messages, max_completion_tokens: 2048 }),
    });
  // Some models the /models list advertises aren't actually callable for a given
  // token/integrator (they 400 with model_not_supported / "not available"). When
  // that happens, transparently retry once with a near-universal fallback model.
  const isModelError = async (res: Response): Promise<boolean> => {
    if (res.status !== 400) return false;
    try {
      const b = (await res.clone().json()) as { error?: { code?: string; message?: string } };
      const c = (b?.error?.code || "").toLowerCase();
      const m = (b?.error?.message || "").toLowerCase();
      return (
        c.includes("model_not_supported") ||
        c.includes("unsupported_api_for_model") ||
        m.includes("not supported") ||
        m.includes("not available") ||
        m.includes("not accessible")
      );
    } catch {
      return false;
    }
  };
  try {
    let activeModel = model || FALLBACK_MODEL;
    let usedFallback = false;
    let res = await chat(copilotToken.trim(), activeModel);
    // A raw GitHub OAuth token (e.g. from the device flow) may need to be
    // exchanged for a short-lived Copilot token before the Copilot API accepts it.
    let bearer = copilotToken.trim();
    if (res.status === 401 || res.status === 403) {
      try {
        const ex = await fetch("https://api.github.com/copilot_internal/v2/token", {
          headers: {
            Authorization: `token ${copilotToken.trim()}`,
            Accept: "application/json",
            "User-Agent": "OneGrid/1.0",
          },
        });
        if (ex.ok) {
          const j = (await ex.json()) as { token?: string };
          if (j.token) {
            bearer = j.token;
            res = await chat(bearer, activeModel);
          }
        }
      } catch {
        /* fall through to the error below */
      }
    }
    // Selected model unavailable for this token → retry once with the fallback.
    if (activeModel !== FALLBACK_MODEL && (await isModelError(res))) {
      usedFallback = true;
      activeModel = FALLBACK_MODEL;
      res = await chat(bearer, FALLBACK_MODEL);
    }
    if (!res.ok) {
      let apiMsg = "";
      try {
        const errBody = (await res.clone().json()) as { error?: { message?: string } };
        apiMsg = errBody?.error?.message ? ` — ${errBody.error.message}` : "";
      } catch {
        /* non-JSON error body */
      }
      const detail =
        res.status === 401 || res.status === 403
          ? " — token rejected or the account has no Copilot access."
          : apiMsg;
      return {
        text: `The Copilot request failed (${res.status})${detail}`,
        citations: [],
        highlightAssetIds,
      };
    }
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = body.choices?.[0]?.message?.content?.trim();
    const note =
      usedFallback && model
        ? `_(“${model}” isn’t available for your Copilot license — answered with ${FALLBACK_MODEL}.)_\n\n`
        : "";
    return {
      text: text ? note + text : "No answer was returned.",
      citations: dataContext ? citations : [],
      highlightAssetIds,
      evidence,
      context: dataContext || undefined,
    };
  } catch {
    return { text: "The Copilot service is currently unavailable.", citations: [], highlightAssetIds };
  }
}

// ── GitHub OAuth device flow (server-side to avoid browser CORS) ─────────────
export const startGithubDeviceLogin = createServerFn({ method: "POST" }).handler(
  async (): Promise<{
    ok: boolean;
    userCode?: string;
    verificationUri?: string;
    deviceCode?: string;
    interval?: number;
    expiresIn?: number;
    error?: string;
  }> => {
    try {
      const res = await fetch("https://github.com/login/device/code", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: "read:user" }),
      });
      const j = (await res.json()) as Record<string, unknown>;
      if (!res.ok || j["error"]) {
        return { ok: false, error: String(j["error_description"] || j["error"] || res.status) };
      }
      return {
        ok: true,
        userCode: String(j["user_code"] ?? ""),
        verificationUri: String(j["verification_uri"] ?? "https://github.com/login/device"),
        deviceCode: String(j["device_code"] ?? ""),
        interval: Number(j["interval"] ?? 5),
        expiresIn: Number(j["expires_in"] ?? 900),
      };
    } catch {
      return { ok: false, error: "Could not reach GitHub." };
    }
  },
);

export const pollGithubDeviceLogin = createServerFn({ method: "POST" })
  .validator((data: { deviceCode: string }) => data)
  .handler(
    async ({
      data,
    }): Promise<{ status: "ok" | "pending" | "error"; token?: string; error?: string }> => {
      try {
        const res = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: GITHUB_CLIENT_ID,
            device_code: data.deviceCode,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
        });
        const j = (await res.json()) as Record<string, unknown>;
        if (j["access_token"]) return { status: "ok", token: String(j["access_token"]) };
        if (j["error"] === "authorization_pending" || j["error"] === "slow_down")
          return { status: "pending" };
        return {
          status: "error",
          error: String(j["error_description"] || j["error"] || "Device login failed."),
        };
      } catch {
        return { status: "error", error: "Could not reach GitHub." };
      }
    },
  );

export const askFoundryCopilot = createServerFn({ method: "POST" })
  .validator(
    (data: { question: string; copilotToken?: string; model?: string; persona?: string }) => data,
  )
  .handler(async ({ data }): Promise<CopilotAnswer> => {
    // Route to the user's own GitHub Copilot license when connected.
    if (data.copilotToken && data.copilotToken.trim()) {
      const g = await selectGrounding(data.question);
      return answerViaGithubCopilot(
        data.question,
        data.copilotToken,
        data.model || "gpt-4o",
        g.dataContext,
        g.highlightAssetIds,
        data.persona,
        g.evidence,
        g.system,
        g.citations,
      );
    }
    const endpoint = process.env["FOUNDRY_ENDPOINT"] || process.env["AZURE_AI_ENDPOINT"];
    // The UI can pick a specific Foundry deployment; fall back to the configured default.
    const deployment =
      (data.model && data.model.trim()) ||
      process.env["FOUNDRY_DEPLOYMENT"] ||
      process.env["AI_DEFAULT_MODEL"];
    if (!endpoint || !deployment) {
      return {
        text: "The AI assistant is not configured for this deployment. Set FOUNDRY_ENDPOINT and FOUNDRY_DEPLOYMENT (or AZURE_AI_ENDPOINT and AI_DEFAULT_MODEL) to enable grounded answers from your Azure OpenAI (Foundry) resource.",
        citations: [],
        highlightAssetIds: [],
      };
    }

    const token = await getManagedIdentityToken(COGNITIVE_RESOURCE);
    if (!token) {
      return {
        text: "Could not acquire a managed-identity token for the AI resource. Confirm the App Service identity has the Cognitive Services OpenAI User role.",
        citations: [],
        highlightAssetIds: [],
      };
    }

    // Ground the assistant with a single fetch (fast, and avoids a slow,
    // rate-limit-prone multi-tool agent loop). Schema/ontology questions ground on
    // the knowledge graph; ops questions ground on live weather/exposure/outage/work.
    const { dataContext, highlightAssetIds, evidence, system: sysPrompt, citations } =
      await selectGrounding(data.question);

    const isReasoning = /gpt-5|^o[0-9]/i.test(String(deployment));
    const reasoningEffort = process.env["AI_REASONING_EFFORT"] || "minimal";
    const url = `${endpoint.replace(/\/$/, "")}/openai/deployments/${deployment}/chat/completions?api-version=2025-01-01-preview`;
    // gpt-5 / o-series reasoning models spend `max_completion_tokens` on hidden
    // reasoning FIRST and the visible answer second — a tight cap can leave zero
    // tokens for the answer (finish_reason "length", empty content), which the UI
    // renders as "No answer was returned". Start with a generous budget and, if the
    // answer still comes back empty, retry once with much more room so it can't starve.
    let maxTokens = 8000;
    try {
      let content = "";
      let finish = "";
      for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messages: [
            { role: "system", content: sysPrompt },
            ...(personaDirective(data.persona)
              ? [{ role: "system" as const, content: personaDirective(data.persona) }]
              : []),
            ...(dataContext ? [{ role: "system" as const, content: dataContext }] : []),
            { role: "user", content: data.question },
          ],
          // gpt-5 family are reasoning models: they only accept the default temperature
          // and use `max_completion_tokens` (not `max_tokens`). Sending a custom
          // `temperature` returns 400 "temperature does not support <x>".
          max_completion_tokens: maxTokens,
          ...(isReasoning ? { reasoning_effort: reasoningEffort } : {}),
        }),
      });
      if (!res.ok) {
        return {
          text: `The assistant request failed (${res.status}).`,
          citations: [],
          highlightAssetIds: [],
        };
      }
      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      };
      const choice = body.choices?.[0];
      content = choice?.message?.content?.trim() || "";
      finish = choice?.finish_reason || "";
      // Got an answer, or it stopped for a reason other than exhausting the budget.
      if (content || finish !== "length") break;
      // Reasoning consumed the whole budget — give it much more room and retry once.
      maxTokens = 16000;
      }
      return {
        text:
          content ||
          "I couldn't fit a complete answer in the available space — try asking about one part at a time, or rephrase more specifically.",
        citations,
        highlightAssetIds,
        evidence,
        context: dataContext || undefined,
      };
    } catch {
      return {
        text: "The assistant is currently unavailable.",
        citations: [],
        highlightAssetIds: [],
      };
    }
  });

// ---------------------------------------------------------------------------
// Data onboarding: upload to storage + pre-seed the GeoCatalog.
// These power the in-app "add data" flow so a fresh deployment is self-contained
// (no portal or CLI needed). Every call uses the App Service managed identity and
// the data-plane roles granted in main.bicep — no keys, no SAS in the browser.
// ---------------------------------------------------------------------------

export type DataPlaneStatus = {
  /** GeoCatalog data-plane URL is wired (real tenant deployment). */
  geoCatalogConfigured: boolean;
  /** Sample-data storage container is wired for uploads. */
  uploadConfigured: boolean;
  /** An Azure ML Aurora scoring endpoint was supplied by the deployment template. */
  auroraEndpointConfigured: boolean;
  /** The deployment template created an Aurora model deployment on the endpoint. */
  auroraModelDeployed: boolean;
  /** The server-side Aurora response-to-WeatherEvent adapter is implemented. */
  auroraAdapterConnected: boolean;
  // ---- Live reachability probes -------------------------------------------
  // Unlike the "*Configured" flags (which only report whether an env var is set
  // at deploy time), these are runtime probes: the app's managed identity calls
  // each data plane right now. They tell a *deleted / unreachable* resource
  // ("unreachable") apart from one that answers but where the identity lost its
  // data-plane role ("unauthorized") — the honest liveness the presence-only
  // flags cannot give. `undefined` = probe skipped because the plane is not
  // configured (nothing to reach).
  /** GeoCatalog STAC API reachability under the app identity. */
  geoCatalogLive?: ProbeResult;
  /** Azure OpenAI (Foundry) endpoint reachability under the app identity. */
  foundryLive?: ProbeResult;
  /** Upload storage container reachability under the app identity. */
  storageLive?: ProbeResult;
  /** Configured Entra tenant's OpenID metadata reachability (public, no token). */
  entraLive?: ProbeResult;
};

/**
 * Outcome of a live reachability probe:
 * - "ok"           the resource answered 2xx under the app identity
 * - "unauthorized" it answered 401/403 — reachable, but the identity lost its role
 * - "unreachable"  network error (DNS gone after a delete, refused, timeout) or
 *                  any other non-2xx — treat as not serving
 */
export type ProbeResult = "ok" | "unauthorized" | "unreachable";

/**
 * Issue a lightweight request and classify the outcome. Aborts the socket on
 * timeout (via AbortController) so slow planes can't pile up connections across
 * repeated status polls, and always clears its timer. Best-effort: never throws.
 */
async function probeReach(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<ProbeResult> {
  const { timeoutMs = 5_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: controller.signal });
    if (res.ok) return "ok";
    if (res.status === 401 || res.status === 403) return "unauthorized";
    return "unreachable";
  } catch {
    return "unreachable";
  } finally {
    clearTimeout(timer);
  }
}


/** Report which onboarding capabilities the current deployment has wired. */
export const getDataPlaneStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<DataPlaneStatus> => {
    const geoCatalogUrl = process.env["GEOCATALOG_URI"];
    const foundryEndpoint = process.env["FOUNDRY_ENDPOINT"];
    const uploadContainerUrl = process.env["SAMPLE_CONTAINER_URL"];
    const entraTenantId = process.env["ENTRA_TENANT_ID"];

    // Run every live probe in parallel and never let one failure sink the others.
    const [
      auroraAdapterConnected,
      geoCatalogLive,
      foundryLive,
      storageLive,
      entraLive,
    ] = await Promise.all([
      auroraOutputFresh(),
      probeGeoCatalogLive(geoCatalogUrl),
      probeFoundryLive(foundryEndpoint),
      probeStorageContainerLive(uploadContainerUrl),
      probeEntraLive(entraTenantId),
    ]);

    return {
      geoCatalogConfigured: Boolean(geoCatalogUrl),
      uploadConfigured: Boolean(uploadContainerUrl),
      auroraEndpointConfigured: Boolean(process.env["AURORA_ENDPOINT"]),
      auroraModelDeployed: process.env["AURORA_MODEL_DEPLOYED"] === "true",
      auroraAdapterConnected,
      geoCatalogLive,
      foundryLive,
      storageLive,
      entraLive,
    };
  },
);

/**
 * GeoCatalog liveness: list STAC collections under the app identity. A 2xx means
 * the GeoCatalog exists AND the managed identity still has the data-plane role.
 * Returns undefined when GeoCatalog is not configured (nothing to probe).
 */
async function probeGeoCatalogLive(geoCatalogUrl?: string): Promise<ProbeResult | undefined> {
  if (!geoCatalogUrl) return undefined;
  const token = await getManagedIdentityToken(GEOCATALOG_RESOURCE);
  if (!token) return "unauthorized";
  return probeReach(geoCatalogApiUrl(geoCatalogUrl, "stac/collections"), {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/**
 * Azure OpenAI (Foundry) liveness: the data-plane "list models" operation
 * (GET /openai/models) is the cheapest authenticated call that proves the
 * endpoint is serving and the identity has the Cognitive Services OpenAI User
 * role — no tokens are spent (unlike a chat completion). Returns undefined when
 * Foundry is not configured.
 */
async function probeFoundryLive(endpoint?: string): Promise<ProbeResult | undefined> {
  if (!endpoint) return undefined;
  const token = await getManagedIdentityToken(COGNITIVE_RESOURCE);
  if (!token) return "unauthorized";
  const url = `${endpoint.replace(/\/$/, "")}/openai/models?api-version=2024-10-21`;
  return probeReach(url, { headers: { Authorization: `Bearer ${token}` } });
}

/**
 * Storage liveness: Get Container Properties (restype=container) on the upload
 * container. Needs only Storage Blob Data Reader (the app identity already has
 * it). A HEAD keeps it body-less. Returns undefined when storage is not wired.
 */
async function probeStorageContainerLive(containerUrl?: string): Promise<ProbeResult | undefined> {
  if (!containerUrl) return undefined;
  const token = await getManagedIdentityToken(STORAGE_RESOURCE);
  if (!token) return "unauthorized";
  const url = `${containerUrl.replace(/\/$/, "")}?restype=container`;
  return probeReach(url, {
    method: "HEAD",
    headers: { Authorization: `Bearer ${token}`, "x-ms-version": "2021-08-06" },
  });
}

/**
 * Entra liveness: fetch the configured tenant's OpenID Connect discovery
 * document (public, no token). A 2xx proves the tenant exists and its identity
 * platform is reachable — enough to detect a wrong/deleted tenant. Note: this
 * does NOT validate the specific app registration (that would need Microsoft
 * Graph Application.Read); it is a tenant-reachability signal. Returns undefined
 * when no tenant id is configured.
 */
async function probeEntraLive(tenantId?: string): Promise<ProbeResult | undefined> {
  if (!tenantId) return undefined;
  const authority = process.env["ENTRA_AUTHORITY_HOST"] || "https://login.microsoftonline.com";
  const url = `${authority.replace(/\/$/, "")}/${encodeURIComponent(tenantId)}/v2.0/.well-known/openid-configuration`;
  return probeReach(url);
}


const WEATHER_EVENTS_BLOB_NAME = "weather-events.json";

/**
 * True when the Aurora post-processing job has published a recent weather-events
 * blob to the model-outputs container. This is the honest runtime signal that the
 * grid-to-WeatherEvent adapter is not just implemented but actually producing
 * output — a stale or missing file reports the adapter as not connected.
 */
async function auroraOutputFresh(): Promise<boolean> {
  const containerUrl = process.env["UPLOAD_CONTAINER_URL"];
  if (!containerUrl) return false;
  const token = await getManagedIdentityToken(STORAGE_RESOURCE);
  if (!token) return false;
  const maxAgeHours = Number(process.env["AURORA_OUTPUT_MAX_AGE_HOURS"] ?? "24");
  try {
    const res = await fetch(`${containerUrl.replace(/\/$/, "")}/${WEATHER_EVENTS_BLOB_NAME}`, {
      method: "HEAD",
      headers: { Authorization: `Bearer ${token}`, "x-ms-version": "2021-08-06" },
    });
    if (!res.ok) return false;
    const lastModified = res.headers.get("last-modified");
    if (!lastModified) return true;
    const ageMs = Date.now() - new Date(lastModified).getTime();
    return Number.isFinite(ageMs) && ageMs <= maxAgeHours * 3_600_000;
  } catch {
    return false;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCoordinate(lat: unknown, lon: unknown): lat is number {
  return (
    isFiniteNumber(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    isFiniteNumber(lon) &&
    lon >= -180 &&
    lon <= 180
  );
}

function isWeatherEvent(value: unknown): value is WeatherEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<WeatherEvent>;
  return (
    typeof event.id === "string" &&
    typeof event.name === "string" &&
    ["hurricane", "tropical_storm", "severe_convective", "flood"].includes(event.kind ?? "") &&
    typeof event.status === "string" &&
    typeof event.basin === "string" &&
    isFiniteNumber(event.currentCategory) &&
    isFiniteNumber(event.currentWindMph) &&
    isFiniteNumber(event.gustMph) &&
    isFiniteNumber(event.pressureMb) &&
    isFiniteNumber(event.movementDeg) &&
    isFiniteNumber(event.movementMph) &&
    isCoordinate(event.lat, event.lon) &&
    ["low", "moderate", "high"].includes(event.confidence ?? "") &&
    typeof event.modelSource === "string" &&
    typeof event.updatedAtIso === "string" &&
    typeof event.expectedLandfall === "string" &&
    Array.isArray(event.history) &&
    event.history.every(
      (position) =>
        Array.isArray(position) && position.length === 2 && isCoordinate(position[1], position[0]),
    ) &&
    Array.isArray(event.forecast) &&
    event.forecast.length > 0 &&
    event.forecast.every(
      (point, index) =>
        isFiniteNumber(point?.hour) &&
        point.hour >= 0 &&
        (index === 0 || point.hour > event.forecast![index - 1]!.hour) &&
        isCoordinate(point.lat, point.lon) &&
        isFiniteNumber(point.windMph) &&
        isFiniteNumber(point.coneRadiusMi) &&
        point.coneRadiusMi >= 0 &&
        isFiniteNumber(point.category) &&
        isFiniteNumber(point.pressureMb),
    )
  );
}

/** Base URL of the OneGrid report-app /api. In the integrated deployment the
 * report-app hosts both the webapp and /api on the same host; override with
 * REPORT_API_URL when they are split. */
function reportApiBase(): string {
  return process.env["REPORT_API_URL"] || "http://127.0.0.1:7700";
}

/** Minimal runtime guard for an Asset row from /api/assets-geo (id + coordinates). */
function isAssetLike(value: unknown): value is Asset {
  if (!value || typeof value !== "object") return false;
  const a = value as Record<string, unknown>;
  return typeof a["id"] === "string" && isCoordinate(a["lat"], a["lon"]);
}

/** Load storm objects produced by the Aurora post-processing job. */
export const listAuroraWeatherEvents = createServerFn({ method: "GET" }).handler(
  async (): Promise<WeatherEvent[]> => {
    // Unified model: when the report-app /api data plane is wired, weather events
    // come from the conformed OneGridModel (dim_weather_event + WeatherForecast),
    // so the same dim_asset spine carries both twin health and storm exposure.
    if (process.env["REPORT_API_ENABLED"] === "1") {
      try {
        const res = await fetch(`${reportApiBase()}/api/weather/events`, { headers: { Accept: "application/json" } });
        if (!res.ok) return [];
        const payload = (await res.json()) as unknown;
        return Array.isArray(payload) ? payload.filter(isWeatherEvent) : [];
      } catch {
        return [];
      }
    }
    const containerUrl = process.env["UPLOAD_CONTAINER_URL"];
    if (!containerUrl) return [];
    const token = await getManagedIdentityToken(STORAGE_RESOURCE);
    if (!token) return [];
    try {
      const res = await fetch(`${containerUrl.replace(/\/$/, "")}/${WEATHER_EVENTS_BLOB_NAME}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-ms-version": "2021-08-06",
        },
      });
      if (!res.ok) return [];
      const payload = (await res.json()) as unknown;
      const events = Array.isArray(payload)
        ? payload
        : payload &&
            typeof payload === "object" &&
            Array.isArray((payload as { events?: unknown }).events)
          ? (payload as { events: unknown[] }).events
          : [];
      return events.filter(isWeatherEvent);
    } catch {
      return [];
    }
  },
);

export type UploadResult = { ok: boolean; message: string; blobUrl?: string };

/**
 * Upload a file to the tenant's sample-assets container using the App Service
 * managed identity (Storage Blob Data Contributor, granted in main.bicep). The
 * browser sends base64 through the server-function boundary; no account key or
 * SAS ever reaches the client.
 */
export const uploadAsset = createServerFn({ method: "POST" })
  .validator((data: { name: string; contentBase64: string; contentType?: string }) => data)
  .handler(async ({ data }): Promise<UploadResult> => {
    const containerUrl = process.env["SAMPLE_CONTAINER_URL"];
    if (!containerUrl) {
      return {
        ok: false,
        message: "Storage is not configured for this deployment (SAMPLE_CONTAINER_URL is unset).",
      };
    }
    const token = await getManagedIdentityToken(STORAGE_RESOURCE);
    if (!token) {
      return {
        ok: false,
        message:
          "Could not acquire a managed-identity token for storage. Confirm the App Service identity has Storage Blob Data Contributor.",
      };
    }
    // Flatten to a safe blob name — no paths, no odd characters.
    const safeName = (data.name.split(/[\\/]/).pop() || "upload.bin").replace(/[^\w.-]/g, "_");
    const bytes = Buffer.from(data.contentBase64, "base64");
    if (bytes.length === 0) return { ok: false, message: "The file is empty." };
    const blobUrl = `${containerUrl.replace(/\/$/, "")}/${encodeURIComponent(safeName)}`;
    try {
      const res = await fetch(blobUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "x-ms-blob-type": "BlockBlob",
          "x-ms-version": "2021-08-06",
          "Content-Type": data.contentType || "application/octet-stream",
        },
        body: bytes,
      });
      if (!res.ok) {
        return { ok: false, message: `Upload failed (${res.status} ${res.statusText}).` };
      }
      return { ok: true, message: `Uploaded ${safeName}.`, blobUrl };
    } catch {
      return { ok: false, message: "Upload failed: could not reach the storage account." };
    }
  });

// ---------------------------------------------------------------------------
// Asset-register ingestion: read the CSV / GeoJSON files an operator uploaded to
// the sample-assets container and parse them into the domain Asset shape, so the
// map, risk engine and tables populate from the operator's OWN data. Returns []
// when storage is unwired or empty — never synthetic assets.
// ---------------------------------------------------------------------------

const ASSET_TYPES = new Set<AssetType>([
  "offshore_platform",
  "pipeline",
  "well",
  "refinery",
  "lng_terminal",
  "storage",
  "port",
]);
const OPERATING_STATUSES = new Set<OperatingStatus>([
  "producing",
  "reduced",
  "shut_in",
  "evacuating",
  "standby",
]);

function normalizeType(v: string): AssetType {
  const s = v
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (s === "platform") return "offshore_platform";
  return ASSET_TYPES.has(s as AssetType) ? (s as AssetType) : "well";
}
function normalizeStatus(v: string): OperatingStatus {
  const s = v
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return OPERATING_STATUSES.has(s as OperatingStatus) ? (s as OperatingStatus) : "producing";
}
function normalizeCriticality(v: string): Asset["criticality"] {
  const s = v
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return s === "business_critical" || s === "important" ? s : "standard";
}

/** Minimal RFC-4180-style CSV line splitter (handles double-quoted fields). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseCsvAssets(text: string): Asset[] {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]!).map((h) => h.toLowerCase());
  const pick = (row: string[], ...names: string[]): string => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0 && row[i] !== undefined && row[i] !== "") return row[i]!;
    }
    return "";
  };
  const out: Asset[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = splitCsvLine(lines[i]!);
    const id = pick(row, "id");
    const lat = Number(pick(row, "latitude", "lat"));
    const lon = Number(pick(row, "longitude", "lon", "long"));
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({
      id,
      name: pick(row, "name") || id,
      type: normalizeType(pick(row, "type")),
      lat,
      lon,
      operator: pick(row, "operator"),
      region: pick(row, "region"),
      businessUnit: pick(row, "business_unit", "businessunit"),
      status: normalizeStatus(pick(row, "operating_status", "status")),
      criticality: normalizeCriticality(pick(row, "criticality")),
      metadata: {},
    });
  }
  return out;
}

function centroid(ring: number[][]): [number, number] {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const p of ring) {
    if (Array.isArray(p) && p.length >= 2) {
      x += Number(p[0]);
      y += Number(p[1]);
      n++;
    }
  }
  return n ? [x / n, y / n] : [NaN, NaN];
}

function parseGeoJsonAssets(text: string): Asset[] {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return [];
  }
  const root = doc as { type?: string; features?: unknown[]; stac_version?: unknown };
  // A STAC document (Item/Collection/Catalog) is GeoJSON-shaped but is imagery
  // metadata, not an asset register — never ingest it as an asset.
  if (root && "stac_version" in root) return [];
  const features: unknown[] =
    root?.type === "FeatureCollection"
      ? (root.features ?? [])
      : root?.type === "Feature"
        ? [doc]
        : [];
  const out: Asset[] = [];
  for (const raw of features) {
    // Skip STAC items that may have been dropped into the same container.
    if (raw && typeof raw === "object" && ("stac_version" in raw || "assets" in raw)) continue;
    const f = raw as {
      properties?: Record<string, unknown>;
      geometry?: { type?: string; coordinates?: unknown };
    };
    const p = f?.properties ?? {};
    const g = f?.geometry ?? {};
    const id = String(p["id"] ?? "").trim();
    if (!id) continue;
    let lat = NaN;
    let lon = NaN;
    let geometry: Array<[number, number]> | undefined;
    if (g.type === "Point" && Array.isArray(g.coordinates)) {
      lon = Number((g.coordinates as number[])[0]);
      lat = Number((g.coordinates as number[])[1]);
    } else if (g.type === "LineString" && Array.isArray(g.coordinates)) {
      geometry = g.coordinates as Array<[number, number]>;
      [lon, lat] = centroid(g.coordinates as number[][]);
    } else if (g.type === "Polygon" && Array.isArray(g.coordinates)) {
      [lon, lat] = centroid(((g.coordinates as number[][][])[0] ?? []) as number[][]);
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const type = normalizeType(String(p["type"] ?? ""));
    const asset: Asset = {
      id,
      name: String(p["name"] ?? id),
      type,
      lat,
      lon,
      operator: String(p["operator"] ?? ""),
      region: String(p["region"] ?? ""),
      businessUnit: String(p["business_unit"] ?? p["businessUnit"] ?? ""),
      status: normalizeStatus(String(p["operating_status"] ?? p["status"] ?? "")),
      criticality: normalizeCriticality(String(p["criticality"] ?? "")),
      metadata:
        p["metadata"] && typeof p["metadata"] === "object"
          ? (p["metadata"] as Record<string, string | number>)
          : {},
    };
    if (geometry && type === "pipeline") asset.geometry = geometry;
    out.push(asset);
  }
  return out;
}

/**
 * List every CSV / GeoJSON the operator uploaded to the sample-assets container
 * and parse them into the domain Asset shape. This is what turns an upload into a
 * populated map + risk score. Later files (and later rows) win on duplicate id.
 */
export const listUploadedAssets = createServerFn({ method: "GET" }).handler(
  async (): Promise<Asset[]> => {
    // Unified model: when the report-app /api data plane is wired, weather assets are the
    // FACILITIES (dim_site) — the same named sites the Digital Twin shows (Riverton,
    // Fairview, Thunder Horse…) at their real coordinates — not the per-equipment leaves.
    // Exposure/posture roll up to the site; the twin drills site→unit→equipment separately.
    if (process.env["REPORT_API_ENABLED"] === "1") {
      try {
        const res = await fetch(`${reportApiBase()}/api/sites-geo`, { headers: { Accept: "application/json" } });
        if (!res.ok) return [];
        const payload = (await res.json()) as unknown;
        return Array.isArray(payload) ? payload.filter(isAssetLike) : [];
      } catch {
        return [];
      }
    }
    const containerUrl = process.env["SAMPLE_CONTAINER_URL"];
    if (!containerUrl) return [];
    const token = await getManagedIdentityToken(STORAGE_RESOURCE);
    if (!token) return [];
    const base = containerUrl.replace(/\/$/, "");
    const authHeaders = { Authorization: `Bearer ${token}`, "x-ms-version": "2021-08-06" };
    try {
      const listRes = await fetch(`${base}?restype=container&comp=list`, { headers: authHeaders });
      if (!listRes.ok) return [];
      const xml = await listRes.text();
      const names = Array.from(xml.matchAll(/<Name>([^<]+)<\/Name>/g)).map((m) => m[1]!);
      const dataFiles = names.filter(
        // Only asset files — skip the app-config blobs (e.g. threshold rules) that
        // also live in this container.
        (n) => /\.(csv|geojson|json)$/i.test(n) && !/(^|\/)app-config\./i.test(n),
      );
      const byId = new Map<string, Asset>();
      for (const name of dataFiles) {
        const blobPath = name.split("/").map(encodeURIComponent).join("/");
        const res = await fetch(`${base}/${blobPath}`, { headers: authHeaders });
        if (!res.ok) continue;
        const body = await res.text();
        const parsed = /\.csv$/i.test(name) ? parseCsvAssets(body) : parseGeoJsonAssets(body);
        for (const a of parsed) byId.set(a.id, a);
      }
      return Array.from(byId.values());
    } catch {
      return [];
    }
  },
);

export type SeedResult = { ok: boolean; message: string; collectionId?: string; ingested?: number };

/**
 * Pre-seed the tenant GeoCatalog with a small public sample so a fresh
 * deployment isn't empty: pull a few low-cloud Sentinel-2 scenes over the Gulf
 * of Mexico from the open Planetary Computer, create a collection in the tenant
 * catalog, and ingest the items via the STAC transaction API (GeoCatalog
 * Administrator, granted in main.bicep). Public imagery only — never customer data.
 */
export const seedPublicSample = createServerFn({ method: "POST" }).handler(
  async (): Promise<SeedResult> => {
    const geoCatalogUrl = process.env["GEOCATALOG_URI"];
    if (!geoCatalogUrl) {
      return {
        ok: false,
        message: "GeoCatalog is not configured for this deployment (GEOCATALOG_URI is unset).",
      };
    }
    const token = await getManagedIdentityToken(GEOCATALOG_RESOURCE);
    if (!token) {
      return {
        ok: false,
        message:
          "Could not acquire a managed-identity token for the GeoCatalog. Confirm the App Service identity has GeoCatalog Administrator.",
      };
    }
    const base = geoCatalogUrl.replace(/\/$/, "");
    const collectionId = "sample-sentinel-2-gom";
    const authJson = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    // 1. Query the public catalog for a few recent, low-cloud scenes.
    let items: Array<Record<string, unknown>> = [];
    try {
      const searchRes = await fetch(`${PUBLIC_PC_STAC}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collections: ["sentinel-2-l2a"],
          bbox: [-95, 27, -89, 30.5],
          limit: 3,
          query: { "eo:cloud_cover": { lt: 15 } },
        }),
      });
      if (!searchRes.ok) {
        return {
          ok: false,
          message: `Could not query the public Planetary Computer (${searchRes.status}).`,
        };
      }
      const fc = (await searchRes.json()) as { features?: Array<Record<string, unknown>> };
      items = fc.features ?? [];
    } catch {
      return {
        ok: false,
        message: "Could not reach the public Planetary Computer to fetch sample imagery.",
      };
    }
    if (items.length === 0) {
      return { ok: false, message: "No public sample scenes were returned for the sample area." };
    }

    let assetSasToken: string;
    try {
      const sasRes = await fetch(
        "https://planetarycomputer.microsoft.com/api/sas/v1/token/sentinel-2-l2a",
      );
      if (!sasRes.ok) {
        return {
          ok: false,
          message: `Could not acquire access to the public sample assets (${sasRes.status}).`,
        };
      }
      const sas = (await sasRes.json()) as { token?: string };
      if (!sas.token) {
        return { ok: false, message: "The public sample asset token response was empty." };
      }
      assetSasToken = sas.token;
    } catch {
      return { ok: false, message: "Could not acquire access to the public sample assets." };
    }

    // 2. Create the collection in the tenant catalog (ignore 409 if it exists).
    const collection = {
      type: "Collection",
      id: collectionId,
      stac_version: "1.0.0",
      title: "Sample: Sentinel-2 over the Gulf of Mexico",
      description:
        "Public Sentinel-2 L2A sample imagery from the open Planetary Computer, pre-seeded so the catalog is not empty. Replace with your own collections.",
      license: "proprietary",
      extent: {
        spatial: { bbox: [[-95, 27, -89, 30.5]] },
        temporal: { interval: [[null, null]] },
      },
      links: [],
    };
    try {
      const cRes = await fetch(geoCatalogApiUrl(base, "stac/collections"), {
        method: "POST",
        headers: authJson,
        body: JSON.stringify(collection),
      });
      if (!cRes.ok && cRes.status !== 409) {
        const detail = await cRes.text();
        return {
          ok: false,
          message: `Could not create the sample collection (${cRes.status}). ${detail.slice(0, 200)}`,
        };
      }
    } catch {
      return {
        ok: false,
        message: "Could not reach the GeoCatalog to create the sample collection.",
      };
    }

    // 3. Ingest the items, re-homing them onto the new collection.
    let ingested = 0;
    let lastIngestionError = "";
    for (const item of items) {
      item["collection"] = collectionId;
      item["links"] = [
        {
          rel: "collection",
          type: "application/json",
          href: geoCatalogApiUrl(base, `stac/collections/${collectionId}`),
        },
      ];
      const assets = item["assets"] as Record<string, { href?: string }> | undefined;
      if (assets) {
        delete assets["rendered_preview"];
        delete assets["preview"];
        delete assets["tilejson"];
        for (const asset of Object.values(assets)) {
          if (!asset.href?.includes(".blob.core.windows.net/")) continue;
          const assetUrl = new URL(asset.href);
          assetUrl.search = assetSasToken;
          asset.href = assetUrl.toString();
        }
      }
      try {
        const iRes = await fetch(geoCatalogApiUrl(base, `stac/collections/${collectionId}/items`), {
          method: "POST",
          headers: authJson,
          body: JSON.stringify(item),
        });
        if (iRes.ok || iRes.status === 409) {
          ingested++;
        } else {
          lastIngestionError = (await iRes.text()).slice(0, 200);
        }
      } catch {
        lastIngestionError = "Could not reach the GeoCatalog item-ingestion endpoint.";
      }
    }
    if (ingested === 0) {
      return {
        ok: false,
        message:
          `The sample collection was created but no items could be ingested. ${lastIngestionError}`.trim(),
      };
    }
    return {
      ok: true,
      message: `Seeded ${ingested} sample scene${ingested === 1 ? "" : "s"} into "${collectionId}".`,
      collectionId,
      ingested,
    };
  },
);

// ---------------------------------------------------------------------------
// Threshold-rule persistence.
// Operator-tuned thresholds are stored as a single JSON blob in the deployment's
// storage container (same managed-identity path as uploadAsset). This survives
// restarts so a customer's tuned limits are durable. When storage is not wired
// (local dev) load returns null and the app falls back to the built-in defaults.
// ---------------------------------------------------------------------------

const THRESHOLD_BLOB_NAME = "app-config.threshold-rules.json";
const POSTURE_BLOB_NAME = "app-config.posture-overrides.json";
const ALERT_STATUS_BLOB_NAME = "app-config.alert-status.json";

function appConfigBlobUrl(containerUrl: string, blobName: string): string {
  return `${containerUrl.replace(/\/$/, "")}/${blobName}`;
}

/** Read a JSON app-config blob, or null when missing / storage unwired. */
async function loadJsonBlob<T>(blobName: string): Promise<T | null> {
  const containerUrl = process.env["SAMPLE_CONTAINER_URL"];
  if (!containerUrl) return null;
  const token = await getManagedIdentityToken(STORAGE_RESOURCE);
  if (!token) return null;
  try {
    const res = await fetch(appConfigBlobUrl(containerUrl, blobName), {
      headers: { Authorization: `Bearer ${token}`, "x-ms-version": "2021-08-06" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export type SaveResult = { ok: boolean; persisted: boolean; message: string };
/** @deprecated Use SaveResult. Retained for callers still importing the old name. */
export type SaveRulesResult = SaveResult;

/**
 * Write a JSON app-config blob. Returns persisted:false (not an error) when
 * storage is unwired so local dev keeps working in-memory; ok:false only on a
 * real storage failure the caller should surface to the operator.
 */
async function saveJsonBlob(blobName: string, value: unknown, label: string): Promise<SaveResult> {
  const containerUrl = process.env["SAMPLE_CONTAINER_URL"];
  if (!containerUrl) {
    return {
      ok: true,
      persisted: false,
      message: `Storage not configured; ${label} kept in memory for this session.`,
    };
  }
  const token = await getManagedIdentityToken(STORAGE_RESOURCE);
  if (!token) {
    return {
      ok: false,
      persisted: false,
      message: "Could not acquire a managed-identity token for storage.",
    };
  }
  const body = Buffer.from(JSON.stringify(value), "utf8");
  try {
    const res = await fetch(appConfigBlobUrl(containerUrl, blobName), {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-ms-blob-type": "BlockBlob",
        "x-ms-version": "2021-08-06",
        "Content-Type": "application/json",
      },
      body,
    });
    if (!res.ok) {
      return { ok: false, persisted: false, message: `Could not save ${label} (${res.status}).` };
    }
    return { ok: true, persisted: true, message: `${label} saved.` };
  } catch {
    return { ok: false, persisted: false, message: `Could not reach storage to save ${label}.` };
  }
}

/** Load persisted threshold rules, or null when none are stored / storage unwired. */
export const loadThresholdRules = createServerFn({ method: "GET" }).handler(
  async (): Promise<ThresholdRule[] | null> => {
    const rules = await loadJsonBlob<ThresholdRule[]>(THRESHOLD_BLOB_NAME);
    return Array.isArray(rules) ? rules : null;
  },
);

/** Persist the full threshold-rule set to storage. */
export const saveThresholdRules = createServerFn({ method: "POST" })
  .validator((data: { rules: ThresholdRule[] }) => data)
  .handler(async ({ data }): Promise<SaveResult> => {
    if (!Array.isArray(data?.rules)) {
      return { ok: false, persisted: false, message: "Invalid threshold payload." };
    }
    return saveJsonBlob(THRESHOLD_BLOB_NAME, data.rules, "thresholds");
  });

// ---------------------------------------------------------------------------
// Response-posture operator overrides. Posture is derived from live exposure;
// when an operator advances a gate or changes production status the override is
// persisted here so the decision survives restarts and is shared across workers.
// ---------------------------------------------------------------------------

export type PostureOverrides = {
  gates: Record<string, Partial<Record<GateId, GateState>>>;
  status: Record<string, OperatingStatus>;
};

const EMPTY_POSTURE_OVERRIDES: PostureOverrides = { gates: {}, status: {} };

function normalizePostureOverrides(value: PostureOverrides | null): PostureOverrides {
  if (!value || typeof value !== "object") return { gates: {}, status: {} };
  return {
    gates: value.gates && typeof value.gates === "object" ? value.gates : {},
    status: value.status && typeof value.status === "object" ? value.status : {},
  };
}

/** Load persisted posture overrides (gate + production-status changes). */
export const loadPostureOverrides = createServerFn({ method: "GET" }).handler(
  async (): Promise<PostureOverrides> => {
    return normalizePostureOverrides(await loadJsonBlob<PostureOverrides>(POSTURE_BLOB_NAME));
  },
);

/** Persist the full posture-override set. */
export const savePostureOverrides = createServerFn({ method: "POST" })
  .validator((data: { overrides: PostureOverrides }) => data)
  .handler(async ({ data }): Promise<SaveResult> => {
    return saveJsonBlob(
      POSTURE_BLOB_NAME,
      normalizePostureOverrides(data?.overrides ?? null),
      "posture",
    );
  });

// ---------------------------------------------------------------------------
// Alert status overrides. Threshold breaches are derived each forecast cycle, so
// acknowledgement / resolution is stored as a map keyed by the stable alert id
// (ruleId-assetId) rather than as standalone alert records.
// ---------------------------------------------------------------------------

export type AlertStatusMap = Record<string, OpsAlert["status"]>;

const ALERT_STATUSES = new Set<OpsAlert["status"]>(["open", "acknowledged", "resolved"]);

function normalizeAlertStatuses(value: AlertStatusMap | null): AlertStatusMap {
  if (!value || typeof value !== "object") return {};
  const out: AlertStatusMap = {};
  for (const [id, status] of Object.entries(value)) {
    if (ALERT_STATUSES.has(status as OpsAlert["status"])) out[id] = status as OpsAlert["status"];
  }
  return out;
}

/** Load persisted alert status overrides. */
export const loadAlertStatuses = createServerFn({ method: "GET" }).handler(
  async (): Promise<AlertStatusMap> => {
    return normalizeAlertStatuses(await loadJsonBlob<AlertStatusMap>(ALERT_STATUS_BLOB_NAME));
  },
);

/** Persist the full alert status-override map. */
export const saveAlertStatuses = createServerFn({ method: "POST" })
  .validator((data: { statuses: AlertStatusMap }) => data)
  .handler(async ({ data }): Promise<SaveResult> => {
    return saveJsonBlob(
      ALERT_STATUS_BLOB_NAME,
      normalizeAlertStatuses(data?.statuses ?? null),
      "alert status",
    );
  });

export { EMPTY_POSTURE_OVERRIDES };
