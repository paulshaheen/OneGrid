import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  ShieldHalf,
  SkipForward,
} from "lucide-react";

import { AppShell, PageHeader } from "@/components/ops/AppShell";
import { StatCell } from "@/components/ops/RiskBadge";
import {
  COST_ASSUMPTIONS,
  CROWN_JEWELS,
  FAILURE_VS_TAMPER,
  READINESS,
  TABLETOP,
  TABLETOP_JEWEL,
  blastRadius,
  type BlastRadius,
} from "@/lib/cyber/cyber-data";
import { ASSET_BY_ID, KIND_LABEL, SITE_BY_ID, STATUS_COLOR, STATUS_LABEL } from "@/lib/infra/infra-data";
import { cn } from "@/lib/utils";

const STORE = "og.cyberReadiness";

const usd = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `$${Math.round(v / 1_000)}K` : `$${Math.round(v)}`;
const num = (v: number) => v.toLocaleString("en-US");

function loadChecklist(): Record<string, boolean> {
  const base = Object.fromEntries(READINESS.map((r) => [r.id, r.done]));
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(STORE) ?? "{}") };
  } catch {
    return base;
  }
}

export function CyberReadinessPage() {
  const radii = useMemo(() => CROWN_JEWELS.map(blastRadius).sort((a, b) => b.costPerHour - a.costPerHour), []);
  const [checks, setChecks] = useState<Record<string, boolean>>(() => Object.fromEntries(READINESS.map((r) => [r.id, r.done])));
  useEffect(() => setChecks(loadChecklist()), []);
  const toggle = (id: string) =>
    setChecks((c) => {
      const next = { ...c, [id]: !c[id] };
      try {
        localStorage.setItem(STORE, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  const retainer = !!checks["retainer"];
  const score = READINESS.filter((r) => checks[r.id]).length;

  const [selectedId, setSelectedId] = useState(radii[0]!.jewel.id);
  const selected = radii.find((r) => r.jewel.id === selectedId) ?? radii[0]!;
  const worst = radii[0]!;
  const [contractHours, setContractHours] = useState(48);

  const tabletopRef = useRef<HTMLDivElement>(null);
  const [autoplay, setAutoplay] = useState(false);
  useEffect(() => {
    if (window.location.hash === "#tabletop") {
      tabletopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setAutoplay(true);
    }
  }, []);

  return (
    <AppShell>
      <PageHeader
        title="Cyber readiness"
        description="If an attacker reached your operational network tonight, what would go dark, who would be affected, and how fast could you get expert help?"
        actions={
          <button
            onClick={() => {
              tabletopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              setAutoplay(true);
            }}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Play className="size-3.5" /> Run the tabletop
          </button>
        }
      />

      <div className="flex flex-col gap-3 p-4">
        <div className="rounded-md border bg-card px-3 py-1.5 text-xs">
          <span className="mr-2 rounded border border-violet-400/50 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-300">
            Illustrative
          </span>
          <span className="text-muted-foreground">
            Uses the synthetic IT/OT estate from Infrastructure. Customer counts, megawatts and costs are illustrative
            ({usd(COST_ASSUMPTIONS.perCustomerHour)} per customer-hour, {usd(COST_ASSUMPTIONS.replacementPowerPerMwh)}/MWh replacement power).
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatCell label="Readiness" value={`${score} / ${READINESS.length}`} sub="checklist items in place" tone={score >= 8 ? "normal" : score >= 6 ? "elevated" : "high"} />
          <StatCell label="Crown-jewel systems" value={CROWN_JEWELS.length} sub="IT and OT systems ranked by impact" />
          <StatCell label="Worst-case customers" value={num(worst.customers)} sub={`if ${worst.asset.name} is compromised`} tone="high" />
          <StatCell label="Generation at risk" value={`${worst.genMw} MW`} sub="needs manual control or trips" tone="high" />
          <StatCell label="Worst-case cost" value={`${usd(worst.costPerHour)}/h`} sub="customer and replacement-power cost" tone="critical" />
          <StatCell
            label="IR retainer"
            value={retainer ? "In place" : "Not in place"}
            sub={retainer ? "prioritized expert help" : "help starts after contracting"}
            tone={retainer ? "normal" : "critical"}
          />
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            <JewelTable radii={radii} selected={selected.jewel.id} onSelect={setSelectedId} />
            <BlastDetail r={selected} />
          </div>
          <div className="flex flex-col gap-3">
            <Checklist checks={checks} onToggle={toggle} />
            <RetainerCard retainer={retainer} r={selected} hours={contractHours} onHours={setContractHours} onToggle={() => toggle("retainer")} />
          </div>
        </div>

        <div ref={tabletopRef} id="tabletop" className="scroll-mt-4">
          <Tabletop retainer={retainer} hours={contractHours} autoplay={autoplay} onAutoplayDone={() => setAutoplay(false)} />
        </div>

        <MicrosoftHelp />
      </div>
    </AppShell>
  );
}

function JewelTable({ radii, selected, onSelect }: { radii: BlastRadius[]; selected: string; onSelect: (id: string) => void }) {
  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-baseline justify-between gap-2 px-3 pt-2">
        <span className="text-sm font-semibold">Crown jewels and blast radius</span>
        <span className="text-[11px] text-muted-foreground">What a compromise of each system would reach · click one for the path</span>
      </div>
      <table className="mt-1 w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-1 text-left">System</th>
            <th className="py-1 text-left">Sites lost</th>
            <th className="py-1 text-right">Customers</th>
            <th className="py-1 text-right">Generation</th>
            <th className="px-3 py-1 text-right">Cost / hour</th>
          </tr>
        </thead>
        <tbody>
          {radii.map((r) => (
            <tr
              key={r.jewel.id}
              onClick={() => onSelect(r.jewel.id)}
              className={cn("cursor-pointer border-t hover:bg-muted/40", selected === r.jewel.id && "bg-primary/10")}
            >
              <td className="px-3 py-1.5">
                <div className="flex items-center gap-1.5 font-medium">
                  <span className="size-2 rounded-full" style={{ background: STATUS_COLOR[r.asset.status] }} title={STATUS_LABEL[r.asset.status]} />
                  {r.jewel.role}
                </div>
                <div className="text-[10.5px] text-muted-foreground">
                  {r.asset.name} · {SITE_BY_ID.get(r.asset.siteId)?.name}
                </div>
              </td>
              <td className="py-1.5">
                {r.sites.length ? r.sites.map((s) => s.name.replace(" Substation", "").replace(" Generating Plant", " plant")).join(", ") : (
                  <span className="text-muted-foreground">{r.analyticsBlind ? "None; operators lose visibility" : "None"}</span>
                )}
              </td>
              <td className="num py-1.5 text-right">{r.customers ? num(r.customers) : "–"}</td>
              <td className="num py-1.5 text-right">{r.genMw ? `${r.genMw} MW` : "–"}</td>
              <td className="num px-3 py-1.5 text-right font-semibold">{r.costPerHour ? usd(r.costPerHour) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlastDetail({ r }: { r: BlastRadius }) {
  const control = r.reached.filter((x) => x.reach === "control" && x.depth > 0);
  const data = r.reached.filter((x) => x.reach === "data");
  const bySite = new Map<string, typeof control>();
  for (const x of control) bySite.set(x.asset.siteId, [...(bySite.get(x.asset.siteId) ?? []), x]);
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs">
      <div className="text-sm font-semibold">If {r.asset.name} is compromised</div>
      <div className="mt-0.5 text-muted-foreground">{r.jewel.why}</div>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[#ff4d5e]">Control lost ({control.length} systems)</div>
          {control.length === 0 && <div className="text-muted-foreground">No downstream control paths.</div>}
          {[...bySite.entries()].map(([site, xs]) => (
            <div key={site} className="mb-1">
              <span className="font-medium">{SITE_BY_ID.get(site)?.name}: </span>
              <span className="text-muted-foreground">{xs.map((x) => x.asset.name).join(", ")}</span>
            </div>
          ))}
        </div>
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[#f0b429]">Data can&apos;t be trusted ({data.length})</div>
          {data.length === 0 ? (
            <div className="text-muted-foreground">No downstream data paths.</div>
          ) : (
            <div className="text-muted-foreground">{data.map((x) => x.asset.name).join(", ")}</div>
          )}
          {r.sites.length > 0 && (
            <div className="mt-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">What goes dark</div>
              {r.sites.map((s) => (
                <div key={s.siteId}>
                  <span className="font-medium">{s.name}:</span> <span className="text-muted-foreground">{s.effect}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Checklist({ checks, onToggle }: { checks: Record<string, boolean>; onToggle: (id: string) => void }) {
  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-baseline justify-between px-3 pt-2">
        <span className="text-sm font-semibold">Readiness checklist</span>
        <span className="text-[11px] text-muted-foreground">click to update</span>
      </div>
      <div className="flex flex-col p-2">
        {READINESS.map((r) => {
          const on = !!checks[r.id];
          return (
            <button
              key={r.id}
              onClick={() => onToggle(r.id)}
              className={cn(
                "flex items-start gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted/40",
                r.retainer && "mt-1 border border-dashed",
                r.retainer && !on && "border-[#ff4d5e]/60 bg-[#ff4d5e]/5",
              )}
            >
              {on ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-[#2fbf71]" /> : <Circle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
              <span>
                <span className={cn("font-medium", !on && "text-muted-foreground")}>{r.label}</span>
                <span className="block text-[10.5px] text-muted-foreground">{r.detail}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RetainerCard({
  retainer,
  r,
  hours,
  onHours,
  onToggle,
}: {
  retainer: boolean;
  r: BlastRadius;
  hours: number;
  onHours: (h: number) => void;
  onToggle: () => void;
}) {
  const delayCost = r.costPerHour * hours;
  return (
    <div className={cn("rounded-md border px-3 py-2 text-xs", retainer ? "border-[#2fbf71]/50 bg-[#2fbf71]/5" : "border-primary/40 bg-card")}>
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        {retainer ? <ShieldCheck className="size-4 text-[#2fbf71]" /> : <ShieldHalf className="size-4 text-primary" />}
        Incident response retainer
      </div>
      <div className="mt-1.5 grid gap-2 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        <div className="rounded border bg-background/40 px-2 py-1.5">
          <div className="font-semibold text-[#2fbf71]">With a retainer</div>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-muted-foreground">
            <li>Call Microsoft Incident Response (DART) on an agreed path, with prioritized access.</li>
            <li>No emergency contracting or emergency-access fees mid-incident.</li>
            <li>Unused hours go to proactive work: compromise assessments and readiness exercises like this tabletop, coordinated by your CSAM.</li>
          </ul>
        </div>
        <div className="rounded border bg-background/40 px-2 py-1.5">
          <div className="font-semibold text-[#ff8a3d]">Without one</div>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-muted-foreground">
            <li>Help starts after emergency contracting, approvals and legal review.</li>
            <li>Every hour of delay is an hour the attacker keeps access.</li>
          </ul>
        </div>
      </div>
      <div className="mt-2 rounded border bg-background/40 px-2 py-1.5">
        <label className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Your estimate of contracting time without a retainer</span>
          <span className="num font-semibold">{hours} h</span>
        </label>
        <input type="range" min={4} max={120} step={4} value={hours} onChange={(e) => onHours(Number(e.target.value))} className="w-full accent-[var(--primary)]" />
        <div>
          If <span className="font-medium">{r.asset.name}</span> is the entry point, {r.costPerHour ? (
            <>
              that delay costs about <span className="num font-semibold text-[#ff8a3d]">{usd(delayCost)}</span> ({usd(r.costPerHour)}/h × {hours} h).
            </>
          ) : (
            <>operators lose visibility for that time, though no customers or generation are directly affected.</>
          )}
        </div>
      </div>
      <button onClick={onToggle} className="mt-2 text-[11px] text-primary hover:underline">
        {retainer ? "Mark the retainer as not in place" : "Mark the retainer as in place"}
      </button>
    </div>
  );
}

// ── Tabletop ─────────────────────────────────────────────────────────────────
const PATH_NODES: { id: string; x: number; y: number; label?: string }[] = [
  { id: "sensor-plant-steam", x: 70, y: 70 },
  { id: "plc-plant-1", x: 185, y: 30 },
  { id: "plc-plant-2", x: 185, y: 70 },
  { id: "rtu-plant", x: 185, y: 110 },
  { id: "scada-gw-plant", x: 290, y: 70 },
  { id: "historian-edge", x: 420, y: 70 },
  { id: "fw-dc", x: 540, y: 120, label: "IT/OT firewall" },
  { id: "vm-historian", x: 560, y: 30 },
  { id: "eventhouse-eh", x: 690, y: 30 },
  { id: "ca-onegrid", x: 810, y: 30, label: "OneGrid" },
];
const PATH_EDGES: [string, string][] = [
  ["plc-plant-1", "sensor-plant-steam"],
  ["plc-plant-2", "sensor-plant-steam"],
  ["scada-gw-plant", "plc-plant-1"],
  ["scada-gw-plant", "plc-plant-2"],
  ["scada-gw-plant", "rtu-plant"],
  ["historian-edge", "scada-gw-plant"],
  ["historian-edge", "vm-historian"],
  ["historian-edge", "fw-dc"],
  ["vm-historian", "eventhouse-eh"],
  ["eventhouse-eh", "ca-onegrid"],
];

const TONE: Record<string, string> = { info: "#4aa3ff", warn: "#f0b429", critical: "#ff4d5e", action: "#2fbf71" };

function Tabletop({ retainer, hours, autoplay, onAutoplayDone }: { retainer: boolean; hours: number; autoplay: boolean; onAutoplayDone: () => void }) {
  const [step, setStep] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const r = useMemo(() => blastRadius(CROWN_JEWELS.find((j) => j.id === TABLETOP_JEWEL)!), []);
  const done = step >= TABLETOP.length - 1;

  useEffect(() => {
    if (!autoplay) return;
    setStep(-1);
    setPlaying(true);
    onAutoplayDone();
  }, [autoplay, onAutoplayDone]);
  useEffect(() => {
    if (!playing) return;
    if (done) {
      setPlaying(false);
      return;
    }
    const t = window.setTimeout(() => setStep((s) => s + 1), step < 0 ? 400 : 2600);
    return () => window.clearTimeout(t);
  }, [playing, step, done]);

  const lit = new Set(TABLETOP.slice(0, step + 1).flatMap((s) => s.highlight));
  const current = step >= 0 ? TABLETOP[step] : null;
  const curLit = new Set(current?.highlight ?? []);

  return (
    <div className="rounded-md border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <div className="mr-auto">
          <div className="text-sm font-semibold">Tabletop: historian tampering at Bayou Generating Plant</div>
          <div className="text-[11px] text-muted-foreground">
            A scripted, presenter-safe exercise. It shows how OneGrid tells tampering from an instrument failure, and what happens next with and without a retainer.
          </div>
        </div>
        <button onClick={() => setPlaying((p) => !p)} disabled={done} className="flex items-center gap-1 rounded border px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40">
          {playing ? <Pause className="size-3" /> : <Play className="size-3" />} {playing ? "Pause" : step < 0 ? "Play" : "Resume"}
        </button>
        <button onClick={() => { setPlaying(false); setStep((s) => Math.min(TABLETOP.length - 1, s + 1)); }} disabled={done} className="flex items-center gap-1 rounded border px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40">
          <SkipForward className="size-3" /> Step
        </button>
        <button onClick={() => { setPlaying(false); setStep(-1); }} className="flex items-center gap-1 rounded border px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
          <RotateCcw className="size-3" /> Reset
        </button>
      </div>

      <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          <svg viewBox="0 0 880 150" className="w-full rounded border bg-background/40">
            {PATH_EDGES.map(([a, b]) => {
              const p = PATH_NODES.find((n) => n.id === a)!;
              const q = PATH_NODES.find((n) => n.id === b)!;
              const hot = lit.has(a) && lit.has(b);
              return <line key={a + b} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={hot ? "#ff4d5e" : "#3a4a63"} strokeWidth={hot ? 2 : 1.2} strokeDasharray={hot ? "" : "3 3"} />;
            })}
            {PATH_NODES.map((n) => {
              const a = ASSET_BY_ID.get(n.id);
              const hot = lit.has(n.id);
              const now = curLit.has(n.id);
              const color = now ? TONE[current!.tone] : hot ? "#ff4d5e" : "#5f7fa6";
              return (
                <g key={n.id}>
                  {now && <circle cx={n.x} cy={n.y} r={15} fill="none" stroke={color} strokeOpacity={0.5} strokeWidth={2} />}
                  <circle cx={n.x} cy={n.y} r={9} fill={hot ? `${color}33` : "#0f1726"} stroke={color} strokeWidth={2} />
                  <text x={n.x} y={n.y + 24} textAnchor="middle" fontSize={10} fill="#9fb0c8">
                    {n.label ?? a?.name ?? n.id}
                  </text>
                  {a && !n.label && (
                    <text x={n.x} y={n.y - 15} textAnchor="middle" fontSize={8.5} fill="#6d7f99">
                      {KIND_LABEL[a.kind]}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          <div className="flex flex-col gap-1">
            {TABLETOP.map((s, i) => (
              <button
                key={s.t}
                onClick={() => { setPlaying(false); setStep(i); }}
                className={cn(
                  "flex items-start gap-2 rounded border border-l-2 px-2 py-1 text-left text-xs transition-opacity",
                  i > step && "opacity-40",
                  i === step && "bg-muted/40",
                )}
                style={{ borderLeftColor: i <= step ? TONE[s.tone] : undefined }}
              >
                <span className="num w-10 shrink-0 text-muted-foreground">{s.t}</span>
                <span>
                  <span className="font-medium">{s.title}</span>
                  {i <= step && <span className="block text-[11px] text-muted-foreground">{s.body}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="rounded border">
            <div className="border-b px-2 py-1 text-xs font-semibold">Instrument failure or tampering?</div>
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-2 py-1 text-left">Signal</th>
                  <th className="py-1 text-left">Failure</th>
                  <th className="px-2 py-1 text-left">Tampering</th>
                </tr>
              </thead>
              <tbody>
                {FAILURE_VS_TAMPER.map((row) => (
                  <tr key={row.signal} className="border-t align-top">
                    <td className="px-2 py-1 font-medium">{row.signal}</td>
                    <td className="py-1 text-muted-foreground">{row.failure}</td>
                    <td className={cn("px-2 py-1", step >= 2 ? "text-foreground" : "text-muted-foreground")}>{row.tamper}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {done ? (
            <div className="grid gap-2 md:grid-cols-2">
              <Outcome
                good
                active={retainer}
                title="Retainer in place"
                lines={[
                  "02:45 · Call Microsoft Incident Response (DART) on the agreed path, with prioritized access.",
                  "Responders start scoping with the evidence already preserved.",
                  "No contracting decisions in the middle of the night.",
                ]}
              />
              <Outcome
                active={!retainer}
                title="No retainer"
                lines={[
                  "02:45 · Start emergency contracting: approvals, legal review, emergency-access fees.",
                  `Your estimate: about ${hours} h before outside help starts.`,
                  `Bayou exposure meanwhile: ${r.genMw} MW under manual control, about ${usd(r.costPerHour * hours)} at ${usd(r.costPerHour)}/h.`,
                ]}
              />
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded border border-dashed px-3 py-3 text-xs text-muted-foreground">
              <Clock className="size-4" /> Play the tabletop to see what happens next, with and without a retainer.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Outcome({ title, lines, active, good }: { title: string; lines: string[]; active: boolean; good?: boolean }) {
  const color = good ? "#2fbf71" : "#ff8a3d";
  return (
    <div className={cn("rounded border px-2 py-1.5 text-xs", !active && "opacity-60")} style={{ borderColor: `${color}80`, background: `${color}10` }}>
      <div className="flex items-center gap-1 font-semibold" style={{ color }}>
        {good ? <ShieldCheck className="size-3.5" /> : <AlertTriangle className="size-3.5" />} {title}
        {active && <span className="ml-auto rounded border px-1 text-[9.5px] font-medium uppercase tracking-wider text-muted-foreground">your checklist</span>}
      </div>
      {lines.map((l) => (
        <div key={l} className="mt-0.5 flex gap-1 text-muted-foreground">
          <ChevronRight className="mt-0.5 size-3 shrink-0" /> {l}
        </div>
      ))}
    </div>
  );
}

function MicrosoftHelp() {
  const items: [string, string][] = [
    ["Microsoft Incident Response (DART)", "Expert responders for active incidents. A Cybersecurity Incident Response retainer (CIR) gives prioritized access and puts the contract in place ahead of time."],
    ["Proactive assessments", "Compromise assessments and readiness exercises, including tabletops like this one; unused retainer hours can fund them."],
    ["Microsoft Defender for IoT", "Discovers OT devices and watches OT network traffic for threats."],
    ["Microsoft Sentinel and Security Copilot", "Correlate IT and OT alerts, and help analysts investigate and respond faster."],
  ];
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs">
      <div className="text-sm font-semibold">How Microsoft can help</div>
      <div className="mt-1.5 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {items.map(([h, b]) => (
          <div key={h} className="rounded border bg-background/40 px-2 py-1.5">
            <div className="font-medium">{h}</div>
            <div className="text-muted-foreground">{b}</div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 text-[10.5px] text-muted-foreground">Talk to your Microsoft account team about an incident response readiness plan.</div>
    </div>
  );
}
