import { useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/ops/AppShell";
import {
  buildFacilityModel,
  fleetAssets,
  sampleNarrative,
  useSampleRealtime,
} from "@/three/sample-facility";
import { counts, fmt, statusOf, timeAgo } from "@/three/report-compat";

// The Control Room renders the REAL report-app 3D twin (Facility.jsx): a holographic
// US globe with country geometry and plant pins, drill-in to per-unit textured PBR
// equipment trains, with per-second streaming historian values. The floating chrome
// (pulse bar, live-alert rail, breadcrumb, asset live panel) is ported from the
// report-app ControlRoom persona and reskinned to the OneGrid dark theme.

// Facility only reads theme.accent; the panel/heading/sub class strings drive our chrome.
const theme = {
  mode: "dark" as const,
  accent: "#3f96ff",
  three: {},
  heading: "text-slate-100",
  sub: "text-slate-400",
  panel:
    "rounded-xl border border-white/10 bg-[#0c1424]/85 backdrop-blur shadow-2xl shadow-black/40",
  panelSolid: "rounded-lg border border-white/5 bg-[#111b30]",
};

type Asset = {
  asset_id: string;
  name: string;
  plant: string;
  unit: string;
  category: string;
  status: string;
  running_tag: string;
  tags: { tag: string; role?: string; units?: string; desc?: string }[];
};

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ background: statusOf(status).color }}
    />
  );
}
function Divider() {
  return <span className="h-6 w-px bg-white/10" />;
}
function Stat({
  label,
  value,
  color,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  color?: string;
  sub?: string;
}) {
  return (
    <div className="text-center">
      <div className="text-sm font-bold tabular-nums" style={{ color }}>
        {value}
      </div>
      <div className={`text-[10px] uppercase tracking-wide ${theme.sub}`}>
        {label}
        {sub ? <span className="normal-case opacity-70"> {sub}</span> : null}
      </div>
    </div>
  );
}

