// SAP S/4HANA data for the "SAP S/4HANA" page.
//
// Energy: a snapshot of the tables replicated from the SAP demo system (A4H, client 001) into
// Fabric through the SAP_A4H_Mirror mirrored database (schema `sap`). It is bundled with the app
// so the page keeps working when the SAP VM or the mirror is offline.
// Oil & Gas (OneRig): the same SAP table shapes, generated deterministically from the OneRig
// sample estate so plants, equipment and outages line up with the rest of the OneRig app.
import type { Solution } from "@/lib/solution";

export const AS_OF = "2026-10-21";

export interface SapSite {
  WERKS: string;
  NAME1: string;
  SITE_TYPE: string;
  REGION: string;
  BUSINESS_UNIT: string;
  OPERATOR: string;
  CRITICALITY: string;
  LATITUDE: number;
  LONGITUDE: number;
}
export interface SapEquipment {
  EQUNR: string;
  EQKTX: string;
  MATNR: string;
  WERKS: string;
  ASSET_ID: string;
  MANUFACTURER: string;
  MFRPN: string;
  INSTALL_DATE: string;
  STATUS: string;
}
export interface SapWarranty {
  WARR_ID: string;
  EQUNR: string;
  WERKS: string;
  MATNR: string;
  WARR_TYPE: string;
  WARRANTOR: string;
  COVERAGE: string;
  START_DATE: string;
  END_DATE: string;
  TERM_YEARS: number;
  CONTRACT_VALUE: number;
  STATUS: string;
}
export interface SapClaim {
  CLAIM_ID: string;
  WARR_ID: string;
  EQUNR: string;
  WERKS: string;
  CLAIM_DATE: string;
  FAILURE_MODE: string;
  DESCRIPTION: string;
  CLAIM_AMT: number;
  APPROVED_AMT: number;
  PAID_AMT: number;
  STATUS: string;
  OEM_RMA: string;
  OUTAGE_ID: string;
}
export interface SapPerf {
  EQUNR: string;
  PERIOD: string;
  WERKS: string;
  EXPECTED_MWH: number;
  ACTUAL_MWH: number;
  PERF_RATIO: number;
  DEGR_CUM_PCT: number;
  GUAR_MAX_PCT: number;
  BREACH: string;
}
export interface SapOutage {
  OUTAGE_ID: string;
  EQUNR: string;
  WERKS: string;
  ASSET_ID: string;
  OUTAGE_TYPE: string;
  CAUSE_CODE: string;
  CAUSE_TEXT: string;
  START_DATE: string;
  END_DATE: string | null;
  DURATION_H: number;
  DERATE_PCT: number;
  LOST_OUTPUT: number;
  OUTPUT_UOM: string;
  PRICE_PER_UOM: number;
  TOTAL_IMPACT: number;
  STORM_EVENT: string;
  STATUS: string;
}
export interface SapFinLine {
  OUTAGE_ID: string;
  LINE_NO: string;
  COST_CAT: string;
  DESCRIPTION: string;
  AMOUNT: number;
  KOSTL: string;
  HKONT: string;
  POST_DATE: string;
  REF_DOC: string;
}
type Row = Record<string, unknown>;

export interface SapTableInfo {
  name: string;
  label: string;
  rows: number;
}

export interface SapDataset {
  solution: Solution;
  system: { sid: string; client: string; release: string; mirror: string; schema: string };
  warrantyLabel: string;
  perfLabel: string;
  perfUnit: string;
  tables: SapTableInfo[];
  sites: SapSite[];
  equipment: SapEquipment[];
  materials: Row[];
  plantMaterials: Row[];
  warranties: SapWarranty[];
  claims: SapClaim[];
  perf: SapPerf[];
  outages: SapOutage[];
  fin: SapFinLine[];
}

const TABLE_LABELS: Record<string, string> = {
  ZT001W: "Plants",
  ZMARA: "Material master",
  ZMARC: "Plant materials & spares",
  ZEQUI: "Equipment master",
  ZSOL_WARR: "Warranty contracts",
  ZSOL_CLAIM: "Warranty claims",
  ZSOL_PERF: "Performance guarantees",
  ZOUT_EVT: "Outage events",
  ZOUT_FIN: "Outage cost postings",
};
const TABLE_ORDER = Object.keys(TABLE_LABELS);

