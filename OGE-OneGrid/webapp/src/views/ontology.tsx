import { useState } from "react";
import { Share2 } from "lucide-react";

import { AppShell, PageHeader } from "@/components/ops/AppShell";

// P1: Ontology / knowledge graph, ported from the report-app "Ontology" persona and
// restyled to the OneGrid tokens. Static sample model until wired to the Fabric
// semantic model in P2.
type Node = { id: string; label: string; x: number; y: number; hub?: boolean };
const NODES: Node[] = [
  { id: "asset", label: "Asset", x: 400, y: 230, hub: true },
  { id: "platform", label: "Platform", x: 200, y: 120 },
  { id: "well", label: "Well", x: 600, y: 110 },
  { id: "pipeline", label: "Pipeline", x: 180, y: 345 },
  { id: "sensor", label: "Sensor", x: 620, y: 335 },
  { id: "anomaly", label: "Anomaly", x: 400, y: 405 },
  { id: "weather", label: "WeatherEvent", x: 95, y: 230 },
  { id: "forecast", label: "Forecast", x: 710, y: 225 },
  { id: "threshold", label: "Threshold", x: 505, y: 70 },
  { id: "alert", label: "Alert", x: 300, y: 70 },
];
const EDGES: [string, string, string][] = [
  ["asset", "platform", "is a"],
  ["asset", "well", "is a"],
  ["asset", "pipeline", "is a"],
  ["asset", "sensor", "instrumented by"],
  ["sensor", "anomaly", "raises"],
  ["anomaly", "alert", "triggers"],
  ["weather", "forecast", "has"],
  ["forecast", "threshold", "evaluated vs"],
  ["threshold", "alert", "breaches"],
  ["weather", "asset", "exposes"],
];
const DETAILS: Record<string, { columns: string[]; rels: string[] }> = {
  asset: {
    columns: ["asset_id", "name", "type", "region", "operator"],
    rels: [
      "Platform / Well / Pipeline (subtype)",
      "Sensor (instrumented by)",
      "WeatherEvent (exposed to)",
    ],
  },
  platform: { columns: ["asset_id", "water_depth", "slots"], rels: ["Asset (is a)"] },
  well: { columns: ["asset_id", "spud_date", "status"], rels: ["Asset (is a)"] },
  pipeline: { columns: ["asset_id", "diameter", "length_km"], rels: ["Asset (is a)"] },
  sensor: {
    columns: ["tag", "unit", "asset_id"],
    rels: ["Asset (instruments)", "Anomaly (raises)"],
  },
  anomaly: {
    columns: ["tag", "severity", "peak_abs_z"],
    rels: ["Sensor (raised by)", "Alert (triggers)"],
  },
  weather: {
    columns: ["event_id", "name", "category"],
    rels: ["Forecast (has)", "Asset (exposes)"],
  },
  forecast: {
    columns: ["cycle", "wind_mph", "cone_geom"],
    rels: ["WeatherEvent (of)", "Threshold (evaluated vs)"],
  },
  threshold: {
    columns: ["asset_type", "metric", "gate"],
    rels: ["Forecast (vs)", "Alert (breaches)"],
  },
  alert: {
    columns: ["alert_id", "severity", "message"],
    rels: ["Anomaly / Threshold (triggered by)"],
  },
};

export function OntologyPage() {
  const [sel, setSel] = useState("asset");
  const node = (id: string) => NODES.find((n) => n.id === id)!;
  const d = DETAILS[sel];

  return (
    <AppShell>
      <PageHeader
        title="Ontology"
        description="Knowledge graph generated from the Fabric semantic model — entities, keys and relationships."
      />
      <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-lg border bg-card p-2">
          <svg
            viewBox="0 0 800 460"
            className="h-[460px] w-full"
            preserveAspectRatio="xMidYMid meet"
          >
            {EDGES.map(([a, b, label], i) => {
              const na = node(a);
              const nb = node(b);
              const active = sel === a || sel === b;
              return (
                <g key={i}>
                  <line
                    x1={na.x}
                    y1={na.y}
                    x2={nb.x}
                    y2={nb.y}
                    stroke={active ? "var(--color-primary)" : "var(--color-border)"}
                    strokeWidth={active ? 2 : 1.25}
                  />
                  {active && (
                    <text
                      x={(na.x + nb.x) / 2}
                      y={(na.y + nb.y) / 2 - 4}
                      textAnchor="middle"
                      className="fill-muted-foreground text-[10px]"
                    >
                      {label}
                    </text>
                  )}
                </g>
              );
            })}
            {NODES.map((n) => {
              const selected = n.id === sel;
              return (
                <g key={n.id} onClick={() => setSel(n.id)} className="cursor-pointer">
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={n.hub ? 22 : 16}
                    fill={selected ? "var(--color-primary)" : "var(--color-surface-raised)"}
                    stroke={selected ? "var(--color-primary)" : "var(--color-border)"}
                    strokeWidth={2}
                  />
                  <text
                    x={n.x}
                    y={n.y + (n.hub ? 40 : 32)}
                    textAnchor="middle"
                    className={
                      selected
                        ? "fill-foreground text-[12px] font-semibold"
                        : "fill-muted-foreground text-[12px]"
                    }
                  >
                    {n.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border bg-card p-4">
            <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold">
              <Share2 className="size-4 text-primary" /> {node(sel).label}
            </div>
            <p className="text-[12px] text-muted-foreground">
              Entity from the OneGrid semantic model.
            </p>
            <div className="mt-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Columns
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {d.columns.map((c) => (
                <span
                  key={c}
                  className="num rounded border bg-surface-raised px-1.5 py-0.5 text-[11px]"
                >
                  {c}
                </span>
              ))}
            </div>
            <div className="mt-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Relationships
            </div>
            <ul className="mt-1 space-y-1 text-[12.5px] text-muted-foreground">
              {d.rels.map((r) => (
                <li key={r}>· {r}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border bg-card p-4 text-[12px] text-muted-foreground">
            Click any entity to inspect its keys and relationships, or ask the Copilot to explain a
            path through the model.
          </div>
        </div>
      </div>
    </AppShell>
  );
}
