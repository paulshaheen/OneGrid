// Server-only Azure integration. Everything in this module runs inside the SSR
// server function boundary, so @tanstack/react-start strips it (and the Managed
// Identity token calls, process.env access and Azure endpoints) from the browser
// bundle. The client reaches these only through the exported server functions.

import { createServerFn } from "@tanstack/react-start";

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
    const imds = `http://169.254.169.254/metadata/identity/oauth2/token?resource=${encodeURIComponent(resource)}&api-version=2018-02-01`;
    const res = await fetch(imds, { headers: { Metadata: "true" } });
    if (!res.ok) return null;
    const json = (await res.json()) as { access_token?: string };
    return json.access_token ?? null;
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
export const askFoundryCopilot = createServerFn({ method: "POST" })
  .validator((data: { question: string }) => data)
  .handler(async ({ data }): Promise<CopilotAnswer> => {
    const endpoint = process.env["FOUNDRY_ENDPOINT"];
    const deployment = process.env["FOUNDRY_DEPLOYMENT"];
    if (!endpoint || !deployment) {
      return {
        text: "The AI assistant is not configured for this deployment. Set FOUNDRY_ENDPOINT and FOUNDRY_DEPLOYMENT to enable grounded answers from your Azure OpenAI (Foundry) resource.",
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

    try {
      const url = `${endpoint.replace(/\/$/, "")}/openai/deployments/${deployment}/chat/completions?api-version=2024-06-01`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content:
                "You are an operations assistant for weather and asset risk in energy infrastructure. Answer concisely and only from the tenant's data.",
            },
            { role: "user", content: data.question },
          ],
          temperature: 0.2,
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
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = body.choices?.[0]?.message?.content?.trim();
      return { text: text || "No answer was returned.", citations: [], highlightAssetIds: [] };
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
};

/** Report which onboarding capabilities the current deployment has wired. */
export const getDataPlaneStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<DataPlaneStatus> => ({
    geoCatalogConfigured: Boolean(process.env["GEOCATALOG_URI"]),
    uploadConfigured: Boolean(process.env["SAMPLE_CONTAINER_URL"]),
    auroraEndpointConfigured: Boolean(process.env["AURORA_ENDPOINT"]),
    auroraModelDeployed: process.env["AURORA_MODEL_DEPLOYED"] === "true",
    auroraAdapterConnected: await auroraOutputFresh(),
  }),
);

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

/** Load storm objects produced by the Aurora post-processing job. */
export const listAuroraWeatherEvents = createServerFn({ method: "GET" }).handler(
  async (): Promise<WeatherEvent[]> => {
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
