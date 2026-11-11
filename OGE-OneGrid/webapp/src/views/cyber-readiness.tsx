import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Circle,
  ClipboardCopy,
  ExternalLink,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Send,
  ShieldCheck,
  ShieldHalf,
  UserCheck,
} from "lucide-react";

import { AppShell, PageHeader } from "@/components/ops/AppShell";
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
  type TabletopStep,
  blastRadius,
  retainerGaps,
  type BlastRadius,
  type RetainerRecord,
  type RetainerStatus,
} from "@/lib/cyber/cyber-data";
import { SITE_BY_ID } from "@/lib/infra/infra-data";
import { cn } from "@/lib/utils";

const CHECKS_KEY = "og.cyberReadiness";
const RETAINER_KEY = "og.cyberRetainer";
const RED = "#ff4d5e";
const AMBER = "#f0b429";
const GREEN = "#2fbf71";
/** CIR datasheet: "Enhanced two-hour response ... if purchasing ... proactively as a retainer." */
const CIR_RESPONSE_H = 2;

const usd = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `$${Math.round(v / 1_000)}K` : `$${Math.round(v)}`;
const num = (v: number) => v.toLocaleString("en-US");
const mdy = (iso: string) => {
  if (!iso) return "not recorded";
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
};
const shortSite = (n: string) => n.replace(" Substation", "").replace(" Generating Plant", " plant");

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

