import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RotateCw, Search, Share2, Sparkles } from "lucide-react";

import { AppShell } from "@/components/ops/AppShell";

// P1/fix: the real force-directed knowledge graph, ported from the report-app
// "Ontology" persona (dependency-free physics). Sample OneGrid model until wired
// to the Fabric semantic model in P2.

type Col = { name: string; type: string; key?: "pk" | "fk" };
type Node = {
  id: string;
  label: string;
  category: string;
  role?: "hub";
  table: string;
  source?: string;
  grain?: string;
  description: string;
  columns: Col[];
};
type Edge = { from: string; to: string; kind: "physical" | "logical" | "temporal"; label: string };

const CATS: Record<string, { label: string; color: string; blurb: string }> = {
  asset: {
    label: "Asset",
    color: "#3b82f6",
    blurb: "Physical estate — platforms, wells, pipelines.",
  },
  sensor: { label: "Sensor", color: "#2dd4bf", blurb: "Instrumentation on each asset." },
  telemetry: { label: "Telemetry", color: "#38bdf8", blurb: "Historian time-series." },
  ml: { label: "ML scoring", color: "#a986ff", blurb: "Anomaly + survival model output." },
  advisory: { label: "Advisory", color: "#f0b429", blurb: "Alerts, thresholds and advisories." },
  ops: { label: "Operations", color: "#3fd08a", blurb: "Work orders and response." },
  weather: { label: "Weather", color: "#60a5fa", blurb: "Events, forecasts and exposure." },
};

const NODES: Node[] = [
  {
    id: "asset",
    label: "Asset",
    category: "asset",
    role: "hub",
    table: "dim_asset",
    grain: "one row per asset",
    description: "The unifying entity — every platform, well and pipeline in the estate.",
    columns: [
      { name: "asset_id", type: "string", key: "pk" },
      { name: "name", type: "string" },
      { name: "type", type: "string" },
      { name: "region", type: "string" },
      { name: "operator", type: "string" },
    ],
  },
  {
    id: "platform",
    label: "Platform",
    category: "asset",
    table: "dim_platform",
    grain: "one row per platform",
    description: "Offshore production platform (Asset subtype).",
    columns: [
      { name: "asset_id", type: "string", key: "fk" },
      { name: "water_depth_m", type: "int" },
      { name: "slots", type: "int" },
    ],
  },
  {
    id: "well",
    label: "Well",
    category: "asset",
    table: "dim_well",
    grain: "one row per well",
    description: "Producing / injection well (Asset subtype).",
    columns: [
      { name: "asset_id", type: "string", key: "fk" },
      { name: "spud_date", type: "date" },
      { name: "status", type: "string" },
    ],
  },
  {
    id: "sensor",
    label: "Sensor",
    category: "sensor",
    table: "dim_sensor",
    grain: "one row per tag",
    description: "A measurement point instrumenting an asset.",
    columns: [
      { name: "tag", type: "string", key: "pk" },
      { name: "asset_id", type: "string", key: "fk" },
      { name: "unit", type: "string" },
    ],
  },
  {
    id: "telemetry",
    label: "Telemetry",
    category: "telemetry",
    table: "fact_telemetry",
    grain: "tag × timestamp",
    description: "Historian time-series streamed from sensors (Eventhouse / KQL).",
    columns: [
      { name: "tag", type: "string", key: "fk" },
      { name: "ts", type: "timestamp" },
      { name: "value", type: "double" },
    ],
  },
  {
    id: "anomaly",
    label: "Anomaly",
    category: "ml",
    table: "fact_anomaly",
    grain: "tag × timestamp",
    description: "Statistical anomalies detected in telemetry.",
    columns: [
      { name: "tag", type: "string", key: "fk" },
      { name: "ts", type: "timestamp" },
      { name: "severity", type: "string" },
      { name: "peak_abs_z", type: "double" },
    ],
  },
  {
    id: "survival",
    label: "Survival Score",
    category: "ml",
    table: "fact_survival",
    grain: "asset × horizon",
    description: "Long-term survival / stop-probability model output.",
    columns: [
      { name: "asset_id", type: "string", key: "fk" },
      { name: "horizon", type: "string" },
      { name: "surv_prob", type: "double" },
    ],
  },
  {
    id: "advisory",
    label: "Advisory",
    category: "advisory",
    table: "fact_advisory",
    grain: "one row per advisory",
    description: "An alert raised from an anomaly or a breached threshold.",
    columns: [
      { name: "advisory_id", type: "string", key: "pk" },
      { name: "asset_id", type: "string", key: "fk" },
      { name: "severity", type: "string" },
      { name: "message", type: "string" },
    ],
  },
  {
    id: "threshold",
    label: "Threshold",
    category: "advisory",
    table: "dim_threshold",
    grain: "asset-type × metric",
    description: "Per-asset-class trigger gates evaluated against the forecast.",
    columns: [
      { name: "asset_type", type: "string" },
      { name: "metric", type: "string" },
      { name: "gate", type: "double" },
    ],
  },
  {
    id: "workorder",
    label: "Work Order",
    category: "ops",
    table: "fact_work_order",
    grain: "one row per work order",
    description: "Maintenance work driven by survival + advisories.",
    columns: [
      { name: "wo_id", type: "string", key: "pk" },
      { name: "asset_id", type: "string", key: "fk" },
      { name: "status", type: "string" },
    ],
  },
  {
    id: "weather",
    label: "Weather Event",
    category: "weather",
    table: "dim_weather_event",
    grain: "one row per named system",
    description: "A named storm / severe-weather system.",
    columns: [
      { name: "event_id", type: "string", key: "pk" },
      { name: "name", type: "string" },
      { name: "category", type: "int" },
    ],
  },
  {
    id: "forecast",
    label: "Forecast",
    category: "weather",
    table: "fact_forecast",
    grain: "event × cycle",
    description: "Forecast cycles with wind, cone and uncertainty.",
    columns: [
      { name: "event_id", type: "string", key: "fk" },
      { name: "cycle", type: "timestamp" },
      { name: "wind_mph", type: "int" },
    ],
  },
];

