import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Circle,
  ClipboardCopy,
  Clock,
  ExternalLink,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Send,
  ShieldCheck,
  ShieldHalf,
  SkipForward,
  UserCheck,
} from "lucide-react";

import { AppShell, PageHeader } from "@/components/ops/AppShell";
import { StatCell } from "@/components/ops/RiskBadge";
import {
  ACTIONS,
  CIR_DATASHEET,
  CIR_DATASHEET_URL,
  COST_ASSUMPTIONS,
  CROWN_JEWELS,
  HYPOTHESES,
  READINESS,
  RETAINER_PRESETS,
  RETAINER_STATUS_LABEL,
  TABLETOP,
  TABLETOP_JEWEL,
  blastRadius,
  retainerGaps,
  type BlastRadius,
  type RetainerRecord,
  type RetainerStatus,
} from "@/lib/cyber/cyber-data";
import { ASSET_BY_ID, KIND_LABEL, SITE_BY_ID, STATUS_COLOR, STATUS_LABEL } from "@/lib/infra/infra-data";
import { cn } from "@/lib/utils";

const CHECKS_KEY = "og.cyberReadiness";
const RETAINER_KEY = "og.cyberRetainer";

const usd = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `$${Math.round(v / 1_000)}K` : `$${Math.round(v)}`;
const num = (v: number) => v.toLocaleString("en-US");
const mdy = (iso: string) => {
  if (!iso) return "not recorded";
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

const isRetainerReady = (r: RetainerRecord) => r.status === "active" && !!r.engagementSteps.trim();

export function CyberReadinessPage() {
  const radii = useMemo(() => CROWN_JEWELS.map(blastRadius).sort((a, b) => b.costPerHour - a.costPerHour), []);
  const defaults = useMemo(() => Object.fromEntries(READINESS.map((r) => [r.id, r.done])), []);
  const [checks, setChecks] = useState<Record<string, boolean>>(defaults);
  const [record, setRecord] = useState<RetainerRecord>(RETAINER_PRESETS.none);
  useEffect(() => {
    setChecks(readJson(CHECKS_KEY, defaults));
    setRecord(readJson(RETAINER_KEY, RETAINER_PRESETS.none));
  }, [defaults]);
  const toggle = (id: string) =>
    setChecks((c) => {
      const next = { ...c, [id]: !c[id] };
      writeJson(CHECKS_KEY, next);
      return next;
    });
  const saveRecord = (r: RetainerRecord) => {
    setRecord(r);
    writeJson(RETAINER_KEY, r);
  };
  const ready = isRetainerReady(record);
  const score = READINESS.filter((r) => (r.retainer ? ready : checks[r.id])).length;

  const [selectedId, setSelectedId] = useState(radii[0]!.jewel.id);
  const selected = radii.find((r) => r.jewel.id === selectedId) ?? radii[0]!;
  const worst = radii[0]!;
  const [delayHours, setDelayHours] = useState(48);

  const tabletopRef = useRef<HTMLDivElement>(null);
  const recordRef = useRef<HTMLDivElement>(null);
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
            Synthetic exercise
          </span>
          <span className="font-medium">No Microsoft engagement is initiated from OneGrid.</span>{" "}
          <span className="text-muted-foreground">
            Systems come from the synthetic IT/OT estate in Infrastructure. Exposure is modeled, not a loss estimate: {usd(COST_ASSUMPTIONS.perCustomerHour)} per
            customer-hour and {usd(COST_ASSUMPTIONS.replacementPowerPerMwh)}/MWh replacement power.
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatCell label="Readiness" value={`${score} / ${READINESS.length}`} sub="checklist items in place" tone={score >= 8 ? "normal" : score >= 6 ? "elevated" : "high"} />
          <StatCell label="Crown-jewel systems" value={CROWN_JEWELS.length} sub="IT and OT systems ranked by exposure" />
          <StatCell label="Customers exposed" value={num(worst.customers)} sub={`modeled, if ${worst.asset.name} is compromised`} tone="high" />
          <StatCell label="Generation exposed" value={`${worst.genMw} MW`} sub="modeled; manual control or trip" tone="high" />
          <StatCell label="Modeled exposure" value={`${usd(worst.costPerHour)}/h`} sub="worst case, illustrative" tone="critical" />
          <StatCell
            label="IR retainer"
            value={RETAINER_STATUS_LABEL[record.status]}
            sub={ready ? "engagement path documented" : record.status === "active" ? "no documented engagement path" : "see the retainer record"}
            tone={ready ? "normal" : "critical"}
          />
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            <JewelTable radii={radii} selected={selected.jewel.id} onSelect={setSelectedId} />
            <BlastDetail r={selected} />
          </div>
          <div className="flex flex-col gap-3">
            <Checklist checks={checks} retainerReady={ready} onToggle={toggle} onRetainer={() => recordRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })} />
            <div ref={recordRef}>
              <RetainerPanel record={record} onSave={saveRecord} r={selected} hours={delayHours} onHours={setDelayHours} />
            </div>
          </div>
        </div>

        <div ref={tabletopRef} id="tabletop" className="scroll-mt-4">
          <Tabletop record={record} hours={delayHours} autoplay={autoplay} onAutoplayDone={() => setAutoplay(false)} />
        </div>

        <MicrosoftHelp />
      </div>
    </AppShell>
  );
}

