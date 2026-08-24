import { useMemo, useState } from "react";
import { ArrowUpDown, Search } from "lucide-react";

import { AppShell, PageHeader } from "@/components/ops/AppShell";
import { OpsMap } from "@/components/ops/OpsMap";
import { AssetDetailPanel } from "@/components/ops/AssetDetailPanel";
import { RiskBadge } from "@/components/ops/RiskBadge";
import { SkeletonRows } from "@/components/ops/Skeleton";
import { useOpsBase } from "@/components/ops/ops-nav";
import { useOpsSnapshot } from "@/lib/hooks/use-ops-data";
import { ASSET_TYPE_LABEL, RISK_ORDER } from "@/lib/format";
import type { RiskLevel } from "@/lib/domain/types";

type SortKey = "score" | "eta" | "name" | "wind";

export function RiskPage() {
  const base = useOpsBase();
  const { assets, risks, riskMap, event, isLoading } = useOpsSnapshot(base, 120);
  const [q, setQ] = useState("");
  const [level, setLevel] = useState<RiskLevel | "all">("all");
  const [sort, setSort] = useState<SortKey>("score");
  const [selected, setSelected] = useState<string | null>(null);

  const rows = useMemo(() => {
    const list = risks
      .map((r) => ({ risk: r, asset: assets.find((a) => a.id === r.assetId)! }))
      .filter((x) => x.asset)
      .filter((x) => (level === "all" ? true : x.risk.level === level))
      .filter((x) =>
        q
          ? `${x.asset.name} ${x.asset.id} ${x.asset.region} ${x.asset.operator}`
              .toLowerCase()
              .includes(q.toLowerCase())
          : true,
      );
    list.sort((a, b) => {
      if (sort === "score") return b.risk.score - a.risk.score;
      if (sort === "wind") return b.risk.forecastWindMph - a.risk.forecastWindMph;
      if (sort === "eta") return (a.risk.hoursToImpact ?? 9999) - (b.risk.hoursToImpact ?? 9999);
      return a.asset.name.localeCompare(b.asset.name);
    });
    return list;
  }, [risks, assets, level, q, sort]);

  const selectedAsset = assets.find((a) => a.id === selected) ?? null;
  const counts = RISK_ORDER.map((l) => ({
    level: l,
    n: risks.filter((r) => r.level === l).length,
  }));

  return (
    <AppShell>
      <PageHeader
        title="Asset Risk"
        description="Every score is explainable: proximity to the predicted centerline, forecast wind and rainfall, time to impact, storm intensity, asset criticality and asset type."
      />
      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <div className="panel grid grid-cols-2 divide-x sm:grid-cols-5">
            {counts.map((c) => (
              <button
                key={c.level}
                onClick={() => setLevel(level === c.level ? "all" : c.level)}
                className={`px-4 py-3 text-left transition-colors hover:bg-accent/50 ${level === c.level ? "bg-accent/60" : ""}`}
              >
                <RiskBadge level={c.level} />
                <div className="num mt-1.5 text-xl font-semibold">{c.n}</div>
              </button>
            ))}
          </div>

          <div className="panel">
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
              <div className="relative">
                <Search className="absolute top-2 left-2 size-3.5 text-muted-foreground" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search assets, regions, operators"
                  className="w-64 rounded-sm border bg-card py-1.5 pr-2 pl-7 text-xs outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="rounded-sm border bg-card px-2 py-1.5 text-xs"
              >
                <option value="score">Sort: risk score</option>
                <option value="eta">Sort: impact ETA</option>
                <option value="wind">Sort: forecast wind</option>
                <option value="name">Sort: asset name</option>
              </select>
              <span className="ml-auto text-[11px] text-muted-foreground">
                {rows.length} assets
              </span>
            </div>
            <div className="max-h-[640px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card">
                  <tr className="text-left text-[11px] text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Asset</th>
                    <th className="px-4 py-2 font-medium">Type</th>
                    <th className="px-4 py-2 font-medium">Region</th>
                    <th className="px-4 py-2 font-medium">
                      <span className="inline-flex items-center gap-1">
                        Risk <ArrowUpDown className="size-3" />
                      </span>
                    </th>
                    <th className="px-4 py-2 font-medium">Impact ETA</th>
                    <th className="px-4 py-2 font-medium">Primary threat</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && rows.length === 0 && <SkeletonRows rows={10} cols={6} />}
                  {rows.map(({ risk, asset }) => (
                    <tr
                      key={asset.id}
                      onClick={() => setSelected(asset.id)}
                      className={`cursor-pointer border-t hover:bg-accent/50 ${selected === asset.id ? "bg-accent/60" : ""}`}
                    >
                      <td className="px-4 py-2 font-medium">{asset.name}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {ASSET_TYPE_LABEL[asset.type]}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{asset.region}</td>
                      <td className="px-4 py-2">
                        <RiskBadge level={risk.level} score={risk.score} />
                      </td>
                      <td className="num px-4 py-2">{risk.hoursToImpact ?? "—"} h</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {risk.forecastWindMph >= 74
                          ? `${risk.forecastWindMph} mph sustained wind`
                          : risk.rainfallIn >= 4
                            ? `${risk.rainfallIn} in rainfall`
                            : "Monitoring only"}
                      </td>
                    </tr>
                  ))}
                  {!isLoading && rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                        {assets.length === 0
                          ? "No assets yet — add data from the Operations Overview to populate the risk register."
                          : "No assets match the current search or filter."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="panel h-[340px] overflow-hidden">
            <OpsMap
              className="h-full w-full"
              assets={assets}
              risks={riskMap}
              event={event}
              layers={{ assets: true, track: true, wind: true }}
              selectedId={selected}
              onSelect={setSelected}
            />
          </div>
          {selectedAsset ? (
            <div className="panel max-h-[520px] overflow-hidden">
              <AssetDetailPanel
                asset={selectedAsset}
                risk={riskMap.get(selectedAsset.id)}
                event={event}
                allAssets={assets}
                onClose={() => setSelected(null)}
                onSelect={setSelected}
              />
            </div>
          ) : (
            <div className="panel p-4 text-xs text-muted-foreground">
              Select an asset to synchronize the table, map and risk explanation.
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
