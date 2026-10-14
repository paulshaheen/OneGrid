import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Network, Search, Workflow } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  ASSETS,
  EDGES,
  CATEGORY_META,
  STATUS_COLOR,
  KIND_LABEL,
  REL_LABEL,
  type InfraAsset,
  type InfraCategory,
  type RelKind,
} from "@/lib/infra/infra-data";
import { InfraAssetDetail } from "./InfraAssetDetail";
import { KindIcon } from "./infra-ui";

const W = 1000;
const H = 720;

const REL_STYLE: Record<RelKind, { dash: string; width: number }> = {
  hosts: { dash: "", width: 2 },
  "runs-on": { dash: "", width: 2 },
  "depends-on": { dash: "", width: 1.6 },
  "connects-to": { dash: "4 4", width: 1.2 },
  "replicates-to": { dash: "2 5", width: 1.6 },
  "streams-to": { dash: "6 4", width: 1.6 },
  controls: { dash: "4 4", width: 1.2 },
  protects: { dash: "1 4", width: 1.2 },
  monitors: { dash: "2 4", width: 1 },
  "backs-up": { dash: "2 5", width: 1.2 },
};

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

function useForce(nodes: InfraAsset[], edges: typeof EDGES) {
  const state = useRef<{ key: string; P: Record<string, P>; pinned: string | null } | null>(null);
  const [, bump] = useState(0);

  const keyStr = nodes.map((n) => n.id).join(",");
  if (!state.current || state.current.key !== keyStr) {
    const N = nodes.length;
    const P: Record<string, P> = {};
    nodes.forEach((n, i) => {
      const a = (i / N) * Math.PI * 2;
      const r = Math.min(W, H) * 0.36;
      P[n.id] = {
        x: W / 2 + Math.cos(a) * r + (Math.random() - 0.5) * 40,
        y: H / 2 + Math.sin(a) * r + (Math.random() - 0.5) * 40,
        vx: 0,
        vy: 0,
      };
    });
    state.current = { key: keyStr, P, pinned: null };
  }

  const step = useCallback(() => {
    const st = state.current!;
    const { P, pinned } = st;
    const ids = Object.keys(P);
    const cx = W / 2;
    const cy = H / 2;
    const K_REP = 16000;
    const K_SPRING = 0.022;
    const L = 96;
    const K_GRAV = 0.014;
    const DAMP = 0.85;
    for (let i = 0; i < ids.length; i++) {
      const a = P[ids[i]!];
      if (!a) continue;
      for (let j = i + 1; j < ids.length; j++) {
        const b = P[ids[j]!];
        if (!b) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) d2 = 1;
        const f = K_REP / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }
    for (const e of edges) {
      const a = P[e.from];
      const b = P[e.to];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - L) * K_SPRING;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
    let maxv = 0;
    for (const id of ids) {
      const p = P[id];
      if (!p) continue;
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
      p.x = Math.max(40, Math.min(W - 40, p.x));
      p.y = Math.max(40, Math.min(H - 40, p.y));
      maxv = Math.max(maxv, Math.abs(p.vx) + Math.abs(p.vy));
    }
    return maxv;
  }, [edges]);

  useEffect(() => {
    let raf = 0;
    let cool = 0;
    const loop = () => {
      const maxv = step();
      bump((v) => (v + 1) % 1e9);
      cool = maxv < 0.6 ? cool + 1 : 0;
      if (cool < 50) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [step]);

  const reheat = useCallback(() => {
    const st = state.current!;
    for (const id in st.P) {
      const p = st.P[id];
      if (p) p.vx += (Math.random() - 0.5) * 10;
    }
    bump((v) => v + 1);
  }, []);

  return { P: state.current.P, reheat };
}

export function InfraTopology({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const { P, reheat } = useForce(ASSETS, EDGES);

  const degree = useMemo(() => {
    const d: Record<string, number> = {};
    for (const e of EDGES) {
      d[e.from] = (d[e.from] ?? 0) + 1;
      d[e.to] = (d[e.to] ?? 0) + 1;
    }
    return d;
  }, []);

  const focus = hoveredId ?? selectedId;
  const neighbors = useMemo(() => {
    if (!focus) return null;
    const set = new Set<string>([focus]);
    for (const e of EDGES) {
      if (e.from === focus) set.add(e.to);
      if (e.to === focus) set.add(e.from);
    }
    return set;
  }, [focus]);

  const query = q.trim().toLowerCase();
  const isMatch = (a: InfraAsset) =>
    !!query &&
    (a.name.toLowerCase().includes(query) || KIND_LABEL[a.kind].toLowerCase().includes(query));

  return (
    <div className="flex h-full flex-col gap-3 p-4 lg:flex-row">
      <div className="relative min-h-[360px] flex-1 overflow-hidden rounded-xl border bg-card">
        <div className="pointer-events-none absolute left-4 top-3 z-10">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Network className="size-4 text-primary" /> Asset Topology
          </div>
          <div className="text-[11px] text-muted-foreground">
            {ASSETS.length} assets · {EDGES.length} relationships · force-directed
          </div>
        </div>
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find…"
              className="w-36 rounded-md border bg-card/80 py-1 pl-7 pr-2 text-[11.5px] outline-none backdrop-blur focus:border-primary/50"
            />
          </div>
          <button
            onClick={reheat}
            className="rounded-md border bg-card/80 px-2 py-1 text-[11px] font-semibold text-muted-foreground backdrop-blur hover:bg-accent"
            title="Re-run layout"
          >
            <Workflow className="size-3.5" />
          </button>
        </div>

        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full"
          onClick={() => onSelect(null)}
        >
          {/* edges */}
          <g>
            {EDGES.map((e) => {
              const a = P[e.from];
              const b = P[e.to];
              if (!a || !b) return null;
              const active = !neighbors || (neighbors.has(e.from) && neighbors.has(e.to));
              const st = REL_STYLE[e.rel];
              return (
                <line
                  key={e.id}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={active ? "#7c8aa5" : "#3a4556"}
                  strokeWidth={st.width}
                  strokeDasharray={st.dash || undefined}
                  opacity={active ? 0.6 : 0.12}
                />
              );
            })}
          </g>
          {/* nodes */}
          <g>
            {ASSETS.map((a) => {
              const p = P[a.id];
              if (!p) return null;
              const cat = CATEGORY_META[a.category];
              const r = 9 + Math.min(8, (degree[a.id] ?? 0) * 1.1);
              const dim = (neighbors && !neighbors.has(a.id)) || (query && !isMatch(a));
              const sel = a.id === selectedId;
              return (
                <g
                  key={a.id}
                  transform={`translate(${p.x} ${p.y})`}
                  style={{
                    cursor: "pointer",
                    opacity: dim ? 0.22 : 1,
                    transition: "opacity 200ms",
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(a.id);
                  }}
                  onMouseEnter={() => setHoveredId(a.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <circle
                    r={r + 3.5}
                    fill="none"
                    stroke={STATUS_COLOR[a.status]}
                    strokeWidth={2}
                    opacity={0.9}
                  />
                  {sel && <circle r={r + 7} fill="none" stroke="#4f8cff" strokeWidth={2} />}
                  <circle r={r} fill={cat.color} stroke="#0b0f17" strokeWidth={1.5} />
                  {(sel || a.id === hoveredId || r > 13) && (
                    <text
                      y={r + 13}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={600}
                      fill="#dbe4f2"
                      style={{ paintOrder: "stroke", stroke: "#0b0f17", strokeWidth: 3 }}
                    >
                      {a.name}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {/* legend */}
        <div className="pointer-events-none absolute bottom-3 left-4 z-10 flex flex-wrap items-center gap-2.5 rounded-md border bg-card/80 px-3 py-2 text-[11px] backdrop-blur">
          {(Object.keys(CATEGORY_META) as InfraCategory[]).map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5 text-muted-foreground">
              <span
                className="inline-block size-2.5 rounded-full"
                style={{ background: CATEGORY_META[c].color }}
              />{" "}
              {CATEGORY_META[c].label}
            </span>
          ))}
        </div>
      </div>

      {/* right: detail or relationship key */}
      <div className="w-full shrink-0 lg:w-80">
        {selectedId ? (
          <div className="h-full lg:max-h-[calc(100vh-7rem)]">
            <InfraAssetDetail
              assetId={selectedId}
              onSelect={onSelect}
              onClose={() => onSelect(null)}
            />
          </div>
        ) : (
          <div className="space-y-3 rounded-xl border bg-card p-4">
            <div className="text-[13px] font-semibold text-foreground">Relationship legend</div>
            <p className="text-[11.5px] text-muted-foreground">
              The graph is the live CMDB of everything that runs OneGrid — app, data, network, OT
              and the Azure management planes — and how they connect. Hover a node to isolate its
              neighbourhood; click to inspect.
            </p>
            <div className="space-y-1.5">
              {(Object.keys(REL_STYLE) as RelKind[]).map((r) => (
                <div key={r} className="flex items-center gap-2">
                  <svg width={38} height={10}>
                    <line
                      x1={2}
                      y1={5}
                      x2={36}
                      y2={5}
                      stroke="#7c8aa5"
                      strokeWidth={REL_STYLE[r].width}
                      strokeDasharray={REL_STYLE[r].dash || undefined}
                    />
                  </svg>
                  <span className="text-[11.5px] capitalize text-foreground">{REL_LABEL[r]}</span>
                </div>
              ))}
            </div>
            <div className="border-t pt-2 text-[10.5px] text-muted-foreground">
              Node ring = health · size = number of relationships
            </div>
            <div className="border-t pt-2">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Most connected
              </div>
              {[...ASSETS]
                .sort((a, b) => (degree[b.id] ?? 0) - (degree[a.id] ?? 0))
                .slice(0, 5)
                .map((a) => (
                  <button
                    key={a.id}
                    onClick={() => onSelect(a.id)}
                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent"
                  >
                    <span
                      className="grid size-5 place-items-center rounded"
                      style={{
                        background: `${CATEGORY_META[a.category].color}1f`,
                        color: CATEGORY_META[a.category].color,
                      }}
                    >
                      <KindIcon kind={a.kind} className="size-3" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
                      {a.name}
                    </span>
                    <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">
                      {degree[a.id] ?? 0}
                    </span>
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