export function ControlRoomPage() {
  const model = useMemo(() => buildFacilityModel(), []);
  const assets = useMemo(() => fleetAssets(), []) as Asset[];
  const narrative = useMemo(() => sampleNarrative(), []);
  const { connected, pulse, values, subscribe } = useSampleRealtime();

  const [sel, setSel] = useState<Asset | null>(null);
  const [activePlant, setActivePlant] = useState<string | null>(null);
  // Deep-link support: /app/control-room?plant=Riverton drills straight into a site.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search).get("plant");
    if (p) setActivePlant(p);
  }, []);
  const [tagQuery, setTagQuery] = useState("");
  // Facility.jsx pulls in three/drei/postprocessing — load it client-side only (SSR-safe).
  const [mod, setMod] = useState<{
    Facility: React.ComponentType<Record<string, unknown>>;
    plantGenTags: (p: unknown) => string[];
  } | null>(null);

  useEffect(() => {
    let ok = true;
    import("@/three/Facility.jsx").then((m) => {
      if (ok) setMod(m as never);
    });
    return () => {
      ok = false;
    };
  }, []);
  useEffect(() => {
    setTagQuery("");
  }, [sel?.asset_id]);

  const tags = useMemo(() => (sel?.tags || []).map((t) => t.tag), [sel]);
  const plantObj = (model?.plants || []).find((p: { name: string }) => p.name === activePlant);
  const genTags = useMemo(
    () => (activePlant && plantObj && mod?.plantGenTags ? mod.plantGenTags(plantObj) : []),
    [activePlant, plantObj, mod],
  );
  useEffect(() => {
    subscribe([...new Set([...tags, ...genTags])]);
  }, [tags, genTags, subscribe]);

  const enterPlant = (name: string) => {
    setSel(null);
    setActivePlant(name);
  };
  const backToSites = () => {
    setSel(null);
    setActivePlant(null);
  };

  const c = counts(assets || []);
  const alerts = (narrative?.briefing || []).slice(0, 12);
  const plantCrit = plantObj
    ? (plantObj.unitList || []).reduce(
        (s: number, u: { assets?: { status: string }[] }) =>
          s + (u.assets || []).filter((a) => a.status === "critical").length,
        0,
      )
    : 0;
  const Facility = mod?.Facility;

  return (
    <AppShell fullHeight>
      <div className="relative h-full min-h-[calc(100vh-3.5rem)] w-full overflow-hidden bg-[#0a1120]">
        <div className="absolute inset-0">
          {Facility ? (
            <Facility
              model={model}
              theme={theme}
              selected={sel?.asset_id}
              onSelect={(n: Asset & { kind?: string }) => setSel(n.kind === "asset" ? n : null)}
              activePlant={activePlant}
              onEnterPlant={enterPlant}
              values={values}
            />
          ) : (
            <div className="grid h-full place-items-center text-sm text-slate-400">
              Building facility twin…
            </div>
          )}
        </div>

        {/* top pulse bar */}
        <div className="pointer-events-none absolute left-4 right-4 top-4 z-30 flex items-center justify-between">
          <div className={`pointer-events-auto flex items-center gap-4 px-4 py-2.5 ${theme.panel}`}>
            <div className="flex items-center gap-2">
              <StatusDot status={pulse?.live ? "ok" : "watch"} />
              <span className={`text-sm font-semibold ${theme.heading}`}>
                {pulse?.live ? "LIVE" : "HISTORICAL"}
              </span>
            </div>
            <Divider />
            <Stat label="Healthy" value={c.ok ?? "—"} color="#2fd07a" />
            <Stat label="Watch" value={c.watch ?? "—"} color="#ffcc4d" />
            <Stat label="Critical" value={c.critical ?? "—"} color="#ff5470" />
            <Divider />
            <Stat label="Tags" value={pulse?.totalTags || model?.counts?.tags || "—"} />
            <Stat label="Events/min" value={pulse ? Math.round(pulse.eventsPerMin) : "—"} />
            <Stat label="Last data" value={pulse?.lastTs ? timeAgo(pulse.lastTs) : "—"} />
          </div>
          <div className={`pointer-events-auto flex items-center gap-2 px-3 py-2 ${theme.panel}`}>
            <span
              className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-rose-400"}`}
            />
            <span className={`text-xs ${theme.sub}`}>
              {connected ? "stream connected" : "reconnecting…"}
            </span>
          </div>
        </div>

        {/* breadcrumb */}
        <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2">
          <div
            className={`pointer-events-auto flex items-center gap-2 px-3 py-2 text-sm ${theme.panel}`}
          >
            <button
              onClick={backToSites}
              className={`font-semibold ${activePlant ? theme.sub : theme.heading} transition hover:opacity-80`}
            >
              US Fleet Map
            </button>
            {activePlant && (
              <>
                <span className={theme.sub}>›</span>
                <span
                  className="inline-flex items-center gap-1.5 font-semibold"
                  style={{ color: plantCrit ? "#ff5470" : "#2fd07a" }}
                >
                  <StatusDot status={plantCrit ? "critical" : "ok"} />
                  {activePlant}
                </span>
                <button
                  onClick={backToSites}
                  className="ml-1 rounded-md px-2 py-0.5 text-xs"
                  style={{
                    background: `${theme.accent}18`,
                    color: theme.accent,
                    border: `1px solid ${theme.accent}44`,
                  }}
                >
                  ← all sites
                </button>
              </>
            )}
          </div>
        </div>

        {/* live alert rail */}
        <div className="pointer-events-none absolute bottom-4 left-4 top-20 z-30 flex w-[300px] max-w-[80vw] flex-col">
          <div className={`pointer-events-auto flex flex-col overflow-hidden ${theme.panel}`}>
            <div
              className={`border-b border-white/5 px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest ${theme.sub}`}
            >
              Live Alert Stream
            </div>
            <div className="space-y-1.5 overflow-y-auto p-2">
              {alerts.map(
                (
                  a: { asset: string; level: string; severity: string; headline: string },
                  i: number,
                ) => (
                  <div key={i} className={`px-3 py-2 ${theme.panelSolid}`}>
                    <div className="flex items-center gap-1.5">
                      <StatusDot status={a.level === "critical" ? "critical" : "watch"} />
                      <span className={`truncate text-xs font-semibold ${theme.heading}`}>
                        {a.asset}
                      </span>
                      <span
                        className="ml-auto text-[10px] font-bold"
                        style={{ color: a.level === "critical" ? "#ff5470" : "#ffcc4d" }}
                      >
                        {a.severity}
                      </span>
                    </div>
                    <div className={`mt-0.5 line-clamp-2 text-[11px] ${theme.sub}`}>
                      {a.headline}
                    </div>
                  </div>
                ),
              )}
            </div>
          </div>
        </div>

        {/* asset live panel */}
        {sel && (
          <div
            className={`absolute bottom-4 right-4 top-20 z-30 flex w-[380px] max-w-[90vw] flex-col overflow-hidden ${theme.panel} duration-200 animate-in slide-in-from-right`}
          >
            <div className="flex items-start justify-between border-b border-white/10 p-4">
              <div>
                <div className="flex items-center gap-2">
                  <StatusDot status={sel.status} />
                  <h3 className={`font-bold ${theme.heading}`}>{sel.name}</h3>
                </div>
                <div className={`mt-0.5 text-xs ${theme.sub}`}>
                  {sel.plant} · {sel.unit} · {sel.category}
                </div>
              </div>
              <button
                onClick={() => setSel(null)}
                className={`text-2xl leading-none ${theme.sub} hover:opacity-70`}
              >
                ×
              </button>
            </div>
            <div className="space-y-2 overflow-y-auto p-3">
              <div className="relative pb-1">
                <input
                  value={tagQuery}
                  onChange={(e) => setTagQuery(e.target.value)}
                  placeholder="Search tags…"
                  className={`w-full rounded-lg px-3 py-1.5 text-sm text-slate-100 outline-none ${theme.panelSolid}`}
                />
              </div>
              {(() => {
                const q = tagQuery.trim().toLowerCase();
                const list = (sel.tags || []).filter(
                  (t) => !q || `${t.desc || ""} ${t.tag || ""}`.toLowerCase().includes(q),
                );
                return (
                  <>
                    <div className={`px-1 text-[11px] uppercase tracking-wider ${theme.sub}`}>
                      {q ? `${list.length} of ${tags.length}` : tags.length} live tags
                    </div>
                    {list.slice(0, 120).map((t) => {
                      const live = values[t.tag];
                      const v = live?.value;
                      const ts = live?.ts;
                      const streaming = !!live && connected && pulse?.live;
                      const justChanged = !!live && Date.now() - (live.changedAt || 0) < 3500;
                      return (
                        <div
                          key={t.tag}
                          className={`flex items-center gap-3 p-2.5 ${theme.panelSolid}`}
                          style={
                            justChanged
                              ? { boxShadow: `inset 0 0 0 1px ${theme.accent}66` }
                              : undefined
                          }
                        >
                          <div className="min-w-0 flex-1">
                            <div className={`truncate text-xs font-medium ${theme.heading}`}>
                              {t.desc || t.tag}
                            </div>
                            <div className={`truncate font-mono text-[10px] ${theme.sub}`}>
                              {t.tag}
                            </div>
                          </div>
                          <div className="text-right">
                            <div
                              className="flex items-center justify-end gap-1 text-lg font-bold tabular-nums"
                              style={{ color: streaming ? theme.accent : undefined }}
                            >
                              {v != null ? fmt(v, 2) : "—"}
                              {streaming && (
                                <span
                                  className={`h-1.5 w-1.5 rounded-full bg-emerald-400 ${justChanged ? "animate-ping" : "animate-pulse"}`}
                                />
                              )}
                            </div>
                            <div className={`text-[10px] ${theme.sub}`}>
                              {t.units || ""} {ts ? `· ${timeAgo(ts)}` : ""}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {q && list.length === 0 && (
                      <div className={`py-6 text-center text-sm ${theme.sub}`}>
                        No tags match “{tagQuery}”.
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        )}

        {/* hint */}
        {!sel && Facility && (
          <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2">
            <div className={`px-3 py-1.5 text-xs ${theme.sub}`}>
              {activePlant
                ? "drag to orbit · click lit equipment for live tags · grey = modeled (no telemetry)"
                : "drag to pan · scroll to zoom · click a plant pin to enter"}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
