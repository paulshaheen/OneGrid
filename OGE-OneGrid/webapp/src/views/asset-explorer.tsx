import { useState } from "react";
import { Layers } from "lucide-react";

import { AppShell, PageHeader } from "@/components/ops/AppShell";
import { cn } from "@/lib/utils";

// P1: Asset Explorer — the unified, asset-centric risk home that resolves the
// weather/twin overlap. Total = blend of weather exposure + equipment reliability.
// Sample data until wired to Fabric in P2.
const TABS = [
  ["total", "Total risk"],
  ["exposure", "Weather exposure"],
  ["reliability", "Reliability"],
  ["registry", "Registry"],
] as const;
type Tab = (typeof TABS)[number][0];

const TONE: Record<string, string> = {
  critical: "bg-risk-critical/20 text-risk-critical",
  high: "bg-risk-high/20 text-risk-high",
  monitor: "bg-risk-monitor/20 text-risk-monitor",
  low: "bg-risk-normal/20 text-risk-normal",
};

const TOTAL = [
  ["Thunder Horse", "0.86", "0.30", "0.79", "critical"],
  ["Mad Dog", "0.64", "0.20", "0.58", "high"],
  ["Atlantis", "0.58", "0.44", "0.55", "high"],
  ["Compressor B", "0.22", "0.71", "0.63", "high"],
  ["Na Kika", "0.32", "0.18", "0.30", "monitor"],
  ["Holstein", "0.19", "0.12", "0.17", "low"],
];
const EXPOSURE = [
  ["Thunder Horse", 0.86, "critical"],
  ["Mad Dog", 0.64, "high"],
  ["Atlantis", 0.58, "high"],
  ["Na Kika", 0.32, "monitor"],
  ["Holstein", 0.19, "low"],
  ["Horn Mountain", 0.12, "low"],
] as const;
const RELIABILITY = [
  ["Compressor B", "bearing wear", "62%", "41%", "high"],
  ["Boiler 3", "tube fouling", "70%", "55%", "high"],
  ["Pump 12", "seal drift", "88%", "79%", "monitor"],
  ["Turbine 4", "—", "98%", "96%", "low"],
];
const REGISTRY = [
  ["Thunder Horse", "Platform", "Central Gulf", "BP", "critical"],
  ["Mad Dog", "Platform", "Central Gulf", "BP", "high"],
  ["Atlantis", "Platform", "Central Gulf", "BP", "high"],
  ["Compressor B", "Equipment", "Atlantis", "—", "high"],
  ["Na Kika", "FPU", "Central Gulf", "Shell", "monitor"],
  ["Holstein", "Spar", "Central Gulf", "—", "low"],
];

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </th>
  );
}
function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span
      className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize", TONE[tone])}
    >
      {children}
    </span>
  );
}

export function AssetExplorerPage() {
  const [tab, setTab] = useState<Tab>("total");
  return (
    <AppShell>
      <PageHeader
        title="Asset Explorer"
        description="Explore every asset — weather exposure blended with equipment reliability into one risk."
      />
      <div className="p-5">
        <div className="mb-3 inline-flex gap-1 rounded-lg border bg-card p-1">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-[13px] font-medium",
                tab === id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "exposure" ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {EXPOSURE.map(([name, v, tone]) => (
              <div key={name} className="rounded-lg border bg-card p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[13px] font-semibold">{name}</span>
                  <Chip tone={tone}>{Math.round((v as number) * 100)}</Chip>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-raised">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${(v as number) * 100}%`, background: "var(--color-primary)" }}
                  />
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  forecast × fragility × exposure
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card">
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  {tab === "total" && (
                    <>
                      <Th>Asset</Th>
                      <Th>Weather</Th>
                      <Th>Reliability</Th>
                      <Th>Total</Th>
                    </>
                  )}
                  {tab === "reliability" && (
                    <>
                      <Th>Asset</Th>
                      <Th>Failure mechanism</Th>
                      <Th>7d surv</Th>
                      <Th>14d surv</Th>
                      <Th>Risk</Th>
                    </>
                  )}
                  {tab === "registry" && (
                    <>
                      <Th>Asset</Th>
                      <Th>Type</Th>
                      <Th>Region</Th>
                      <Th>Operator</Th>
                      <Th>Total risk</Th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {tab === "total" &&
                  TOTAL.map((r) => (
                    <tr key={r[0]} className="border-t">
                      <td className="px-4 py-2.5 font-medium">{r[0]}</td>
                      <td className="num px-4 py-2.5 text-muted-foreground">{r[1]}</td>
                      <td className="num px-4 py-2.5 text-muted-foreground">{r[2]}</td>
                      <td className="px-4 py-2.5">
                        <Chip tone={r[4]}>{r[3]}</Chip>
                      </td>
                    </tr>
                  ))}
                {tab === "reliability" &&
                  RELIABILITY.map((r) => (
                    <tr key={r[0]} className="border-t">
                      <td className="px-4 py-2.5 font-medium">{r[0]}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{r[1]}</td>
                      <td className="num px-4 py-2.5">{r[2]}</td>
                      <td className="num px-4 py-2.5">{r[3]}</td>
                      <td className="px-4 py-2.5">
                        <Chip tone={r[4]}>{r[4]}</Chip>
                      </td>
                    </tr>
                  ))}
                {tab === "registry" &&
                  REGISTRY.map((r) => (
                    <tr key={r[0]} className="border-t">
                      <td className="px-4 py-2.5 font-medium">{r[0]}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{r[1]}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{r[2]}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{r[3]}</td>
                      <td className="px-4 py-2.5">
                        <Chip tone={r[4]}>{r[4]}</Chip>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {tab === "total" && (
              <div className="border-t px-4 py-2.5 text-[12px] text-muted-foreground">
                <Layers className="mr-1 inline size-3.5 text-primary" />
                Total = blend of weather exposure (Weather) and equipment reliability (Digital
                Twin).
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