/** Small "show more" toggle used for everything secondary. */
function More({ label, children, defaultOpen = false }: { label: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
        <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} /> {label}
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

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
  const worst = radii[0]!;
  const [hours, setHours] = useState(48);
  /** Hours until outside experts respond under the selected setup. */
  const responseH = ready ? CIR_RESPONSE_H : hours;
  const mode = ready ? GREEN : RED;

  const tabletopRef = useRef<HTMLDivElement>(null);
  const [autoplay, setAutoplay] = useState(false);
  const runTabletop = () => {
    tabletopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setAutoplay(true);
  };
  useEffect(() => {
    if (window.location.hash === "#tabletop") runTabletop();
  }, []);

  return (
    <AppShell>
      <PageHeader
        title="Cyber readiness"
        description="If an attacker reached your operational network tonight, what would go dark, and how fast could you get expert help?"
        actions={
          <div className="flex items-center gap-2">
            <span
              title={`Demo data: systems come from the synthetic IT/OT estate in Infrastructure. Exposure is modeled at ${usd(COST_ASSUMPTIONS.perCustomerHour)} per customer-hour and ${usd(COST_ASSUMPTIONS.replacementPowerPerMwh)}/MWh replacement power.`}
              className="cursor-help rounded border border-violet-400/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-300"
            >
              Demo data
            </span>
            <button onClick={runTabletop} className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90">
              <Play className="size-3.5" /> Run the tabletop
            </button>
          </div>
        }
      />

      <div className="flex flex-col gap-3 p-4">
        <div
          className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-md border bg-card px-4 py-3 transition-colors"
          style={{ borderColor: `${mode}99`, backgroundImage: `linear-gradient(90deg, ${mode}1f, transparent 55%)` }}
        >
          <div className="min-w-[260px]">
            <div className="flex items-center gap-1.5 text-base font-semibold" style={{ color: mode }}>
              {ready ? <ShieldCheck className="size-4" /> : <AlertTriangle className="size-4" />}
              {ready ? "With a CIR retainer" : "Without a retainer"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {ready ? "Documented engagement path; enhanced two-hour response" : "Outside help is found and contracted during the incident"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Worst case: {worst.jewel.role} ({worst.asset.name}), modeled
            </div>
          </div>
          <Headline label="Customers" value={num(worst.customers)} />
          <Headline label="Generation" value={`${worst.genMw} MW`} />
          <Headline
            label="Expert response"
            value={`${responseH} h`}
            sub={ready ? "enhanced response (datasheet)" : "your estimate"}
            color={mode}
            title={ready ? "CIR datasheet: enhanced two-hour response when purchased proactively as a retainer. Response is not containment." : "Adjust in the retainer card."}
          />
          <Headline label="Exposure before response" value={usd(worst.costPerHour * responseH)} sub={`${usd(worst.costPerHour)}/h × ${responseH} h`} color={mode} />
          <RetainerSwitch ready={ready} onChange={(on) => saveRecord(on ? RETAINER_PRESETS.active : RETAINER_PRESETS.none)} />
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <JewelTable radii={radii} responseH={responseH} color={mode} />
          <ReadinessCard checks={checks} onToggle={toggle} record={record} onSave={saveRecord} ready={ready} worst={worst} hours={hours} onHours={setHours} score={score} />
        </div>

        <div ref={tabletopRef} id="tabletop" className="scroll-mt-4">
          <Tabletop record={record} hours={hours} autoplay={autoplay} onAutoplayDone={() => setAutoplay(false)} />
        </div>

        <div className="rounded-md border bg-card px-3 py-2 text-xs" style={{ borderColor: `${mode}66` }}>
          {ready ? (
            <>
              <span className="font-medium" style={{ color: GREEN }}>
                Keep it ready:
              </span>{" "}
              <span className="text-muted-foreground">
                run a tabletop every year, keep the retainer record and engagement steps current, and use your CSAM to schedule proactive services such as compromise
                assessments and threat briefings.
              </span>
            </>
          ) : (
            <>
              <span className="font-medium" style={{ color: RED }}>
                Next step:
              </span>{" "}
              <span className="text-muted-foreground">
                talk to your Microsoft account team about a Cybersecurity Incident Response retainer. The path is a threat briefing, then a proactive compromise
                assessment, then a retainer proposal from Microsoft Services.
              </span>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

/** The one control that drives the story: compare the same incident with and without a retainer. */
function RetainerSwitch({ ready, onChange }: { ready: boolean; onChange: (on: boolean) => void }) {
  const opt = (on: boolean, label: string) => {
    const active = ready === on;
    const color = on ? GREEN : RED;
    return (
      <button
        onClick={() => onChange(on)}
        className={cn("rounded px-2.5 py-1 text-xs font-semibold transition-colors", !active && "text-muted-foreground hover:text-foreground")}
        style={active ? { background: `${color}26`, color, boxShadow: `inset 0 0 0 1px ${color}99` } : undefined}
      >
        {label}
      </button>
    );
  };
  return (
    <div className="ml-auto">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Incident response retainer</div>
      <div className="mt-0.5 flex gap-1 rounded-md border bg-background/40 p-0.5">
        {opt(false, "No retainer")}
        {opt(true, "CIR retainer")}
      </div>
    </div>
  );
}

function Headline({ label, value, color, sub, title }: { label: string; value: string; color?: string; sub?: string; title?: string }) {
  return (
    <div title={title} className={cn(title && "cursor-help")}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="num text-lg font-semibold" style={color ? { color } : undefined}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ── Crown jewels ─────────────────────────────────────────────────────────────
function JewelTable({ radii, responseH, color }: { radii: BlastRadius[]; responseH: number; color: string }) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const rows = all ? radii : radii.slice(0, 5);
  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-baseline justify-between px-3 pt-2">
        <span className="text-sm font-semibold">Crown jewels</span>
        <span className="text-[11px] text-muted-foreground">Modeled exposure before expert response ({responseH} h) · click for detail</span>
      </div>
      <table className="mt-1 w-full text-xs">
        <tbody>
          {rows.map((r) => (
            <JewelRow key={r.jewel.id} r={r} responseH={responseH} color={color} open={open === r.jewel.id} onToggle={() => setOpen((o) => (o === r.jewel.id ? null : r.jewel.id))} />
          ))}
        </tbody>
      </table>
      {radii.length > 5 && (
        <button onClick={() => setAll((a) => !a)} className="w-full border-t px-3 py-1.5 text-left text-[11px] text-muted-foreground hover:text-foreground">
          {all ? "Show top 5" : `Show all ${radii.length} systems`}
        </button>
      )}
    </div>
  );
}

function JewelRow({ r, responseH, color, open, onToggle }: { r: BlastRadius; responseH: number; color: string; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr onClick={onToggle} className={cn("cursor-pointer border-t hover:bg-muted/40", open && "bg-muted/30")}>
        <td className="px-3 py-2">
          <div className="font-medium">{r.jewel.role}</div>
          <div className="text-[10.5px] text-muted-foreground">{r.asset.name}</div>
        </td>
        <td className="py-2 text-muted-foreground">
          {r.sites.length ? r.sites.map((s) => shortSite(s.name)).join(", ") : r.analyticsBlind ? "Operators lose visibility" : "Contained"}
        </td>
        <td className="num px-3 py-2 text-right">
          {r.costPerHour ? (
            <>
              <div className="font-semibold transition-colors" style={{ color }}>
                {usd(r.costPerHour * responseH)}
              </div>
              <div className="text-[10px] text-muted-foreground">{usd(r.costPerHour)}/h</div>
            </>
          ) : (
            "–"
          )}
        </td>
      </tr>
      {open && (
        <tr className="bg-muted/20">
          <td colSpan={3} className="px-3 pb-2 text-[11px]">
            <div className="text-muted-foreground">{r.jewel.why}</div>
            {r.sites.map((s) => (
              <div key={s.siteId} className="mt-0.5">
                <span className="font-medium">{s.name}:</span> <span className="text-muted-foreground">{s.effect}</span>
                {s.customers > 0 && <span className="text-muted-foreground"> · {num(s.customers)} customers</span>}
                {s.genMw > 0 && <span className="text-muted-foreground"> · {s.genMw} MW</span>}
              </div>
            ))}
            <div className="mt-0.5 text-muted-foreground">
              {r.reached.filter((x) => x.depth > 0).length} systems reachable from {SITE_BY_ID.get(r.asset.siteId)?.name}.
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Readiness and retainer ───────────────────────────────────────────────────
function ReadinessCard({
  checks,
  onToggle,
  record,
  onSave,
  ready,
  worst,
  hours,
  onHours,
  score,
}: {
  checks: Record<string, boolean>;
  onToggle: (id: string) => void;
  record: RetainerRecord;
  onSave: (r: RetainerRecord) => void;
  ready: boolean;
  worst: BlastRadius;
  hours: number;
  onHours: (h: number) => void;
  score: number;
}) {
  const gaps = [...retainerGaps(record), ...READINESS.filter((r) => !r.retainer && !checks[r.id] && r.id !== "tabletop").map((r) => `${r.label}: not in place.`)];
  return (
    <div className={cn("flex flex-col gap-2 rounded-md border bg-card px-3 py-2 text-xs", ready && "border-[#2fbf71]/50")}>
      <div className="flex items-center gap-2">
        {ready ? <ShieldCheck className="size-4" style={{ color: GREEN }} /> : <ShieldHalf className="size-4 text-primary" />}
        <span className="text-sm font-semibold">Incident response retainer</span>
        <span className="rounded border px-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: ready ? GREEN : RED, borderColor: `${ready ? GREEN : RED}99` }}>
          {RETAINER_STATUS_LABEL[record.status]}
        </span>
      </div>

      {ready && (
        <div className="flex gap-1.5" style={{ color: GREEN }}>
          <CheckCircle2 className="mt-0.5 size-3 shrink-0" />
          <span>
            CIR retainer active with a documented engagement path. The datasheet describes an enhanced two-hour response and an assigned coordinator, subject to your agreement.
          </span>
        </div>
      )}

      {gaps.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          {gaps.slice(0, 3).map((g) => (
            <div key={g} className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" style={{ color: AMBER }} /> {g}
            </div>
          ))}
          {gaps.length > 3 && <div className="pl-[18px] text-muted-foreground">and {gaps.length - 3} more in the checklist</div>}
        </div>
      ) : (
        <div className="flex gap-1.5" style={{ color: GREEN }}>
          <CheckCircle2 className="mt-0.5 size-3" /> Retainer active, engagement path documented, exercised in the last year.
        </div>
      )}

      {!ready && worst.costPerHour > 0 && (
        <div className="rounded border bg-background/40 px-2 py-1.5">
          Without a retainer, help is arranged during the incident. At your estimate of{" "}
          <span className="num font-semibold">{hours} h</span>, worst-case modeled exposure is{" "}
          <span className="num font-semibold" style={{ color: RED }}>
            {usd(worst.costPerHour * hours)}
          </span>
          .
          <input type="range" min={4} max={120} step={4} value={hours} onChange={(e) => onHours(Number(e.target.value))} className="mt-1 w-full accent-[var(--primary)]" aria-label="Hours to engage outside responders without a retainer" />
        </div>
      )}

      <div className="flex flex-col gap-1.5 border-t pt-1.5">
        <More label="What a CIR retainer provides">
          <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
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
        </More>
        <More label="Retainer record">
          <RetainerRecordView record={record} onSave={onSave} />
        </More>
        <More label={`Readiness checklist (${score} of ${READINESS.length})`}>
          <div className="flex flex-col">
            {READINESS.map((r) => {
              const on = r.retainer ? ready : !!checks[r.id];
              return (
                <button key={r.id} disabled={r.retainer} onClick={() => onToggle(r.id)} title={r.retainer ? "Set from the retainer record" : r.detail} className="flex items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-muted/40 disabled:cursor-default">
                  {on ? <CheckCircle2 className="size-3.5 shrink-0" style={{ color: GREEN }} /> : <Circle className="size-3.5 shrink-0 text-muted-foreground" />}
                  <span className={cn(!on && "text-muted-foreground")}>{r.label}</span>
                </button>
              );
            })}
          </div>
        </More>
      </div>
    </div>
  );
}

const FIELD = "w-full rounded border bg-background/60 px-2 py-1 text-xs";

function RetainerRecordView({ record, onSave }: { record: RetainerRecord; onSave: (r: RetainerRecord) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(record);
  useEffect(() => setDraft(record), [record]);
  const set = <K extends keyof RetainerRecord>(k: K, v: RetainerRecord[K]) => setDraft((d) => ({ ...d, [k]: v }));

  if (!editing)
    return (
      <div>
        <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-2 gap-y-0.5">
          <dt className="text-muted-foreground">Provider</dt>
          <dd>{record.provider || "not recorded"}</dd>
          <dt className="text-muted-foreground">Term</dt>
          <dd>{record.termStart ? `${mdy(record.termStart)} to ${mdy(record.termEnd)}` : "not recorded"}</dd>
          <dt className="text-muted-foreground">Incident commander</dt>
          <dd>{record.incidentCommander || "not recorded"}</dd>
          <dt className="text-muted-foreground">Engagement steps</dt>
          <dd className="whitespace-pre-line">{record.engagementSteps || "Not documented"}</dd>
          <dt className="text-muted-foreground">Source</dt>
          <dd>
            {record.source}, last verified {mdy(record.lastVerified)}
          </dd>
        </dl>
        <button onClick={() => setEditing(true)} className="mt-1 flex items-center gap-1 text-[11px] text-primary hover:underline">
          <Pencil className="size-3" /> Edit record
        </button>
      </div>
    );

  return (
    <div className="grid gap-1.5">
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
          <span className="text-muted-foreground">Last verified</span>
          <input type="date" className={FIELD} value={draft.lastVerified} onChange={(e) => set("lastVerified", e.target.value)} />
        </label>
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
        <span className="text-muted-foreground">Incident commander</span>
        <input className={FIELD} value={draft.incidentCommander} onChange={(e) => set("incidentCommander", e.target.value)} />
      </label>
      <label>
        <span className="text-muted-foreground">Engagement steps (from your agreement and IR plan)</span>
        <textarea rows={4} className={FIELD} value={draft.engagementSteps} onChange={(e) => set("engagementSteps", e.target.value)} />
      </label>
      <label>
        <span className="text-muted-foreground">Last tabletop exercise</span>
        <input type="date" className={FIELD} value={draft.lastExercise} onChange={(e) => set("lastExercise", e.target.value)} />
      </label>
      <div className="text-[10.5px] text-muted-foreground">Demo: saved in this browser only. In a customer deployment, keep this in a secured application database.</div>
      <div className="flex gap-2">
        <button onClick={() => { onSave(draft); setEditing(false); }} className="rounded bg-primary px-2.5 py-1 font-semibold text-primary-foreground">
          Save
        </button>
        <button onClick={() => { setDraft(record); setEditing(false); }} className="rounded border px-2.5 py-1">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Tabletop ─────────────────────────────────────────────────────────────────
const TONE: Record<string, string> = { info: "#4aa3ff", warn: AMBER, critical: RED, action: GREEN };
const CONF_COLOR: Record<string, string> = { High: RED, Medium: AMBER, Low: "#4aa3ff", "Very low": "#5f7fa6" };

interface Approval {
  by: string;
  at: string;
  actions: string[];
}

/** The tabletop's last step depends on whether a retainer and engagement path exist. */
const FINAL_STEP: Record<"ready" | "none", TabletopStep> = {
  ready: {
    t: "02:47",
    title: "Handoff sent through the documented engagement path",
    body: "The incident commander follows the steps in the retainer record: engage Microsoft Incident Response, share this package and notify the CSAM. The enhanced two-hour response window applies.",
    highlight: [],
    tone: "action",
  },
  none: {
    t: "02:47",
    title: "Handoff ready, but no engagement path",
    body: "The package is ready, but there's no retainer and no documented path. Leadership starts finding and contracting outside responders in the middle of the night.",
    highlight: [],
    tone: "critical",
  },
};

function Tabletop({ record, hours, autoplay, onAutoplayDone }: { record: RetainerRecord; hours: number; autoplay: boolean; onAutoplayDone: () => void }) {
  const [step, setStep] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [approval, setApproval] = useState<Approval | null>(null);
  const r = useMemo(() => blastRadius(CROWN_JEWELS.find((j) => j.id === TABLETOP_JEWEL)!), []);
  const ready = isRetainerReady(record);
  const mode = ready ? GREEN : RED;
  const steps = useMemo(() => [...TABLETOP.slice(0, -1), FINAL_STEP[ready ? "ready" : "none"]], [ready]);
  const last = steps.length - 1;
  const done = step >= last;
  const waiting = step >= 0 && !!steps[step]!.decision && !approval;

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
    const t = window.setTimeout(() => setStep((s) => s + 1), step < 0 ? 300 : 2400);
    return () => window.clearTimeout(t);
  }, [playing, step, done, waiting]);

  return (
    <div className="rounded-md border bg-card transition-colors" style={{ borderColor: `${mode}99` }}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2" style={{ backgroundImage: `linear-gradient(90deg, ${mode}1a, transparent 60%)` }}>
        <div className="mr-auto">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            Tabletop: suspected historian tampering at Bayou plant
            <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: mode, boxShadow: `inset 0 0 0 1px ${mode}99` }}>
              {ready ? "With a CIR retainer" : "Without a retainer"}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            OneGrid weighs the evidence, people approve every action, and the incident commander gets a handoff for outside responders. Flip the retainer switch to replay it the other way.
          </div>
        </div>
        {step < 0 ? (
          <button onClick={() => setPlaying(true)} className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">
            <Play className="size-3" /> Play
          </button>
        ) : (
          <>
            {!done && !waiting && (
              <button onClick={() => setPlaying((p) => !p)} className="flex items-center gap-1 rounded border px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
                {playing ? <Pause className="size-3" /> : <Play className="size-3" />} {playing ? "Pause" : "Resume"}
              </button>
            )}
            <button onClick={reset} className="flex items-center gap-1 rounded border px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
              <RotateCcw className="size-3" /> Reset
            </button>
          </>
        )}
      </div>

      {step >= 0 && (
        <div className="grid gap-3 border-t p-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <ol className="flex flex-col gap-1">
            {steps.map((s, i) => (
              <li
                key={s.t}
                className={cn("rounded border-l-2 px-2 py-1 text-xs", i > step && "opacity-35", i === step && "bg-muted/40")}
                style={{ borderLeftColor: i <= step ? TONE[s.tone] : "transparent" }}
              >
                <span className="num mr-2 text-muted-foreground">{s.t}</span>
                <span className="font-medium">{s.title}</span>
                {i === step && <div className="mt-0.5 text-[11px] text-muted-foreground">{s.body}</div>}
              </li>
            ))}
          </ol>

          <div className="flex flex-col gap-2">
            {done && approval ? (
              <Handoff record={record} approval={approval} r={r} hours={hours} />
            ) : (
              <>
                {step >= 2 && <Hypotheses />}
                {waiting && <ApprovalCard onApprove={(a) => { setApproval(a); setPlaying(true); }} />}
                {approval && (
                  <div className="text-xs" style={{ color: GREEN }}>
                    <CheckCircle2 className="mr-1 inline size-3.5" />
                    Approved by {approval.by} at {approval.at}: {approval.actions.length} actions
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {done && approval && <ResponseRace hours={hours} costPerHour={r.costPerHour} ready={isRetainerReady(record)} />}
    </div>
  );
}

// ── Response, side by side ───────────────────────────────────────────────────
const RACE_MS = 9000;
const T0_MIN = 2 * 60 + 41; // 02:41, Sev 1 declared

const clock = (elapsedH: number) => {
  const m = Math.round(T0_MIN + elapsedH * 60);
  const day = Math.floor(m / 1440);
  const hh = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}${day ? ` (+${day}d)` : ""}`;
};

interface Milestone {
  at: number;
  text: string;
  key?: boolean;
}

function ResponseRace({ hours, costPerHour, ready }: { hours: number; costPerHour: number; ready: boolean }) {
  const total = Math.max(hours, CIR_RESPONSE_H);
  const [e, setE] = useState(0);
  const [run, setRun] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / RACE_MS);
      setE(p * total);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [total, run]);

  const lanes: { on: boolean; title: string; color: string; end: number; steps: Milestone[] }[] = [
    {
      on: false,
      title: "Without a retainer",
      color: RED,
      end: hours,
      steps: [
        { at: 0.07, text: "Incident commander decides outside help is needed" },
        { at: hours * 0.2, text: "Find a provider and agree the scope" },
        { at: hours * 0.55, text: "Contract, legal and purchasing approvals" },
        { at: hours, text: "Responders engaged (your estimate)", key: true },
      ],
    },
    {
      on: true,
      title: "With a CIR retainer",
      color: GREEN,
      end: CIR_RESPONSE_H,
      steps: [
        { at: 0.07, text: "Incident commander follows the documented engagement steps and sends the handoff" },
        { at: 0.12, text: "CSAM notified" },
        { at: CIR_RESPONSE_H, text: "Enhanced two-hour response (CIR datasheet)", key: true },
        { at: CIR_RESPONSE_H, text: "Assigned Incident Response Coordinator guides the engagement; evidence already preserved" },
      ],
    },
  ];
  const diff = costPerHour * Math.max(0, hours - CIR_RESPONSE_H);

  return (
    <div className="border-t px-3 py-3 text-xs">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-semibold">Response, side by side</span>
        <span className="text-muted-foreground">Same incident from 02:41, with and without a retainer</span>
        <span className="num ml-auto text-sm font-semibold">{clock(e)}</span>
        <button onClick={() => setRun((x) => x + 1)} className="flex items-center gap-1 rounded border px-2 py-0.5 text-muted-foreground hover:text-foreground">
          <RotateCcw className="size-3" /> Replay
        </button>
      </div>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        {[...lanes].sort((a, b) => Number(b.on === ready) - Number(a.on === ready)).map((l) => {
          const reached = e >= l.end;
          const exposure = costPerHour * Math.min(e, l.end);
          const mine = l.on === ready;
          return (
            <div
              key={l.title}
              className={cn("rounded-md border px-3 py-2 transition-opacity", !mine && "opacity-60")}
              style={{ borderColor: `${l.color}${mine ? "cc" : "55"}`, background: `${l.color}${mine ? "14" : "08"}`, boxShadow: mine ? `0 0 0 1px ${l.color}66` : undefined }}
            >
              <div className="flex items-center gap-2">
                <span className="font-semibold" style={{ color: l.color }}>
                  {l.title}
                </span>
                {l.on === ready && <span className="rounded border px-1 text-[9.5px] uppercase tracking-wider text-muted-foreground">your current setup</span>}
                <span className="ml-auto text-muted-foreground">{reached ? `Response at ${clock(l.end)}` : "Waiting for expert help…"}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-muted">
                <div className="h-full rounded transition-[width] duration-100" style={{ width: `${Math.min(100, (e / total) * 100)}%`, background: reached ? `${l.color}55` : l.color }} />
              </div>
              <ol className="mt-2 flex flex-col gap-1">
                {l.steps.map((s) => (
                  <li key={s.text} className={cn("flex gap-2 transition-opacity", e < s.at && "opacity-30")}>
                    <span className="num w-[86px] shrink-0 text-muted-foreground">{clock(s.at)}</span>
                    <span className={cn(s.key && "font-semibold")} style={s.key && e >= s.at ? { color: l.color } : undefined}>
                      {s.text}
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-2 flex items-baseline justify-between border-t pt-1.5">
                <span className="text-muted-foreground">Modeled exposure before response</span>
                <span className="num text-base font-semibold" style={{ color: l.color }}>
                  {usd(exposure)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 text-muted-foreground">
        {e >= total && diff > 0 && (
          <span>
            Difference in modeled exposure before expert response: <span className="num font-semibold text-foreground">{usd(diff)}</span>.
          </span>
        )}
        <span className="text-[10.5px]">
          Response is not containment. Times after 02:45 are illustrative; the time without a retainer is your estimate. Exposure is modeled for the Bayou plant at{" "}
          {usd(costPerHour)}/h.
        </span>
      </div>
    </div>
  );
}

function Hypotheses() {
  return (
    <div className="rounded border text-xs">
      <div className="border-b px-2 py-1 font-semibold">Possible explanations</div>
      {HYPOTHESES.map((h) => (
        <div key={h.name} className="flex items-start gap-2 border-t px-2 py-1 first-of-type:border-t-0" title={[...h.evidenceFor.map((e) => `For: ${e}`), ...h.evidenceAgainst.map((e) => `Against: ${e}`)].join("\n")}>
          <span className="w-16 shrink-0 text-[10px] font-semibold" style={{ color: CONF_COLOR[h.confidence] }}>
            {h.confidence}
          </span>
          <span>
            <span className="font-medium">{h.name}</span>
            <span className="block text-[10.5px] text-muted-foreground">{h.evidenceFor[0] ?? h.evidenceAgainst[0]}</span>
          </span>
        </div>
      ))}
      <div className="border-t px-2 py-1 text-[10.5px] text-muted-foreground">OneGrid&apos;s read of the evidence so far, for people to decide on.</div>
    </div>
  );
}

function ApprovalCard({ onApprove }: { onApprove: (a: Approval) => void }) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(ACTIONS.filter((a) => a.recommended).map((a) => a.id)));
  const [by, setBy] = useState("Shift supervisor, Bayou");
  return (
    <div className="rounded border px-2 py-1.5 text-xs" style={{ borderColor: `${AMBER}99`, background: `${AMBER}0d` }}>
      <div className="flex items-center gap-1 font-semibold" style={{ color: AMBER }}>
        <UserCheck className="size-3.5" /> Operator approval required
      </div>
      <div className="mt-1 flex flex-col gap-0.5">
        {ACTIONS.map((a) => (
          <label key={a.id} className="flex items-center gap-2" title={a.note}>
            <input type="checkbox" checked={sel.has(a.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); return n; })} />
            <span className={cn(!a.recommended && "text-muted-foreground")}>
              {a.label}
              {!a.recommended && " (operations decision)"}
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
          Approve
        </button>
      </div>
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
    `Site: Bayou Generating Plant · Sev 1 declared 02:41 by ${record.incidentCommander || "incident commander"}`,
    "",
    "Observed",
    "- 02:14 configuration change on the SCADA gateway, no change ticket",
    "- 02:31 14 tags frozen across GT1 and unit 2; HMI still updating",
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
  const rows: [string, ReactNode][] = [
    ["Observed", "Configuration change with no ticket (02:14), 14 tags frozen while the HMI updates (02:31), unknown outbound connection from the historian (02:41)"],
    ["Assessment", `${HYPOTHESES[0]!.name} (${HYPOTHESES[0]!.confidence.toLowerCase()}); ${OPEN_QUESTIONS.length} open questions for responders`],
    ["At risk", `${control.length} systems · ${r.genMw} MW on manual control · ${usd(r.costPerHour)}/h modeled`],
    ["Approved", `${approval.actions.length} actions by ${approval.by} at ${approval.at}`],
    [
      "Engagement",
      ready ? (
        <span className="whitespace-pre-line" style={{ color: GREEN }}>
          {record.engagementSteps}
        </span>
      ) : (
        <span style={{ color: RED }}>Not documented. Who receives this would be decided during the incident.</span>
      ),
    ],
  ];
  return (
    <div className="rounded border text-xs" style={{ borderColor: `${ready ? GREEN : RED}88` }}>
      <div className="flex flex-wrap items-center gap-2 border-b px-2 py-1">
        <span className="font-semibold">Incident response handoff</span>
        <span className="rounded border border-violet-400/50 px-1 text-[10px] font-semibold uppercase tracking-wider text-violet-300">Simulated</span>
        <span className="text-muted-foreground">for {record.incidentCommander || "the incident commander"}</span>
      </div>
      <dl className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-2 gap-y-1 px-2 py-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex items-center gap-2 border-t px-2 py-1.5">
        <button onClick={() => void navigator.clipboard?.writeText(handoffText(record, approval, r)).then(() => setCopied(true))} className="flex items-center gap-1 rounded border px-2 py-1 hover:bg-muted/40">
          <ClipboardCopy className="size-3" /> {copied ? "Copied" : "Copy"}
        </button>
        <button onClick={() => setSent(true)} className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 font-semibold text-primary-foreground">
          <Send className="size-3" /> Send (simulated)
        </button>
        <span className="text-[10.5px] text-muted-foreground">Simulated: nothing is sent to Microsoft.</span>
      </div>
      {sent && (
        <div className="border-t px-2 py-1.5" style={{ background: ready ? `${GREEN}0d` : "#ff8a3d0d" }}>
          {ready ? (
            <>
              <span className="font-semibold" style={{ color: GREEN }}>
                Simulated: nothing was sent.
              </span>{" "}
              <span className="text-muted-foreground">
                In a real incident the incident commander follows the steps above. Per the CIR datasheet, a retainer bought in advance provides an enhanced two-hour
                response and an assigned coordinator, subject to your agreement.
              </span>
            </>
          ) : (
            <>
              <span className="font-semibold" style={{ color: "#ff8a3d" }}>
                Simulated: no retainer or engagement path on record.
              </span>{" "}
              <span className="text-muted-foreground">
                Outside responders would be found and contracted during the incident. At your estimate of {hours} h, modeled exposure meanwhile is about{" "}
                {usd(r.costPerHour * hours)}.
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