const EDGES: Edge[] = [
  { from: "platform", to: "asset", kind: "physical", label: "is a" },
  { from: "well", to: "asset", kind: "physical", label: "is a" },
  { from: "sensor", to: "asset", kind: "physical", label: "instruments" },
  { from: "telemetry", to: "sensor", kind: "physical", label: "streams from" },
  { from: "anomaly", to: "telemetry", kind: "logical", label: "detected in" },
  { from: "survival", to: "asset", kind: "physical", label: "scores" },
  { from: "advisory", to: "asset", kind: "physical", label: "raised for" },
  { from: "advisory", to: "anomaly", kind: "logical", label: "from" },
  { from: "workorder", to: "asset", kind: "physical", label: "on" },
  { from: "workorder", to: "advisory", kind: "logical", label: "resolves" },
  { from: "forecast", to: "weather", kind: "physical", label: "of" },
  { from: "weather", to: "asset", kind: "logical", label: "exposes" },
  { from: "threshold", to: "forecast", kind: "temporal", label: "evaluated vs" },
  { from: "advisory", to: "threshold", kind: "logical", label: "breaches" },
];

const EDGE_STYLE = {
  physical: { dash: "", width: 1.8, opacity: 0.5 },
  logical: { dash: "5 4", width: 1.4, opacity: 0.38 },
  temporal: { dash: "2 4", width: 1.2, opacity: 0.28 },
};

const cat = (k: string) =>
  CATS[k] ?? { label: k, color: "var(--color-muted-foreground)", blurb: "" };

type Pos = { x: number; y: number; vx: number; vy: number };