const SYSTEM = {
  sid: "A4H",
  client: "001",
  release: "SAP S/4HANA (ABAP Cloud) on HANA",
  mirror: "SAP_A4H_Mirror",
  schema: "sap",
};

function tableInfo(byName: Record<string, unknown[]>): SapTableInfo[] {
  return TABLE_ORDER.map((name) => ({
    name,
    label: TABLE_LABELS[name] ?? name,
    rows: byName[name]?.length ?? 0,
  }));
}

// ------------------------------------------------------------------------------------ Energy
interface Snapshot {
  tables: Record<string, { columns: string[]; rows: unknown[][] }>;
}

async function loadEnergy(): Promise<SapDataset> {
  const snap = (await import("./sap-energy-snapshot.json")).default as unknown as Snapshot;
  const t = (name: string): Row[] => {
    const tb = snap.tables[name];
    if (!tb) return [];
    return tb.rows.map((r) => Object.fromEntries(tb.columns.map((c, i) => [c, r[i]])));
  };
  const byName: Record<string, Row[]> = Object.fromEntries(TABLE_ORDER.map((n) => [n, t(n)]));
  const g = (n: string): Row[] => byName[n] ?? [];
  return {
    solution: "energy",
    system: SYSTEM,
    warrantyLabel: "Solar Warranty",
    perfLabel: "Cumulative degradation vs warranted maximum",
    perfUnit: "MWh",
    tables: tableInfo(byName),
    sites: g("ZT001W") as unknown as SapSite[],
    materials: g("ZMARA"),
    plantMaterials: g("ZMARC"),
    equipment: g("ZEQUI") as unknown as SapEquipment[],
    warranties: g("ZSOL_WARR") as unknown as SapWarranty[],
    claims: g("ZSOL_CLAIM") as unknown as SapClaim[],
    perf: g("ZSOL_PERF") as unknown as SapPerf[],
    outages: g("ZOUT_EVT") as unknown as SapOutage[],
    fin: g("ZOUT_FIN") as unknown as SapFinLine[],
  };
}

