import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { CloudLightning, Factory, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { useOpsBase } from "./ops-nav";
import { assetsQuery, eventsQuery } from "@/lib/hooks/use-ops-data";

/**
 * Header search across equipment/sites and weather systems. Data is fetched
 * lazily (only once the field is focused) and results are grouped so the user
 * can jump straight to the Asset Explorer or the Live Map.
 */
export function GlobalSearch() {
  const base = useOpsBase();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const assets = useQuery({ ...assetsQuery(base), enabled: open });
  const events = useQuery({ ...eventsQuery(base), enabled: open });

  const ql = q.trim().toLowerCase();
  const assetHits = useMemo(() => {
    if (!ql) return [];
    return (assets.data ?? [])
      .filter(
        (a) =>
          (a.name ?? "").toLowerCase().includes(ql) ||
          (a.id ?? "").toLowerCase().includes(ql) ||
          (a.type ?? "").toLowerCase().includes(ql),
      )
      .slice(0, 6);
  }, [assets.data, ql]);
  const eventHits = useMemo(() => {
    if (!ql) return [];
    return (events.data ?? [])
      .filter(
        (e) =>
          (e.name ?? "").toLowerCase().includes(ql) ||
          (e.region ?? "").toLowerCase().includes(ql),
      )
      .slice(0, 4);
  }, [events.data, ql]);

  const go = (to: string) => {
    setOpen(false);
    setQ("");
    router.navigate({ to: to === "/" ? base : `${base}${to}` });
  };
  const hasResults = assetHits.length + eventHits.length > 0;

  return (
    <div className="relative hidden md:block">
      <Search className="absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search assets, locations…"
        className="w-64 rounded-full border bg-card/60 py-1.5 pr-3 pl-8 text-[12px] outline-none focus:ring-1 focus:ring-primary/40"
      />
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1.5 w-80 rounded-xl border bg-popover p-1.5 shadow-2xl">
            {!ql && (
              <div className="px-2 py-2 text-[11px] text-muted-foreground">
                Type to search equipment, sites and weather…
              </div>
            )}
            {ql && !hasResults && (
              <div className="px-2 py-2 text-[11px] text-muted-foreground">
                No matches for “{q}”.
              </div>
            )}
            {eventHits.length > 0 && (
              <div className="mb-1">
                <div className="px-2 pb-1 pt-1 text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Weather
                </div>
                {eventHits.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => go("/map")}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-accent"
                  >
                    <CloudLightning className="size-4 shrink-0 text-sky-400" />
                    <span className="min-w-0 flex-1 truncate">{e.name}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {(e.region ?? "").replace(/_/g, " ")}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {assetHits.length > 0 && (
              <div>
                <div className="px-2 pb-1 pt-1 text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Equipment &amp; sites
                </div>
                {assetHits.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => go("/asset-explorer")}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-accent"
                  >
                    <Factory className="size-4 shrink-0 text-emerald-400" />
                    <span className="min-w-0 flex-1 truncate">{a.name ?? a.id}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {(a.type ?? "").replace(/_/g, " ")}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