function useForceGraph(nodes: Node[], edges: Edge[], W: number, H: number) {
  const state = useRef<{ P: Record<string, Pos>; pinned: string | null } | null>(null);
  const [, force] = useState(0);

  if (!state.current) {
    const N = nodes.length;
    const cx = W / 2;
    const cy = H / 2;
    const P: Record<string, Pos> = {};
    nodes.forEach((n, i) => {
      const a = (i / N) * Math.PI * 2;
      const r = Math.min(W, H) * 0.34;
      P[n.id] = {
        x: cx + Math.cos(a) * r + (Math.random() - 0.5) * 30,
        y: cy + Math.sin(a) * r + (Math.random() - 0.5) * 30,
        vx: 0,
        vy: 0,
      };
    });
    state.current = { P, pinned: null };
  }

  const step = useCallback(() => {
    const { P, pinned } = state.current!;
    const ids = Object.keys(P);
    const cx = W / 2;
    const cy = H / 2;
    const K_REP = 42000,
      K_SPRING = 0.015,
      L = 200,
      K_GRAV = 0.015,
      DAMP = 0.82;
    for (let i = 0; i < ids.length; i++) {
      const a = P[ids[i]!]!;
      for (let j = i + 1; j < ids.length; j++) {
        const b = P[ids[j]!]!;
        const dx = a.x - b.x,
          dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) d2 = 1;
        const f = K_REP / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f,
          fy = (dy / d) * f;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }
    for (const e of edges) {
      const a = P[e.from],
        b = P[e.to];
      if (!a || !b) continue;
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const len = e.kind === "temporal" ? L * 1.3 : L;
      const f = (d - len) * K_SPRING;
      const fx = (dx / d) * f,
        fy = (dy / d) * f;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
    let maxv = 0;
    for (const id of ids) {
      const p = P[id]!;
      p.vx += (cx - p.x) * K_GRAV;
      p.vy += (cy - p.y) * K_GRAV;
      p.vx *= DAMP;
      p.vy *= DAMP;
      if (id === pinned) {
        p.vx = 0;
        p.vy = 0;
        continue;
      }
      p.x += p.vx;
      p.y += p.vy;
      p.x = Math.max(60, Math.min(W - 60, p.x));
      p.y = Math.max(40, Math.min(H - 40, p.y));
      maxv = Math.max(maxv, Math.abs(p.vx) + Math.abs(p.vy));
    }
    return maxv;
  }, [edges, W, H]);

  useEffect(() => {
    let raf = 0;
    let cool = 0;
    const loop = () => {
      const maxv = step();
      force((v) => (v + 1) % 1000000);
      if (maxv < 0.4) cool++;
      else cool = 0;
      if (cool < 40) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [step]);

  const reheat = useCallback(() => {
    for (const id in state.current!.P) state.current!.P[id]!.vx += (Math.random() - 0.5) * 6;
    force((v) => v + 1);
  }, []);

  return {
    P: state.current.P,
    setPinned: (id: string | null) => {
      state.current!.pinned = id;
    },
    reheat,
  };
}

const nodeSize = (n: Node) => (n.role === "hub" ? 30 : 22);

export function OntologyPage() {
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    id?: string;
    moved?: boolean;
    pan?: boolean;
    sx?: number;
    sy?: number;
    ox?: number;
    oy?: number;
  } | null>(null);
  const W = 1000;
  const H = 640;

  const { P, setPinned, reheat } = useForceGraph(NODES, EDGES, W, H);
  const byId = useMemo(() => Object.fromEntries(NODES.map((n) => [n.id, n])), []);
  const neighbors = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    for (const e of EDGES) {
      (m[e.from] ||= new Set()).add(e.to);
      (m[e.to] ||= new Set()).add(e.from);
    }
    return m;
  }, []);

  const matches = useCallback(
    (n: Node) => {
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        n.label.toLowerCase().includes(q) ||
        n.id.includes(q) ||
        n.columns.some((c) => c.name.toLowerCase().includes(q))
      );
    },
    [query],
  );

  const selNode = sel ? byId[sel] : null;
  const focusId = sel || hover;
  const isDim = (id: string) => {
    if (!focusId) return false;
    return id !== focusId && !neighbors[focusId]?.has(id);
  };

  const toWorld = (clientX: number, clientY: number) => {
    const r = wrapRef.current!.getBoundingClientRect();
    const sx = ((clientX - r.left) / r.width) * W;
    const sy = ((clientY - r.top) / r.height) * H;
    return { x: (sx - view.x) / view.k, y: (sy - view.y) / view.k };
  };
  const onWheel = (e: React.WheelEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    const mx = ((e.clientX - r.left) / r.width) * W;
    const my = ((e.clientY - r.top) / r.height) * H;
    const k2 = Math.max(0.5, Math.min(2.4, view.k * (e.deltaY < 0 ? 1.1 : 0.9)));
    setView((v) => ({ k: k2, x: mx - (mx - v.x) * (k2 / v.k), y: my - (my - v.y) * (k2 / v.k) }));
  };
  const onPointerDown = (e: React.PointerEvent, id?: string) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (id) {
      setPinned(id);
      dragRef.current = { id, moved: false };
    } else dragRef.current = { pan: true, sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.pan) {
      const r = wrapRef.current!.getBoundingClientRect();
      const dx = ((e.clientX - d.sx!) / r.width) * W;
      const dy = ((e.clientY - d.sy!) / r.height) * H;
      setView((v) => ({ ...v, x: d.ox! + dx, y: d.oy! + dy }));
    } else if (d.id) {
      const w = toWorld(e.clientX, e.clientY);
      const pd = P[d.id];
      if (pd) {
        pd.x = w.x;
        pd.y = w.y;
        pd.vx = 0;
        pd.vy = 0;
        d.moved = true;
      }
    }
  };
  const onPointerUp = (id?: string) => {
    const d = dragRef.current;
    if (d && d.id && !d.moved) setSel((s) => (s === d.id ? null : d.id!));
    if (id) setPinned(null);
    dragRef.current = null;
  };

  const askAI = (msg: string) =>
    window.dispatchEvent(new CustomEvent("onegrid-ask", { detail: { message: msg } }));

  return (
    <AppShell fullHeight>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b bg-surface px-5 py-3">
          <div>
            <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <Share2 className="size-5 text-primary" /> Ontology
            </div>
            <div className="text-[11px] text-muted-foreground">
              {NODES.length} entities · {EDGES.length} relationships · sourced from the Fabric
              semantic model
            </div>
          </div>
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search entities or columns…"
              className="w-56 rounded-lg border bg-surface-raised py-1.5 pl-8 pr-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <button
            onClick={() =>
              askAI(
                selNode
                  ? `Explain the "${selNode.label}" entity (table ${selNode.table}) and what I can answer by joining it.`
                  : "Give me an overview of the OneGrid knowledge graph and the most valuable questions I can ask across it.",
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-foreground"
          >
            <Sparkles className="size-4" />{" "}
            {selNode ? `Ask AI about ${selNode.label}` : "Ask AI about the model"}
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <div
            ref={wrapRef}
            className="relative min-w-0 flex-1 touch-none overflow-hidden"
            style={{
              background:
                "radial-gradient(120% 90% at 50% 10%, color-mix(in oklch, var(--color-surface-raised) 60%, transparent) 0%, var(--color-background) 70%)",
            }}
            onWheel={onWheel}
            onPointerDown={(e) => onPointerDown(e)}
            onPointerMove={onPointerMove}
            onPointerUp={() => onPointerUp()}
          >
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="xMidYMid meet"
              style={{ cursor: dragRef.current?.pan ? "grabbing" : "grab" }}
            >
              <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
                {EDGES.map((e, i) => {
                  const a = P[e.from];
                  const b = P[e.to];
                  if (!a || !b) return null;
                  const st = EDGE_STYLE[e.kind];
                  const active = !!focusId && (e.from === focusId || e.to === focusId);
                  const dim = !!focusId && !active;
                  const col = active ? "var(--color-primary)" : "var(--color-muted-foreground)";
                  return (
                    <g key={i} opacity={dim ? 0.12 : 1}>
                      <line
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke={col}
                        strokeWidth={active ? st.width + 0.8 : st.width}
                        strokeDasharray={st.dash}
                        opacity={active ? 0.9 : st.opacity}
                      />
                      {active && (
                        <text
                          x={(a.x + b.x) / 2}
                          y={(a.y + b.y) / 2 - 3}
                          textAnchor="middle"
                          fontSize="9"
                          fontWeight="600"
                          fill={col}
                          style={{ pointerEvents: "none" }}
                        >
                          {e.label}
                        </text>
                      )}
                    </g>
                  );
                })}
                {NODES.map((n) => {
                  const p = P[n.id];
                  if (!p) return null;
                  const c = cat(n.category).color;
                  const r = nodeSize(n);
                  const dim = isDim(n.id) || !matches(n);
                  const isSel = sel === n.id;
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${p.x},${p.y})`}
                      opacity={dim ? 0.22 : 1}
                      style={{ cursor: "pointer" }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        onPointerDown(e, n.id);
                      }}
                      onPointerUp={(e) => {
                        e.stopPropagation();
                        onPointerUp(n.id);
                      }}
                      onPointerEnter={() => setHover(n.id)}
                      onPointerLeave={() => setHover(null)}
                    >
                      <circle
                        r={r + (isSel ? 6 : 0)}
                        fill="var(--color-card)"
                        stroke={c}
                        strokeWidth={isSel ? 3 : 2}
                      />
                      <circle r={r} fill={c} opacity={0.16} />
                      {n.role === "hub" && <circle r={r - 6} fill={c} opacity={0.22} />}
                      <text
                        textAnchor="middle"
                        y={r + 13}
                        fontSize="11"
                        fontWeight="700"
                        fill="var(--color-foreground)"
                        style={{ pointerEvents: "none" }}
                      >
                        {n.label}
                      </text>
                      <text
                        textAnchor="middle"
                        y="4"
                        fontSize="9"
                        fontWeight="700"
                        fill={c}
                        style={{ pointerEvents: "none" }}
                      >
                        {cat(n.category).label.slice(0, 3).toUpperCase()}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>

            {/* legend */}
            <div className="absolute bottom-3 left-3 flex max-w-[340px] flex-col gap-1.5 rounded-xl border bg-card/80 p-2.5 text-[10px] backdrop-blur">
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {Object.entries(CATS).map(([k, c]) => (
                  <span key={k} className="inline-flex items-center gap-1 text-muted-foreground">
                    <span className="size-2.5 rounded-full" style={{ background: c.color }} />
                    {c.label}
                  </span>
                ))}
              </div>
            </div>

            {/* controls */}
            <div className="absolute right-3 top-3 flex flex-col gap-1">
              <button
                onClick={() => setView((v) => ({ ...v, k: Math.min(2.4, v.k * 1.15) }))}
                className="grid size-8 place-items-center rounded-lg border bg-card/80 font-bold text-muted-foreground hover:text-foreground"
              >
                +
              </button>
              <button
                onClick={() => setView((v) => ({ ...v, k: Math.max(0.5, v.k * 0.87) }))}
                className="grid size-8 place-items-center rounded-lg border bg-card/80 font-bold text-muted-foreground hover:text-foreground"
              >
                −
              </button>
              <button
                onClick={() => {
                  setView({ x: 0, y: 0, k: 1 });
                  reheat();
                }}
                title="Re-layout"
                className="grid size-8 place-items-center rounded-lg border bg-card/80 text-muted-foreground hover:text-foreground"
              >
                <RotateCw className="size-4" />
              </button>
            </div>
          </div>

          {/* detail panel */}
          <div className="w-80 shrink-0 overflow-y-auto border-l bg-card p-4">
            {!selNode ? (
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  Click any entity to inspect its columns and relationships, drag to rearrange, or
                  ask the AI about it.
                </p>
                <div className="space-y-1.5">
                  {Object.entries(CATS).map(([k, c]) => (
                    <div key={k} className="flex items-start gap-2">
                      <span
                        className="mt-1 size-2.5 shrink-0 rounded-full"
                        style={{ background: c.color }}
                      />
                      <div>
                        <b style={{ color: c.color }}>{c.label}</b>{" "}
                        <span className="opacity-80">— {c.blurb}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                    style={{
                      background: `${cat(selNode.category).color}22`,
                      color: cat(selNode.category).color,
                    }}
                  >
                    {cat(selNode.category).label}
                  </span>
                  {selNode.role === "hub" && (
                    <span className="text-[10px] text-muted-foreground">hub</span>
                  )}
                </div>
                <div className="text-lg font-bold">{selNode.label}</div>
                <div className="num text-[11px] text-muted-foreground">{selNode.table}</div>
                <div className="mt-2 text-[12px]">{selNode.description}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">Grain: {selNode.grain}</div>

                <div className="mb-1.5 mt-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Relationships
                </div>
                <div className="space-y-1">
                  {EDGES.filter((e) => e.from === selNode.id || e.to === selNode.id).map((e, i) => {
                    const out = e.from === selNode.id;
                    const other = out ? e.to : e.from;
                    return (
                      <button
                        key={i}
                        onClick={() => setSel(other)}
                        className="flex w-full items-center gap-1.5 rounded-lg border bg-surface-raised px-2 py-1.5 text-left text-[12px] hover:border-primary"
                      >
                        <span className="text-muted-foreground opacity-70">{out ? "→" : "←"}</span>
                        <span>{byId[other]?.label}</span>
                        <span className="ml-auto text-[10px] text-muted-foreground">{e.label}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="mb-1.5 mt-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Columns ({selNode.columns.length})
                </div>
                <div className="space-y-0.5">
                  {selNode.columns.map((c) => (
                    <div key={c.name} className="flex items-center gap-2 py-0.5 text-[12px]">
                      <span className="num">{c.name}</span>
                      {c.key === "pk" && (
                        <span
                          className="rounded px-1 text-[9px] font-bold"
                          style={{ background: "#f0b42922", color: "#e0a800" }}
                        >
                          PK
                        </span>
                      )}
                      {c.key === "fk" && (
                        <span className="rounded bg-primary/20 px-1 text-[9px] font-bold text-primary">
                          FK
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-muted-foreground">{c.type}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
