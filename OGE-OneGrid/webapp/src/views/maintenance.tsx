import { Wrench } from "lucide-react";

import { AppShell, PageHeader } from "@/components/ops/AppShell";

// P1: Maintenance, ported from the report-app twin/Maintenance view. Work orders are
// driven by the survival + stop models. Sample data until wired to Fabric in P2.
const WORK = [
  {
    asset: "Compressor B",
    mech: "Bearing wear",
    due: "26h",
    sev: "critical",
    crew: "Rotating equipment",
  },
  { asset: "Boiler 3", mech: "Tube fouling", due: "4d", sev: "high", crew: "Fired equipment" },
  { asset: "Pump 12", mech: "Seal drift", due: "9d", sev: "monitor", crew: "Rotating equipment" },
  {
    asset: "Turbine 4",
    mech: "Vibration trend",
    due: "12d",
    sev: "monitor",
    crew: "Rotating equipment",
  },
];

const SEV_CLASS: Record<string, string> = {
  critical: "bg-risk-critical/20 text-risk-critical",
  high: "bg-risk-high/20 text-risk-high",
  monitor: "bg-risk-monitor/20 text-risk-monitor",
};

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: string;
}) {
  return (
    <div className="rounded-md border bg-card px-4 py-3">
      <div className="label-xs">{label}</div>
      <div className={`num text-2xl leading-none font-semibold ${tone ?? ""}`}>{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

export function MaintenancePage() {
  return (
    <AppShell>
      <PageHeader
        title="Maintenance"
        description="Work orders driven by the digital twin — survival and stop models rank what to fix and when."
      />
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Open work orders" value="4" sub="Across the fleet" />
          <Stat label="Critical" value="1" sub="Compressor B" tone="text-risk-critical" />
          <Stat label="Crews engaged" value="2" sub="Rotating · Fired" />
          <Stat label="Next weather window" value="T-72h" sub="Plan around the storm" />
        </div>

        <div className="rounded-lg border bg-card">
          <div className="flex items-center gap-2 border-b px-4 py-3 text-[13px] font-semibold">
            <Wrench className="size-4 text-primary" /> Work orders
          </div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">Asset</th>
                <th className="px-4 py-2 font-medium">Failure mechanism</th>
                <th className="px-4 py-2 font-medium">Due</th>
                <th className="px-4 py-2 font-medium">Crew</th>
                <th className="px-4 py-2 font-medium">Severity</th>
              </tr>
            </thead>
            <tbody>
              {WORK.map((w) => (
                <tr key={w.asset} className="border-t">
                  <td className="px-4 py-2.5 font-medium">{w.asset}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{w.mech}</td>
                  <td className="num px-4 py-2.5">{w.due}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{w.crew}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${SEV_CLASS[w.sev]}`}
                    >
                      {w.sev}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