// ------------------------------------------------------------------------------- Oil & Gas
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed: string) {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const DAY = 864e5;
const asOf = new Date(`${AS_OF}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const r2 = (n: number) => Math.round(n * 100) / 100;

const OG_SITES: Record<string, Omit<SapSite, "NAME1">> = {
  "West Delta": {
    WERKS: "OGWD",
    SITE_TYPE: "offshore_platform",
    REGION: "gulf_offshore",
    BUSINESS_UNIT: "Offshore",
    OPERATOR: "OGE Upstream",
    CRITICALITY: "business_critical",
    LATITUDE: 28.9,
    LONGITUDE: -89.9,
  },
  "Mars-Ursa": {
    WERKS: "OGMU",
    SITE_TYPE: "offshore_platform",
    REGION: "gulf_offshore",
    BUSINESS_UNIT: "Offshore",
    OPERATOR: "OGE Upstream",
    CRITICALITY: "business_critical",
    LATITUDE: 28.17,
    LONGITUDE: -89.22,
  },
  "Port Arthur": {
    WERKS: "OGPA",
    SITE_TYPE: "refinery",
    REGION: "gulf_coast",
    BUSINESS_UNIT: "Refining",
    OPERATOR: "OGE Downstream",
    CRITICALITY: "business_critical",
    LATITUDE: 29.88,
    LONGITUDE: -93.94,
  },
  "Sabine Pass": {
    WERKS: "OGSP",
    SITE_TYPE: "lng",
    REGION: "gulf_coast",
    BUSINESS_UNIT: "LNG",
    OPERATOR: "OGE LNG",
    CRITICALITY: "business_critical",
    LATITUDE: 29.74,
    LONGITUDE: -93.87,
  },
  "Clovelly Hub": {
    WERKS: "OGCH",
    SITE_TYPE: "terminal",
    REGION: "gulf_coast",
    BUSINESS_UNIT: "Midstream",
    OPERATOR: "OGE Midstream",
    CRITICALITY: "important",
    LATITUDE: 29.47,
    LONGITUDE: -90.25,
  },
  "Louisiana Offshore": {
    WERKS: "OGLO",
    SITE_TYPE: "terminal",
    REGION: "gulf_offshore",
    BUSINESS_UNIT: "Midstream",
    OPERATOR: "OGE Midstream",
    CRITICALITY: "business_critical",
    LATITUDE: 28.88,
    LONGITUDE: -90.02,
  },
};

// OEMs match the OneRig equipment-manual library (fictional manufacturers).
interface Oem {
  mfr: string;
  model: string;
  code: string;
  cat: string;
  wty?: string;
}
const OEM: Record<string, Oem[]> = {
  wellhead: [
    {
      mfr: "Calcasieu Valve & Wellhead",
      model: "WH-10K-S",
      code: "WHD-CVW",
      cat: "Static",
      wty: "Christmas tree, valves and choke",
    },
  ],
  turbine: [
    {
      mfr: "Corsair Turbomachinery",
      model: "CT-25 DLE",
      code: "GTC-COR",
      cat: "Rotating",
      wty: "Gas turbine and compressor train",
    },
  ],
  pump: [
    {
      mfr: "Bayou Rotating Equipment",
      model: "BB3-Export 8x10",
      code: "PMP-BRE",
      cat: "Rotating",
      wty: "Pump, mechanical seal and bearings",
    },
    {
      mfr: "Tidewater Process Equipment",
      model: "TPE-OH2 6x8",
      code: "PMP-TPE",
      cat: "Rotating",
      wty: "Pump, mechanical seal and bearings",
    },
  ],
  generator: [
    {
      mfr: "Pelican Electric Machines",
      model: "PEM-30 TEWAC",
      code: "GEN-PEM",
      cat: "Electrical",
      wty: "Generator, excitation and AVR",
    },
  ],
  heater: [
    {
      mfr: "Ridgeline Fired Systems",
      model: "RFS-CH-120",
      code: "FHT-RFS",
      cat: "Fired",
      wty: "Radiant coils, burners and refractory",
    },
  ],
  refinery: [
    { mfr: "Tidewater Process Equipment", model: "TPE-ADU-250", code: "CDU-TPE", cat: "Static" },
  ],
  lng: [
    {
      mfr: "Sabine Cryogenics",
      model: "SC-MR 4.5",
      code: "LNG-SAB",
      cat: "Static",
      wty: "Cold box and mixed-refrigerant circuit",
    },
  ],
  storage: [{ mfr: "Ironclad Tankworks", model: "IT-EFR-500", code: "TNK-ICT", cat: "Static" }],
  pipeline: [
    { mfr: "Meridian Pipeline Services", model: "MPS-48-EX", code: "PPL-MPS", cat: "Static" },
  ],
  port: [
    {
      mfr: "Pelican Marine Systems",
      model: "PMS-16-HD",
      code: "MLA-PMS",
      cat: "Marine",
      wty: "Loading arms, swivels and ERS",
    },
  ],
  platform: [
    { mfr: "Gulfstar Subsea Systems", model: "GS-Jacket-4L", code: "PLT-GSS", cat: "Static" },
  ],
};

// Lost-output basis per equipment group: daily rate, unit and $ per unit.
interface OutputBasis {
  rate: number;
  uom: string;
  price: number;
  cat: "LOST_PRODUCTION" | "LOST_THROUGHPUT";
}
const OUTPUT: Record<string, OutputBasis> = {
  wellhead: { rate: 4200, uom: "bbl", price: 74, cat: "LOST_PRODUCTION" },
  platform: { rate: 26000, uom: "bbl", price: 74, cat: "LOST_PRODUCTION" },
  turbine: { rate: 70, uom: "MMSCF", price: 380, cat: "LOST_PRODUCTION" },
  pump: { rate: 28000, uom: "bbl", price: 74, cat: "LOST_PRODUCTION" },
  generator: { rate: 9000, uom: "bbl", price: 74, cat: "LOST_PRODUCTION" },
  refinery: { rate: 120000, uom: "bbl", price: 14, cat: "LOST_THROUGHPUT" },
  heater: { rate: 60000, uom: "bbl", price: 14, cat: "LOST_THROUGHPUT" },
  lng: { rate: 12000, uom: "t LNG", price: 560, cat: "LOST_PRODUCTION" },
  storage: { rate: 40000, uom: "bbl", price: 3.5, cat: "LOST_THROUGHPUT" },
  pipeline: { rate: 300, uom: "MMSCF", price: 45, cat: "LOST_THROUGHPUT" },
  port: { rate: 50000, uom: "bbl", price: 3.5, cat: "LOST_THROUGHPUT" },
};

const CAUSES: Record<string, [string, string][]> = {
  wellhead: [
    ["CHOKE_EROS", "Choke trim erosion, wellhead pressure excursion"],
    ["SCSSV_TEST", "SCSSV failed closure test, well shut in"],
    ["HYDRATE", "Hydrate plug in flowline, low wellhead temperature"],
  ],
  turbine: [
    ["BRG_VIBR", "Gas turbine bearing vibration high"],
    ["SURGE", "Compressor surge, anti-surge valve slow to stroke"],
    ["SEAL_GAS", "Dry gas seal primary vent flow high"],
  ],
  pump: [
    ["MECH_SEAL", "Export pump mechanical seal leak"],
    ["BRG_TEMP", "Pump bearing temperature high"],
    ["CAVITATION", "Pump cavitation, low NPSH"],
  ],
  generator: [
    ["STATOR_TEMP", "Stator temperature high, cooler fouling"],
    ["AVR_FAULT", "AVR excitation fault, rotating diode failure"],
  ],
  heater: [
    ["TUBE_SKIN", "Fired-heater tube skin temperature high, coking"],
    ["BURNER", "Burner flame instability"],
  ],
  refinery: [
    ["TOP_PRESS", "Crude column top pressure high, overhead condenser"],
    ["PREHEAT", "Preheat-train fouling, exchanger clean"],
  ],
  lng: [
    ["COLD_BOX", "Cold-box temperature deviation, MR composition drift"],
    ["BOG", "BOG compressor discharge pressure high"],
  ],
  storage: [
    ["ROOF_SEAL", "Floating-roof seal repair"],
    ["API653", "API 653 out-of-service inspection"],
  ],
  pipeline: [
    ["PIG_TRAP", "Pig launcher closure seal failure"],
    ["CP_LOW", "Cathodic protection below setpoint, line pressure reduced"],
  ],
  port: [
    ["ARM_HYD", "Loading-arm hydraulic leak"],
    ["VRU_TRIP", "Vapor-recovery unit trip, loading paused"],
  ],
  platform: [
    ["RISER", "Riser corrosion repair, production reduced"],
    ["DELUGE", "Firewater deluge impairment, production curtailed"],
  ],
};

const at = <T>(arr: readonly T[], i: number): T =>
  arr[((i % arr.length) + arr.length) % arr.length] as T;
const PLATFORM_OEM: Oem = {
  mfr: "Gulfstar Subsea Systems",
  model: "GS-Jacket-4L",
  code: "PLT-GSS",
  cat: "Static",
};
const PLATFORM_OUT: OutputBasis = { rate: 26000, uom: "bbl", price: 74, cat: "LOST_PRODUCTION" };
const PLATFORM_CAUSES: [string, string][] = [
  ["RISER", "Riser corrosion repair, production reduced"],
];
const oemOptions = (group: string): Oem[] => OEM[group] ?? [PLATFORM_OEM];
const outputFor = (group: string): OutputBasis => OUTPUT[group] ?? PLATFORM_OUT;
const causesFor = (group: string): [string, string][] => CAUSES[group] ?? PLATFORM_CAUSES;

const HURRICANE = "HUR-2025-08 Gulf hurricane shut-in";
const FREEZE = "WS-2025-01 Winter storm freeze";

export interface OgAsset {
  asset_id: string;
  name: string;
  unit: string;
  plant: string;
  group: string;
  status: string;
}

export function buildOgDataset(assets: OgAsset[]): SapDataset {
  const sites: SapSite[] = Object.entries(OG_SITES).map(([NAME1, s]) => ({ NAME1, ...s }));
  const werksOf = (plant: string) => OG_SITES[plant]?.WERKS ?? "OGXX";

  const materials = new Map<string, Row>();
  const plantMaterials = new Map<
    string,
    { MATNR: string; WERKS: string; INSTALLED_QTY: number; SPARES_ON_HAND: number }
  >();
  const equipment: SapEquipment[] = [];
  const meta = new Map<string, { group: string; status: string; oem: Oem; install: Date }>();

  assets.forEach((a, i) => {
    const r = rng(`${a.asset_id}:equi`);
    const group = OEM[a.group] ? a.group : "platform";
    const opts = oemOptions(group);
    const oem = at(opts, Math.floor(r() * opts.length));
    const matnr = `OG-${oem.code}`;
    const werks = werksOf(a.plant);
    const install = new Date(
      Date.UTC(2014 + Math.floor(r() * 11), Math.floor(r() * 12), 1 + Math.floor(r() * 27)),
    );
    const equnr = String(30000001 + i);
    meta.set(equnr, { group, status: a.status, oem, install });
    if (!materials.has(matnr))
      materials.set(matnr, {
        MATNR: matnr,
        MAKTX: `${oem.model} ${group}`,
        MANUFACTURER: oem.mfr,
        MFRPN: oem.model,
        EQUIP_CATEGORY: oem.cat,
      });
    const pmKey = `${matnr}|${werks}`;
    const pm = plantMaterials.get(pmKey) ?? {
      MATNR: matnr,
      WERKS: werks,
      INSTALLED_QTY: 0,
      SPARES_ON_HAND: 1 + Math.floor(r() * 4),
    };
    pm.INSTALLED_QTY += 1;
    plantMaterials.set(pmKey, pm);
    equipment.push({
      EQUNR: equnr,
      EQKTX: `${a.plant} ${a.unit} ${a.name}`,
      MATNR: matnr,
      WERKS: werks,
      ASSET_ID: a.asset_id,
      MANUFACTURER: oem.mfr,
      MFRPN: oem.model,
      INSTALL_DATE: iso(install),
      STATUS: "INST",
    });
  });

  // ---- warranties: OEM product warranty + LTSA / performance guarantees on critical trains
  const warranties: SapWarranty[] = [];
  let wn = 1;
  const status = (end: Date) => {
    const days = (end.getTime() - asOf.getTime()) / DAY;
    return days < 0 ? "EXPIRED" : days < 180 ? "EXPIRING" : "ACTIVE";
  };
  for (const e of equipment) {
    const m = meta.get(e.EQUNR)!;
    if (!m.oem.wty) continue;
    const r = rng(`${e.EQUNR}:wty`);
    // Recent warranty windows so the portfolio shows a realistic active / expiring / expired mix.
    const start = addDays(asOf, -Math.round(200 + r() * 1700));
    const term = 3 + Math.floor(r() * 3);
    const end = addDays(start, term * 365);
    warranties.push({
      WARR_ID: `EW-${String(wn++).padStart(5, "0")}`,
      EQUNR: e.EQUNR,
      WERKS: e.WERKS,
      MATNR: e.MATNR,
      WARR_TYPE: "PRODUCT",
      WARRANTOR: m.oem.mfr,
      COVERAGE: `${m.oem.wty} (parts and labor)`,
      START_DATE: iso(start),
      END_DATE: iso(end),
      TERM_YEARS: term,
      CONTRACT_VALUE: 0,
      STATUS: status(end),
    });
    if (m.group === "turbine" || m.group === "lng" || m.group === "generator") {
      const ls = addDays(start, 30);
      const lterm = m.group === "lng" ? 12 : 8;
      warranties.push({
        WARR_ID: `EW-${String(wn++).padStart(5, "0")}`,
        EQUNR: e.EQUNR,
        WERKS: e.WERKS,
        MATNR: e.MATNR,
        WARR_TYPE: "EXTENDED",
        WARRANTOR: m.oem.mfr,
        COVERAGE: "Long-term service agreement (LTSA): inspections, hot-section and overhaul",
        START_DATE: iso(ls),
        END_DATE: iso(addDays(ls, lterm * 365)),
        TERM_YEARS: lterm,
        CONTRACT_VALUE: Math.round((m.group === "lng" ? 18 : 6) * 1e6 * (0.8 + r() * 0.5)),
        STATUS: "ACTIVE",
      });
    }
    if (m.group === "turbine" || m.group === "lng" || m.group === "pump") {
      warranties.push({
        WARR_ID: `EW-${String(wn++).padStart(5, "0")}`,
        EQUNR: e.EQUNR,
        WERKS: e.WERKS,
        MATNR: e.MATNR,
        WARR_TYPE: "PERFORMANCE",
        WARRANTOR: m.oem.mfr,
        COVERAGE:
          m.group === "lng"
            ? "Production guarantee: rated tonnes per day"
            : "Availability guarantee: 97% rolling 12 months",
        START_DATE: iso(start),
        END_DATE: iso(addDays(start, 6 * 365)),
        TERM_YEARS: 6,
        CONTRACT_VALUE: Math.round(1.5e6 * (0.8 + r() * 0.6)),
        STATUS: status(addDays(start, 6 * 365)),
      });
    }
  }

  // ---- performance guarantee tracking (monthly shortfall vs guaranteed)
  const perf: SapPerf[] = [];
  for (const w of warranties.filter((x) => x.WARR_TYPE === "PERFORMANCE")) {
    const m = meta.get(w.EQUNR)!;
    const out = outputFor(m.group);
    const allowed = m.group === "lng" ? 4 : 3;
    for (let k = 23; k >= 0; k--) {
      const d = new Date(Date.UTC(2026, 8 - k, 1));
      const period = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      const r = rng(`${w.EQUNR}:${period}`);
      const expected = out.rate * 30 * (m.group === "turbine" ? 6 : 1);
      const stressed =
        m.status === "critical"
          ? 0.07
          : m.status === "watch"
            ? 0.045
            : hash(w.EQUNR) % 3 === 0
              ? 0.035
              : 0.015;
      const shortfall = Math.max(0, stressed * (0.4 + r() * 1.2) * 100);
      const actual = expected * (1 - shortfall / 100);
      perf.push({
        EQUNR: w.EQUNR,
        PERIOD: period,
        WERKS: w.WERKS,
        EXPECTED_MWH: r2(expected),
        ACTUAL_MWH: r2(actual),
        PERF_RATIO: r2(actual / expected),
        DEGR_CUM_PCT: r2(shortfall),
        GUAR_MAX_PCT: allowed,
        BREACH: shortfall > allowed ? "X" : "",
      });
    }
  }

  // ---- outages + cost postings
  const outages: SapOutage[] = [];
  const fin: SapFinLine[] = [];
  let on = 1;
  const addOutage = (
    e: SapEquipment,
    start: Date,
    type: string,
    cause: [string, string],
    hours: number,
    derate: number,
    open: boolean,
    storm = "",
  ) => {
    const m = meta.get(e.EQUNR)!;
    const out = outputFor(m.group);
    const r = rng(`${e.EQUNR}:${iso(start)}:fin`);
    const lost = r2(out.rate * (hours / 24) * (derate / 100));
    const year = start.getUTCFullYear();
    const id = `OUT-${year}-${String(on++).padStart(5, "0")}`;
    const end = open ? null : new Date(start.getTime() + hours * 3600e3);
    const lines: [string, string, number, string, string][] = [];
    const labor = Math.round(hours * (180 + r() * 220) * (type === "PLANNED" ? 6 : 3));
    const parts = Math.round((type === "PLANNED" ? 250000 : 60000) * (0.5 + r() * 1.8));
    lines.push(["REPAIR_LABOR", "Contract and internal maintenance labor", labor, "620000", ""]);
    lines.push(["REPAIR_PARTS", `Spares and materials (${m.oem.model})`, parts, "621000", ""]);
    lines.push([
      out.cat,
      `${out.cat === "LOST_PRODUCTION" ? "Deferred production" : "Lost throughput"} ${lost.toLocaleString("en-US")} ${out.uom}`,
      r2(lost * out.price),
      out.cat === "LOST_PRODUCTION" ? "411000" : "412000",
      "",
    ]);
    if ((m.group === "lng" || m.group === "port") && type === "FORCED" && r() > 0.4)
      lines.push([
        "CONTRACT_PENALTY",
        "Cargo / nomination shortfall penalty",
        Math.round(150000 + r() * 400000),
        "690000",
        "",
      ]);
    if (storm)
      lines.push([
        "INSURANCE_RECOV",
        `Named-storm insurance recovery (${storm.split(" ")[0]})`,
        -Math.round(lost * out.price * (0.25 + r() * 0.2)),
        "280000",
        `INS-${year}-${String(on).padStart(4, "0")}`,
      ]);
    const postDate = iso(end ?? asOf);
    lines.forEach(([cat, desc, amount, hkont, ref], i) =>
      fin.push({
        OUTAGE_ID: id,
        LINE_NO: String(i + 1).padStart(3, "0"),
        COST_CAT: cat,
        DESCRIPTION: desc,
        AMOUNT: amount,
        KOSTL: `CC-${e.WERKS}`,
        HKONT: hkont,
        POST_DATE: postDate,
        REF_DOC: ref,
      }),
    );
    const total = r2(lines.reduce((s, l) => s + l[2], 0));
    outages.push({
      OUTAGE_ID: id,
      EQUNR: e.EQUNR,
      WERKS: e.WERKS,
      ASSET_ID: e.ASSET_ID,
      OUTAGE_TYPE: type,
      CAUSE_CODE: cause[0],
      CAUSE_TEXT: cause[1],
      START_DATE: iso(start),
      END_DATE: end ? iso(end) : null,
      DURATION_H: r2(hours),
      DERATE_PCT: derate,
      LOST_OUTPUT: lost,
      OUTPUT_UOM: out.uom,
      PRICE_PER_UOM: out.price,
      TOTAL_IMPACT: total,
      STORM_EVENT: storm,
      STATUS: open ? "OPEN" : r() > 0.1 ? "SETTLED" : "CLOSED",
    });
    return id;
  };

  for (const e of equipment) {
    const m = meta.get(e.EQUNR)!;
    const r = rng(`${e.EQUNR}:out`);
    const causes = causesFor(m.group);
    const n = m.status === "critical" ? 4 : m.status === "watch" ? 3 : 1 + Math.floor(r() * 2);
    for (let k = 0; k < n; k++) {
      const start = addDays(asOf, -Math.round(20 + r() * 620));
      const planned = r() < 0.35;
      const derate = !planned && r() < 0.3 ? 30 + Math.round(r() * 40) : 100;
      const type = planned ? "PLANNED" : derate < 100 ? "DERATE" : "FORCED";
      const hours = planned ? 72 + r() * 360 : 8 + r() * 150;
      addOutage(
        e,
        start,
        type,
        planned ? ["TURNAROUND", "Planned inspection and maintenance"] : at(causes, k),
        hours,
        derate,
        false,
      );
    }
    // Currently-open outage on critical equipment so the page shows live exposure.
    if (m.status === "critical") {
      const start = addDays(asOf, -Math.round(2 + r() * 8));
      addOutage(
        e,
        start,
        "FORCED",
        at(causes, 0),
        (asOf.getTime() - start.getTime()) / 3600e3,
        100,
        true,
      );
    }
  }
  // Named-storm shut-ins across Gulf offshore and terminal assets; winter freeze at the coast.
  for (const e of equipment) {
    const m = meta.get(e.EQUNR)!;
    const r = rng(`${e.EQUNR}:storm`);
    if (
      ["OGWD", "OGMU", "OGLO"].includes(e.WERKS) &&
      ["platform", "wellhead", "port"].includes(m.group)
    )
      addOutage(
        e,
        new Date(Date.UTC(2025, 7, 26)),
        "WEATHER",
        ["HUR_SHUTIN", "Hurricane evacuation and production shut-in"],
        96 + r() * 72,
        100,
        false,
        HURRICANE,
      );
    if (["OGSP", "OGPA"].includes(e.WERKS) && r() > 0.5)
      addOutage(
        e,
        new Date(Date.UTC(2025, 0, 21)),
        "WEATHER",
        ["FREEZE", "Winter storm: frozen instrument lines and freeze-offs"],
        24 + r() * 48,
        60,
        false,
        FREEZE,
      );
  }

  // ---- warranty claims linked to forced outages on equipment under product warranty
  const claims: SapClaim[] = [];
  const MODES = [
    "Premature seal failure",
    "Bearing failure within warranty",
    "Control card fault",
    "Erosion beyond design allowance",
    "Manufacturing defect",
  ];
  const STATUSES = ["PAID", "PAID", "APPROVED", "IN_REVIEW", "SUBMITTED", "REJECTED"];
  let cn = 1;
  for (const o of outages.filter((x) => x.OUTAGE_TYPE === "FORCED").slice(0, 60)) {
    const w = warranties.find(
      (x) =>
        x.EQUNR === o.EQUNR &&
        x.WARR_TYPE === "PRODUCT" &&
        x.START_DATE <= o.START_DATE &&
        x.END_DATE >= o.START_DATE,
    );
    if (!w || claims.length >= 14) continue;
    const r = rng(`${o.OUTAGE_ID}:claim`);
    const parts = fin
      .filter(
        (f) =>
          f.OUTAGE_ID === o.OUTAGE_ID &&
          (f.COST_CAT === "REPAIR_PARTS" || f.COST_CAT === "REPAIR_LABOR"),
      )
      .reduce((s, f) => s + f.AMOUNT, 0);
    const st = at(STATUSES, Math.floor(r() * STATUSES.length));
    const claimAmt = Math.round(parts * (0.7 + r() * 0.3));
    const approved =
      st === "PAID" || st === "APPROVED" ? Math.round(claimAmt * (0.6 + r() * 0.4)) : 0;
    const paid = st === "PAID" ? approved : 0;
    const id = `WC-${String(cn++).padStart(5, "0")}`;
    claims.push({
      CLAIM_ID: id,
      WARR_ID: w.WARR_ID,
      EQUNR: o.EQUNR,
      WERKS: o.WERKS,
      CLAIM_DATE: iso(addDays(new Date(`${o.START_DATE}T00:00:00Z`), 5)),
      FAILURE_MODE: at(MODES, Math.floor(r() * MODES.length)),
      DESCRIPTION: o.CAUSE_TEXT,
      CLAIM_AMT: claimAmt,
      APPROVED_AMT: approved,
      PAID_AMT: paid,
      STATUS: st,
      OEM_RMA: `RMA-${w.WARRANTOR.slice(0, 3).toUpperCase()}-${10000 + Math.floor(r() * 89999)}`,
      OUTAGE_ID: o.OUTAGE_ID,
    });
    if (paid > 0) {
      const lineNo = fin.filter((f) => f.OUTAGE_ID === o.OUTAGE_ID).length + 1;
      fin.push({
        OUTAGE_ID: o.OUTAGE_ID,
        LINE_NO: String(lineNo).padStart(3, "0"),
        COST_CAT: "WARRANTY_RECOV",
        DESCRIPTION: `OEM warranty recovery ${w.WARR_TYPE}`,
        AMOUNT: -paid,
        KOSTL: `CC-${o.WERKS}`,
        HKONT: "281000",
        POST_DATE: o.END_DATE ?? AS_OF,
        REF_DOC: id,
      });
      o.TOTAL_IMPACT = r2(o.TOTAL_IMPACT - paid);
    }
  }

  outages.sort((a, b) => (a.START_DATE < b.START_DATE ? 1 : -1));
  const byName: Record<string, unknown[]> = {
    ZT001W: sites,
    ZMARA: [...materials.values()],
    ZMARC: [...plantMaterials.values()],
    ZEQUI: equipment,
    ZSOL_WARR: warranties,
    ZSOL_CLAIM: claims,
    ZSOL_PERF: perf,
    ZOUT_EVT: outages,
    ZOUT_FIN: fin,
  };
  return {
    solution: "og",
    system: SYSTEM,
    warrantyLabel: "Equipment Warranty",
    perfLabel: "Production / availability shortfall vs guaranteed maximum",
    perfUnit: "units",
    tables: tableInfo(byName),
    sites,
    materials: [...materials.values()],
    plantMaterials: [...plantMaterials.values()],
    equipment,
    warranties,
    claims,
    perf,
    outages,
    fin,
  };
}

async function loadOg(): Promise<SapDataset> {
  // @ts-expect-error sample.js is an untyped JS module
  const sample = (await import("@/report/lib/sample.js")) as unknown as {
    fleetAssets: () => OgAsset[];
  };
  return buildOgDataset(sample.fleetAssets());
}

let cache: Promise<SapDataset> | null = null;
let cacheFor: Solution | null = null;
export function loadSapDataset(solution: Solution): Promise<SapDataset> {
  if (!cache || cacheFor !== solution) {
    cacheFor = solution;
    cache = solution === "og" ? loadOg() : loadEnergy();
  }
  return cache;
}

// ------------------------------------------------------------------------------- analytics
export function daysUntil(date: string): number {
  return Math.round((new Date(`${date}T00:00:00Z`).getTime() - asOf.getTime()) / DAY);
}

export const COST_LABEL: Record<string, string> = {
  REPAIR_LABOR: "Repair labor",
  REPAIR_PARTS: "Repair parts",
  LOST_REVENUE: "Lost revenue",
  LOST_PRODUCTION: "Lost production",
  LOST_THROUGHPUT: "Lost throughput",
  REPLACEMENT_POWER: "Replacement power",
  CONTRACT_PENALTY: "Contract penalties",
  WARRANTY_RECOV: "Warranty recoveries",
  INSURANCE_RECOV: "Insurance recoveries",
};
