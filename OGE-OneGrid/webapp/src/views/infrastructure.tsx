import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Boxes,
  Network,
  Plug,
  CircleDollarSign,
  Gauge,
  ScrollText,
  Ticket,
  Server,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { fleetStats } from "@/lib/infra/infra-data";
import { AppShell } from "@/components/ops/AppShell";
import { StatusDot } from "@/components/infra/infra-ui";
import { InfraOperations } from "@/components/infra/InfraOperations";
import { InfraAssets3D } from "@/components/infra/InfraAssets3D";
import { InfraTopology } from "@/components/infra/InfraTopology";
import { InfraSources } from "@/components/infra/InfraSources";
import { InfraCost } from "@/components/infra/InfraCost";
import { InfraPerformance } from "@/components/infra/InfraPerformance";
import { InfraLogs } from "@/components/infra/InfraLogs";
import { InfraTickets } from "@/components/infra/InfraTickets";

type TabId =
  "operations" | "assets" | "topology" | "sources" | "cost" | "performance" | "logs" | "tickets";
const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: "operations", label: "Operations", icon: Activity },
  { id: "assets", label: "Assets", icon: Boxes },
  { id: "topology", label: "Topology", icon: Network },
  { id: "sources", label: "Source systems", icon: Plug },
  { id: "cost", label: "Cost", icon: CircleDollarSign },
  { id: "performance", label: "Performance", icon: Gauge },
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "tickets", label: "Service tickets", icon: Ticket },
];
const TAB_IDS = new Set<TabId>(TABS.map((t) => t.id));
const SCROLLING: Set<TabId> = new Set(["operations", "sources", "cost", "performance"]);

export function InfrastructurePage() {
  const router = useRouter();
  const search = useRouterState({
    select: (s) => s.location.search as { tab?: string; asset?: string },
  });

  const initialTab = (
    search.tab && TAB_IDS.has(search.tab as TabId) ? search.tab : "operations"
  ) as TabId;
  const [tab, setTab] = useState<TabId>(initialTab);
  const [selected, setSelected] = useState<string | null>(search.asset ?? null);

  // reflect tab + selected into the URL (deep-linkable, no history spam). Skip the
  // redundant navigate on first mount when the URL already matches our state.
  useEffect(() => {
    if (search.tab === tab && (search.asset ?? null) === selected) return;
    router.navigate({
      to: "/app/infrastructure",
      search: { tab, ...(selected ? { asset: selected } : {}) },
      replace: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selected]);

  const openAsset = useCallback((id: string) => {
    setSelected(id);
    setTab("assets");
  }, []);
  const selectAsset = useCallback((id: string | null) => setSelected(id), []);

  const stats = useMemo(() => fleetStats(), []);
  const healthColor =
    stats.healthScore >= 90 ? "#3fb950" : stats.healthScore >= 75 ? "#f0b429" : "#ff5a5f";
  const worst = stats.byStatus.critical
    ? "critical"
    : stats.byStatus.warning
      ? "warning"
      : "healthy";

  return (
    <AppShell fullHeight>
      <div className="flex h-full flex-col">
        {/* header */}
        <div className="og-header-skin border-b bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-0 pt-3">
            <div className="flex items-center gap-2.5">
              <div className="grid size-8 place-items-center rounded-lg bg-primary/15 text-primary">
                <Server className="size-5" />
              </div>
              <div>
                <h1 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
                  Infrastructure
                  <span className="rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                    IT / OT
                  </span>
                </h1>
                <p className="text-[11px] text-muted-foreground">
                  The IT estate that runs OneGrid — servers, data, network, Azure Local &amp; OT,
                  end to end.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 text-[11px]">
              <div className="flex items-center gap-1.5">
                <StatusDot status={worst} pulse />
                <span className="text-muted-foreground">Fleet health</span>
                <span className="font-semibold tabular-nums" style={{ color: healthColor }}>
                  {stats.healthScore}%
                </span>
              </div>
              <div className="hidden items-center gap-1.5 sm:flex">
                <span className="text-muted-foreground">Open incidents</span>
                <span className="font-semibold tabular-nums text-foreground">
                  {stats.openIncidents}
                </span>
              </div>
              <div className="hidden items-center gap-1.5 md:flex">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
                <span className="text-emerald-400">Live</span>
              </div>
            </div>
          </div>

          {/* sub-tabs */}
          <div className="flex gap-0.5 overflow-x-auto px-3 pt-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-[12.5px] font-medium transition-colors",
                  tab === t.id
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <t.icon className="size-4" /> {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* active panel */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {tab === "assets" ? (
            <InfraAssets3D selectedId={selected} onSelect={selectAsset} />
          ) : tab === "topology" ? (
            <InfraTopology selectedId={selected} onSelect={selectAsset} />
          ) : tab === "logs" ? (
            <InfraLogs onOpenAsset={openAsset} />
          ) : tab === "tickets" ? (
            <InfraTickets onOpenAsset={openAsset} />
          ) : (
            <div className={cn("h-full", SCROLLING.has(tab) && "overflow-y-auto")}>
              {tab === "operations" && (
                <InfraOperations onOpenAsset={openAsset} onGoTab={(t) => setTab(t as TabId)} />
              )}
              {tab === "sources" && <InfraSources onOpenAsset={openAsset} />}
              {tab === "cost" && <InfraCost onOpenAsset={openAsset} />}
              {tab === "performance" && <InfraPerformance onOpenAsset={openAsset} />}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
