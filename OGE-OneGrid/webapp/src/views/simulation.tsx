import { FlaskConical } from "lucide-react";

import { AppShell, PageHeader } from "@/components/ops/AppShell";

// P1: Failure Simulation, ported from the report-app twin/Simulation view. Fast-forwards
// an asset to its predicted breakdown using the stop + survival models. Sample curve.
function Card({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-md border bg-card px-4 py-3">
      <div className="label-xs">{label}</div>
      <div className="mt-0.5 text-[15px] font-semibold">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

// A degrading-signal curve that crosses the limit at the predicted failure day.
function SimCurve() {
  const W = 800;
  const H = 300;
  const failX = 0.72; // fraction of horizon where it trips
  const limit = 78;
  const pts: string[] = [];
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    const base = 20 + t * 40;
    const accel = t > 0.45 ? Math.pow((t - 0.45) / 0.55, 2) * 55 : 0;
    const y = Math.min(100, base + accel + Math.sin(t * 22) * 2.2);
    pts.push(`${(t * W).toFixed(1)},${(H - (y / 100) * H).toFixed(1)}`);
  }
  const ly = H - (limit / 100) * H;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[300px] w-full" preserveAspectRatio="none">
      <line
        x1="0"
        y1={ly}
        x2={W}
        y2={ly}
        stroke="var(--color-risk-high)"
        strokeWidth="1.5"
        strokeDasharray="6 5"
      />
      <text x="8" y={ly - 6} className="fill-risk-high text-[11px]">
        stop threshold
      </text>
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth="2.5"
      />
      <line
        x1={failX * W}
        y1="0"
        x2={failX * W}
        y2={H}
        stroke="var(--color-risk-critical)"
        strokeWidth="1.5"
      />
      <circle cx={failX * W} cy={H - (limit / 100) * H} r="6" fill="var(--color-risk-critical)" />
      <text x={failX * W + 8} y="20" className="fill-risk-critical text-[12px] font-semibold">
        Predicted failure · Day 10.1
      </text>
    </svg>
  );
}

export function SimulationPage() {
  return (
    <AppShell>
      <PageHeader
        title="Failure Simulation"
        description="Fast-forward an asset up to 14 days and watch the twin drive a real breakdown from the stop + survival models."
      />
      <div className="space-y-4 p-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="rounded-lg border bg-card p-4">
            <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
              <FlaskConical className="size-4 text-primary" /> Compressor B — projected degradation
            </div>
            <SimCurve />
          </div>
          <div className="space-y-3">
            <Card label="Horizon" value="14 days" sub="Projected from live state" />
            <Card
              label="Driver"
              value="Stop + survival models"
              sub="Short-term stop · long-term hazard"
            />
            <Card label="Predicted trip" value="Day 10.1" sub="Bearing wear · root cause" />
            <Card label="Feedback" value="👍 / 👎" sub="Rate each predicted failure" />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