// ── Crown jewels ─────────────────────────────────────────────────────────────
function JewelTable({ radii, selected, onSelect }: { radii: BlastRadius[]; selected: string; onSelect: (id: string) => void }) {
  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-baseline justify-between gap-2 px-3 pt-2">
        <span className="text-sm font-semibold">Crown jewels and blast radius</span>
        <span className="text-[11px] text-muted-foreground">Modeled reach of a compromise · click one for the path</span>
      </div>
      <table className="mt-1 w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-1 text-left">System</th>
            <th className="py-1 text-left">Sites affected</th>
            <th className="py-1 text-right">Customers</th>
            <th className="py-1 text-right">Generation</th>
            <th className="px-3 py-1 text-right">Exposure / hour</th>
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
                {r.sites.length ? (
                  r.sites.map((s) => s.name.replace(" Substation", "").replace(" Generating Plant", " plant")).join(", ")
                ) : (
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
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[#ff4d5e]">Control at risk ({control.length} systems)</div>
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

// ── Checklist and retainer record ────────────────────────────────────────────
function Checklist({
  checks,
  retainerReady,
  onToggle,
  onRetainer,
}: {
  checks: Record<string, boolean>;
  retainerReady: boolean;
  onToggle: (id: string) => void;
  onRetainer: () => void;
}) {
  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-baseline justify-between px-3 pt-2">
        <span className="text-sm font-semibold">Readiness checklist</span>
        <span className="text-[11px] text-muted-foreground">click to update</span>
      </div>
      <div className="flex flex-col p-2">
        {READINESS.map((r) => {
          const on = r.retainer ? retainerReady : !!checks[r.id];
          return (
            <button
              key={r.id}
              onClick={() => (r.retainer ? onRetainer() : onToggle(r.id))}
              className={cn(
                "flex items-start gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted/40",
                r.retainer && "mt-1 border border-dashed",
                r.retainer && !on && "border-[#ff4d5e]/60 bg-[#ff4d5e]/5",
              )}
            >
              {on ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-[#2fbf71]" /> : <Circle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
              <span>
                <span className={cn("font-medium", !on && "text-muted-foreground")}>{r.label}</span>
                <span className="block text-[10.5px] text-muted-foreground">{r.retainer ? "Set from the retainer record below." : r.detail}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const FIELD = "w-full rounded border bg-background/60 px-2 py-1 text-xs";

function RetainerPanel({
  record,
  onSave,
  r,
  hours,
  onHours,
}: {
  record: RetainerRecord;
  onSave: (r: RetainerRecord) => void;
  r: BlastRadius;
  hours: number;
  onHours: (h: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(record);
  useEffect(() => setDraft(record), [record]);
  const ready = isRetainerReady(record);
  const gaps = retainerGaps(record);
  const set = <K extends keyof RetainerRecord>(k: K, v: RetainerRecord[K]) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div className={cn("rounded-md border px-3 py-2 text-xs", ready ? "border-[#2fbf71]/50 bg-[#2fbf71]/5" : "border-primary/40 bg-card")}>
      <div className="flex flex-wrap items-center gap-2">
        {ready ? <ShieldCheck className="size-4 text-[#2fbf71]" /> : <ShieldHalf className="size-4 text-primary" />}
        <span className="text-sm font-semibold">Incident response retainer</span>
        <span
          className={cn(
            "rounded border px-1.5 text-[10px] font-semibold uppercase tracking-wider",
            ready ? "border-[#2fbf71]/60 text-[#2fbf71]" : "border-[#ff4d5e]/60 text-[#ff4d5e]",
          )}
        >
          {RETAINER_STATUS_LABEL[record.status]}
        </span>
        <span className="ml-auto text-[10.5px] text-muted-foreground">
          {record.source} · last verified {mdy(record.lastVerified)}
        </span>
      </div>

      {editing ? (
        <div className="mt-2 grid gap-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <label>
              <span className="text-muted-foreground">Status</span>
              <select className={FIELD} value={draft.status} onChange={(e) => set("status", e.target.value as RetainerStatus)}>
                {(Object.keys(RETAINER_STATUS_LABEL) as RetainerStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {RETAINER_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="text-muted-foreground">Source</span>
              <select className={FIELD} value={draft.source} onChange={(e) => set("source", e.target.value as RetainerRecord["source"])}>
                <option>Customer-reported</option>
                <option>Verified with Microsoft Services</option>
              </select>
            </label>
          </div>
          <label>
            <span className="text-muted-foreground">Provider</span>
            <input className={FIELD} value={draft.provider} onChange={(e) => set("provider", e.target.value)} placeholder="Microsoft Cybersecurity Incident Response (CIR)" />
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            <label>
              <span className="text-muted-foreground">Term start</span>
              <input type="date" className={FIELD} value={draft.termStart} onChange={(e) => set("termStart", e.target.value)} />
            </label>
            <label>
              <span className="text-muted-foreground">Term end</span>
              <input type="date" className={FIELD} value={draft.termEnd} onChange={(e) => set("termEnd", e.target.value)} />
            </label>
          </div>
          <label>
            <span className="text-muted-foreground">CSAM</span>
            <input className={FIELD} value={draft.csam} onChange={(e) => set("csam", e.target.value)} />
          </label>
          <label>
            <span className="text-muted-foreground">Incident commander</span>
            <input className={FIELD} value={draft.incidentCommander} onChange={(e) => set("incidentCommander", e.target.value)} />
          </label>
          <label>
            <span className="text-muted-foreground">Documented engagement steps (from your agreement and IR plan)</span>
            <textarea rows={4} className={FIELD} value={draft.engagementSteps} onChange={(e) => set("engagementSteps", e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            <label>
              <span className="text-muted-foreground">Last tabletop exercise</span>
              <input type="date" className={FIELD} value={draft.lastExercise} onChange={(e) => set("lastExercise", e.target.value)} />
            </label>
            <label>
              <span className="text-muted-foreground">Last verified</span>
              <input type="date" className={FIELD} value={draft.lastVerified} onChange={(e) => set("lastVerified", e.target.value)} />
            </label>
          </div>
          <div className="text-[10.5px] text-muted-foreground">
            Demo storage: saved in this browser only. In a customer deployment, keep this record in a secured application database, and never store credentials or contact secrets here.
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                onSave(draft);
                setEditing(false);
              }}
              className="rounded bg-primary px-2.5 py-1 font-semibold text-primary-foreground"
            >
              Save
            </button>
            <button onClick={() => { setDraft(record); setEditing(false); }} className="rounded border px-2.5 py-1">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <dl className="mt-2 grid grid-cols-[110px_minmax(0,1fr)] gap-x-2 gap-y-0.5">
            <dt className="text-muted-foreground">Provider</dt>
            <dd>{record.provider || "not recorded"}</dd>
            <dt className="text-muted-foreground">Term</dt>
            <dd>{record.termStart ? `${mdy(record.termStart)} to ${mdy(record.termEnd)}` : "not recorded"}</dd>
            <dt className="text-muted-foreground">CSAM</dt>
            <dd>{record.csam || "not recorded"}</dd>
            <dt className="text-muted-foreground">Incident commander</dt>
            <dd>{record.incidentCommander || "not recorded"}</dd>
            <dt className="text-muted-foreground">Last exercise</dt>
            <dd>{mdy(record.lastExercise)}</dd>
            <dt className="text-muted-foreground">Engagement steps</dt>
            <dd className="whitespace-pre-line">{record.engagementSteps || <span className="text-[#ff8a3d]">Not documented</span>}</dd>
          </dl>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
            <button onClick={() => setEditing(true)} className="flex items-center gap-1 rounded border px-2 py-0.5 hover:bg-muted/40">
              <Pencil className="size-3" /> Edit record
            </button>
            <span className="text-muted-foreground">Examples:</span>
            <button onClick={() => onSave(RETAINER_PRESETS.none)} className="text-primary hover:underline">
              not in place
            </button>
            <button onClick={() => onSave(RETAINER_PRESETS.active)} className="text-primary hover:underline">
              active retainer
            </button>
          </div>
        </>
      )}

      {gaps.length > 0 && !editing && (
        <div className="mt-2 rounded border border-[#f0b429]/40 bg-[#f0b429]/5 px-2 py-1.5">
          <div className="font-semibold text-[#f0b429]">Readiness gaps</div>
          {gaps.map((g) => (
            <div key={g} className="mt-0.5 flex gap-1 text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-3 shrink-0 text-[#f0b429]" /> {g}
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 rounded border bg-background/40 px-2 py-1.5">
        <div className="font-semibold">What a CIR retainer provides</div>
        <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-muted-foreground">
          {CIR_DATASHEET.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ul>
        <div className="mt-1 text-[10.5px] text-muted-foreground">
          Subject to your agreement.{" "}
          <a href={CIR_DATASHEET_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
            Microsoft CIR datasheet <ExternalLink className="size-2.5" />
          </a>
        </div>
      </div>

      <div className="mt-2 rounded border bg-background/40 px-2 py-1.5">
        <div className="text-muted-foreground">
          Without a retainer, incident response can still be bought during an incident, but the enhanced two-hour response applies to retainers bought in advance, and the arrangements are made while the incident is running.
        </div>
        <label className="mt-1 flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Your estimate of time to engage outside responders without a retainer</span>
          <span className="num font-semibold">{hours} h</span>
        </label>
        <input type="range" min={4} max={120} step={4} value={hours} onChange={(e) => onHours(Number(e.target.value))} className="w-full accent-[var(--primary)]" />
        <div>
          Modeled exposure over that time if <span className="font-medium">{r.asset.name}</span> is the entry point:{" "}
          {r.costPerHour ? (
            <span className="num font-semibold text-[#ff8a3d]">
              {usd(r.costPerHour * hours)} <span className="font-normal text-muted-foreground">({usd(r.costPerHour)}/h × {hours} h)</span>
            </span>
          ) : (
            <span className="text-muted-foreground">operators lose visibility; no customers or generation are directly exposed.</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tabletop ─────────────────────────────────────────────────────────────────
const PATH_NODES: { id: string; x: number; y: number; label?: string }[] = [
  { id: "sensor-plant-steam", x: 70, y: 70 },
  { id: "plc-plant-1", x: 185, y: 30 },
  { id: "plc-plant-2", x: 185, y: 70 },
  { id: "rtu-plant", x: 185, y: 110 },
  { id: "scada-gw-plant", x: 300, y: 70 },
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
const CONF_COLOR: Record<string, string> = { High: "#ff4d5e", Medium: "#f0b429", Low: "#4aa3ff", "Very low": "#5f7fa6" };

interface Approval {
  by: string;
  at: string;
  actions: string[];
}

function Tabletop({ record, hours, autoplay, onAutoplayDone }: { record: RetainerRecord; hours: number; autoplay: boolean; onAutoplayDone: () => void }) {
  const [step, setStep] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [approval, setApproval] = useState<Approval | null>(null);
  const r = useMemo(() => blastRadius(CROWN_JEWELS.find((j) => j.id === TABLETOP_JEWEL)!), []);
  const last = TABLETOP.length - 1;
  const done = step >= last;
  const waiting = step >= 0 && !!TABLETOP[step]!.decision && !approval;

  const reset = () => {
    setPlaying(false);
    setStep(-1);
    setApproval(null);
  };
  useEffect(() => {
    if (!autoplay) return;
    reset();
    setPlaying(true);
    onAutoplayDone();
  }, [autoplay, onAutoplayDone]);
  useEffect(() => {
    if (!playing) return;
    if (done || waiting) {
      setPlaying(false);
      return;
    }
    const t = window.setTimeout(() => setStep((s) => s + 1), step < 0 ? 400 : 2600);
    return () => window.clearTimeout(t);
  }, [playing, step, done, waiting]);

  const lit = new Set(TABLETOP.slice(0, step + 1).flatMap((s) => s.highlight));
  const current = step >= 0 ? TABLETOP[step] : null;
  const curLit = new Set(current?.highlight ?? []);

  return (
    <div className="rounded-md border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <div className="mr-auto">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            Tabletop: suspected historian tampering at Bayou Generating Plant
            <span className="rounded border border-violet-400/50 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-300">
              Synthetic exercise · no Microsoft engagement initiated
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            OneGrid weighs the evidence, people approve every action, and the incident commander gets a handoff package for outside responders.
          </div>
        </div>
        <button onClick={() => setPlaying((p) => !p)} disabled={done || waiting} className="flex items-center gap-1 rounded border px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40">
          {playing ? <Pause className="size-3" /> : <Play className="size-3" />} {playing ? "Pause" : step < 0 ? "Play" : "Resume"}
        </button>
        <button
          onClick={() => {
            setPlaying(false);
            setStep((s) => Math.min(last, s + 1));
          }}
          disabled={done || waiting}
          className="flex items-center gap-1 rounded border px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          <SkipForward className="size-3" /> Step
        </button>
        <button onClick={reset} className="flex items-center gap-1 rounded border px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
          <RotateCcw className="size-3" /> Reset
        </button>
      </div>

      <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
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
                    <text x={n.x} y={n.y - 17} textAnchor="middle" fontSize={8.5} fill="#6d7f99">
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
                onClick={() => {
                  if (i > 3 && !approval) return;
                  setPlaying(false);
                  setStep(i);
                }}
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
                  {s.decision && i === step && !approval && <span className="ml-1.5 rounded bg-[#f0b429]/20 px-1 text-[10px] font-semibold text-[#f0b429]">Waiting for approval</span>}
                  {i <= step && <span className="block text-[11px] text-muted-foreground">{s.body}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {step < 2 ? (
            <div className="flex items-center gap-2 rounded border border-dashed px-3 py-3 text-xs text-muted-foreground">
              <Clock className="size-4" /> {step < 0 ? "Play the tabletop." : "OneGrid is collecting evidence."} Its assessment appears here.
            </div>
          ) : (
            <Hypotheses />
          )}
          {step >= 3 && (approval ? <ApprovedCard a={approval} /> : <ApprovalCard onApprove={(a) => { setApproval(a); setPlaying(true); }} />)}
        </div>
      </div>

      {done && approval && <Handoff record={record} approval={approval} r={r} hours={hours} />}
    </div>
  );
}

function Hypotheses() {
  return (
    <div className="rounded border">
      <div className="border-b px-2 py-1 text-xs font-semibold">Possible explanations, with evidence</div>
      <div className="flex flex-col">
        {HYPOTHESES.map((h) => (
          <div key={h.name} className="border-t px-2 py-1.5 text-[11px] first:border-t-0">
            <div className="flex items-center gap-2">
              <span className="font-medium">{h.name}</span>
              <span className="ml-auto rounded border px-1 text-[10px] font-semibold" style={{ color: CONF_COLOR[h.confidence], borderColor: `${CONF_COLOR[h.confidence]}80` }}>
                {h.confidence}
              </span>
            </div>
            {h.evidenceFor.length > 0 && <div className="text-muted-foreground">For: {h.evidenceFor.join("; ")}</div>}
            {h.evidenceAgainst.length > 0 && <div className="text-muted-foreground">Against: {h.evidenceAgainst.join("; ")}</div>}
          </div>
        ))}
      </div>
      <div className="border-t px-2 py-1 text-[10.5px] text-muted-foreground">Confidence is OneGrid&apos;s assessment of the evidence so far, for people to decide on. It isn&apos;t a verdict.</div>
    </div>
  );
}

function ApprovalCard({ onApprove }: { onApprove: (a: Approval) => void }) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(ACTIONS.filter((a) => a.recommended).map((a) => a.id)));
  const [by, setBy] = useState("Shift supervisor, Bayou");
  return (
    <div className="rounded border border-[#f0b429]/60 bg-[#f0b429]/5 px-2 py-1.5 text-xs">
      <div className="flex items-center gap-1 font-semibold text-[#f0b429]">
        <UserCheck className="size-3.5" /> Operator approval required
      </div>
      <div className="mt-1 flex flex-col gap-1">
        {ACTIONS.map((a) => (
          <label key={a.id} className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={sel.has(a.id)}
              onChange={() => setSel((s) => { const n = new Set(s); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); return n; })}
            />
            <span>
              <span className="font-medium">{a.label}</span>
              <span className="block text-[10.5px] text-muted-foreground">{a.note}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <input className={cn(FIELD, "flex-1")} value={by} onChange={(e) => setBy(e.target.value)} aria-label="Approved by" />
        <button
          onClick={() => onApprove({ by: by.trim() || "Shift supervisor", at: "02:36", actions: ACTIONS.filter((a) => sel.has(a.id)).map((a) => a.label) })}
          disabled={!sel.size}
          className="rounded bg-primary px-2.5 py-1 font-semibold text-primary-foreground disabled:opacity-40"
        >
          Approve selected
        </button>
      </div>
    </div>
  );
}

function ApprovedCard({ a }: { a: Approval }) {
  return (
    <div className="rounded border border-[#2fbf71]/50 bg-[#2fbf71]/5 px-2 py-1.5 text-xs">
      <div className="flex items-center gap-1 font-semibold text-[#2fbf71]">
        <CheckCircle2 className="size-3.5" /> Approved by {a.by} at {a.at}
      </div>
      {a.actions.map((x) => (
        <div key={x} className="mt-0.5 flex gap-1 text-muted-foreground">
          <ChevronRight className="mt-0.5 size-3 shrink-0" /> {x}
        </div>
      ))}
    </div>
  );
}

const OPEN_QUESTIONS = [
  "Is the replay limited to the historian, or are control commands affected?",
  "How did the configuration push reach the SCADA gateway?",
  "Are historians at other plants affected?",
];

function handoffText(record: RetainerRecord, approval: Approval, r: BlastRadius): string {
  const control = r.reached.filter((x) => x.reach === "control" && x.depth > 0).map((x) => x.asset.name);
  return [
    "INCIDENT RESPONSE HANDOFF (synthetic exercise)",
    "Site: Bayou Generating Plant · Declared Sev 1 at 02:41 by " + (record.incidentCommander || "incident commander"),
    "",
    "Observed",
    ...TABLETOP.filter((s) => !s.decision).slice(0, 2).map((s) => `- ${s.t} ${s.title}: ${s.body}`),
    "- 02:41 SOC: unknown outbound connection from the plant historian",
    "",
    "Assessment (for responders to confirm)",
    ...HYPOTHESES.map((h) => `- ${h.name}: ${h.confidence}`),
    "",
    "Open questions",
    ...OPEN_QUESTIONS.map((q) => `- ${q}`),
    "",
    `Systems at risk: ${control.join(", ")}`,
    `Modeled exposure: ${r.genMw} MW on manual control, about ${usd(r.costPerHour)}/h (illustrative)`,
    "",
    `Actions approved by ${approval.by} at ${approval.at}`,
    ...approval.actions.map((a) => `- ${a}`),
    "",
    "Engagement path",
    record.engagementSteps || "Not documented",
  ].join("\n");
}

function Handoff({ record, approval, r, hours }: { record: RetainerRecord; approval: Approval; r: BlastRadius; hours: number }) {
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const ready = isRetainerReady(record);
  const control = r.reached.filter((x) => x.reach === "control" && x.depth > 0);
  return (
    <div className="border-t px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Incident response handoff</span>
        <span className="rounded border border-violet-400/50 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-300">Simulated</span>
        <span className="text-[11px] text-muted-foreground">Prepared by OneGrid at 02:47 for {record.incidentCommander || "the incident commander"} to review</span>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => {
              void navigator.clipboard?.writeText(handoffText(record, approval, r)).then(() => setCopied(true));
            }}
            className="flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted/40"
          >
            <ClipboardCopy className="size-3" /> {copied ? "Copied" : "Copy handoff"}
          </button>
          <button onClick={() => setSent(true)} className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">
            <Send className="size-3" /> Send through the documented path (simulated)
          </button>
        </div>
      </div>

      <div className="mt-2 grid gap-3 text-xs md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded border bg-background/40 px-2 py-1.5">
          <div className="font-semibold">Observed</div>
          <div className="mt-0.5 text-muted-foreground">02:14 configuration change, no ticket</div>
          <div className="text-muted-foreground">02:31 14 tags frozen across GT1 and unit 2; HMI still updating</div>
          <div className="text-muted-foreground">02:41 SOC: unknown outbound connection from the plant historian</div>
          <div className="mt-1 font-semibold">Open questions</div>
          {OPEN_QUESTIONS.map((q) => (
            <div key={q} className="text-muted-foreground">
              {q}
            </div>
          ))}
        </div>
        <div className="rounded border bg-background/40 px-2 py-1.5">
          <div className="font-semibold">Systems at risk ({control.length})</div>
          <div className="mt-0.5 text-muted-foreground">{control.map((x) => x.asset.name).join(", ")}</div>
          <div className="mt-1 font-semibold">Modeled exposure</div>
          <div className="text-muted-foreground">
            {r.genMw} MW on manual control · about {usd(r.costPerHour)}/h (illustrative)
          </div>
        </div>
        <div className="rounded border bg-background/40 px-2 py-1.5">
          <div className="font-semibold">Approved actions</div>
          <div className="text-muted-foreground">
            {approval.by} at {approval.at}
          </div>
          {approval.actions.map((a) => (
            <div key={a} className="text-muted-foreground">
              · {a}
            </div>
          ))}
        </div>
        <div className={cn("rounded border px-2 py-1.5", ready ? "bg-background/40" : "border-[#ff8a3d]/60 bg-[#ff8a3d]/5")}>
          <div className="font-semibold">Engagement path</div>
          {record.engagementSteps ? (
            <div className="mt-0.5 whitespace-pre-line text-muted-foreground">{record.engagementSteps}</div>
          ) : (
            <div className="mt-0.5 text-[#ff8a3d]">Not documented. Who receives this package would be decided during the incident.</div>
          )}
        </div>
      </div>

      {sent && (
        <div
          className={cn("mt-2 flex items-start gap-2 rounded border px-2 py-1.5 text-xs", ready ? "border-[#2fbf71]/50 bg-[#2fbf71]/5" : "border-[#ff8a3d]/60 bg-[#ff8a3d]/5")}
        >
          {ready ? <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#2fbf71]" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#ff8a3d]" />}
          {ready ? (
            <span>
              <span className="font-semibold">Simulated acknowledgment.</span>{" "}
              <span className="text-muted-foreground">
                Nothing was sent. In a real incident, {record.incidentCommander || "the incident commander"} follows the steps above. The CIR datasheet describes an enhanced
                two-hour response and an assigned Incident Response Coordinator for retainers bought in advance, subject to your agreement.
              </span>
            </span>
          ) : (
            <span>
              <span className="font-semibold">No retainer or documented path on record.</span>{" "}
              <span className="text-muted-foreground">
                Nothing was sent. The package is ready, but outside responders would be found and contracted during the incident. At your estimate of {hours} h, modeled
                exposure meanwhile is about {usd(r.costPerHour * hours)} at {usd(r.costPerHour)}/h.
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function MicrosoftHelp() {
  const items: [string, string][] = [
    ["Microsoft Incident Response", "Investigation, forensics, containment and recovery. A Cybersecurity Incident Response retainer bought in advance adds an enhanced two-hour response and an assigned coordinator."],
    ["Proactive services", "Compromise assessments and threat briefings, scheduled through your CSAM."],
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
      <div className="mt-1.5 text-muted-foreground">
        <span className="font-medium text-foreground">Path to readiness:</span> threat briefing, then a proactive compromise assessment, then an incident response
        retainer proposal from Microsoft Services, with your CSAM coordinating proactive work. Talk to your Microsoft account team.
      </div>
    </div>
  );
}
