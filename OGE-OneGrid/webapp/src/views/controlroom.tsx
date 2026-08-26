import { Activity, Cpu } from "lucide-react";

import { AppShell, PageHeader } from "@/components/ops/AppShell";

// P1: Control Room, ported from the report-app twin/ControlRoom view. A live digital
// twin with anomalies pinned to the physical zone. This is a styled UI representation;
// the full react-three-fiber scene + live WebSocket telemetry land in P2/P3.
const TELEMETRY = [
  { k: "Vibration", v: "7.8 mm/s", tone: "high", state: "high" },
  { k: "Bearing temp", v: "96 °C", tone: "monitor", state: "watch" },
  { k: "Discharge press", v: "61 bar", tone: "normal", state: "ok" },
  { k: "Flow", v: "12,400 m³/h", tone: "normal", state: "ok" },
  { k: "Speed", v: "8,950 rpm", tone: "normal", state: "ok" },
];
const TONE: Record<string, string> = {
  high: "bg-risk-high/20 text-risk-high",
  monitor: "bg-risk-monitor/20 text-risk-monitor",
  normal: "bg-muted text-muted-foreground",
};

/** Stylized twin — a compressor skid with a glowing anomaly zone. */
function TwinVisual() {
  return (
    <div className="relative grid h-[420px] place-items-center overflow-hidden rounded-md border bg-surface-raised">
      <div
        className="absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(circle at 50% 45%, color-mix(in oklch, var(--color-primary) 22%, transparent), transparent 55%)",
        }}
      />
      <svg viewBox="0 0 320 240" className="relative h-64">
        <defs>
          <linearGradient id="skid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-muted-foreground)" />
            <stop offset="1" stopColor="var(--color-border)" />
          </linearGradient>
        </defs>
        <rect x="70" y="150" width="180" height="34" rx="4" fill="url(#skid)" />
        <rect x="96" y="96" width="70" height="58" rx="6" fill="url(#skid)" />
        <circle
          cx="131"
          cy="125"
          r="17"
          fill="var(--color-surface)"
          stroke="var(--color-muted-foreground)"
          strokeWidth="2"
        />
        <rect x="178" y="110" width="54" height="44" rx="5" fill="url(#skid)" />
        <line
          x1="166"
          y1="125"
          x2="178"
          y2="128"
          stroke="var(--color-muted-foreground)"
          strokeWidth="6"
        />
        {/* anomaly pin on the bearing */}
        <circle
          cx="131"
          cy="125"
          r="26"
          fill="none"
          stroke="var(--color-risk-high)"
          strokeWidth="2"
        >
          <animate attributeName="r" values="20;30;20" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.9;0.2;0.9" dur="2s" repeatCount="indefinite" />
        </circle>
        <circle cx="131" cy="125" r="4" fill="var(--color-risk-high)" />
      </svg>
      <div className="absolute bottom-3 left-3 rounded-md border bg-card/80 px-2.5 py-1.5 text-[11px] text-muted-foreground backdrop-blur">
        Compressor B · live twin · anomaly pinned to bearing housing
      </div>
    </div>
  );
}

export function ControlRoomPage() {
  return (
    <AppShell>
      <PageHeader
        title="Control Room"
        description="Live 3D digital twin streaming historian values, with anomalies pinned to the exact physical zone."
      />
      <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <TwinVisual />
        <div className="space-y-4">
          <div className="rounded-lg border bg-card">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                <Cpu className="size-4 text-primary" /> Compressor B
              </div>
              <span className="rounded-full bg-risk-high/20 px-2 py-0.5 text-[11px] font-semibold text-risk-high">
                anomaly
              </span>
            </div>
            <ul>
              {TELEMETRY.map((t) => (
                <li
                  key={t.k}
                  className="flex items-center gap-3 border-t px-4 py-2.5 text-[13px] first:border-t-0"
                >
                  <Activity className="size-3.5 text-muted-foreground" />
                  <span className="flex-1">{t.k}</span>
                  <span className="num">{t.v}</span>
                  <span
                    className={`w-14 rounded-full px-2 py-0.5 text-center text-[11px] font-semibold ${TONE[t.tone]}`}
                  >
                    {t.state}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="mb-1 text-[13px] font-semibold">Root cause</div>
            <p className="text-[13px] text-muted-foreground">
              Stop model predicts a trip in ~26h; the survival model attributes it to bearing wear.
              Recommend inspection at the next weather window (T-72h).
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
