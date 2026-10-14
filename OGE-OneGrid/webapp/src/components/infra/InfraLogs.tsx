import { useMemo, useState } from "react";
import { ScrollText, Search, Pause, Play } from "lucide-react";

import { cn } from "@/lib/utils";
import { ASSET_BY_ID, SOURCE_BY_ID, type LogLevel } from "@/lib/infra/infra-data";
import { useLogTail } from "@/lib/infra/infra-live";
import { fmtMsAgo } from "./infra-format";

const LEVELS: LogLevel[] = ["critical", "error", "warn", "info", "trace"];
const LEVEL_COLOR: Record<LogLevel, string> = {
  critical: "#ff5a5f",
  error: "#ff7a5c",
  warn: "#f0b429",
  info: "#4f8cff",
  trace: "#7d8597",
};

export function InfraLogs({ onOpenAsset }: { onOpenAsset?: (id: string) => void }) {
  const live = useLogTail();
  const [frozen, setFrozen] = useState(false);
  const [snapshot, setSnapshot] = useState(live);
  const logs = frozen ? snapshot : live;

  const [active, setActive] = useState<Set<LogLevel>>(new Set(LEVELS));
  const [source, setSource] = useState<string>("all");
  const [q, setQ] = useState("");

  const sources = useMemo(() => Array.from(new Set(live.map((l) => l.source))), [live]);
  const query = q.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      logs.filter(
        (l) =>
          active.has(l.level) &&
          (source === "all" || l.source === source) &&
          (!query ||
            l.message.toLowerCase().includes(query) ||
            l.assetId.toLowerCase().includes(query) ||
            l.table.toLowerCase().includes(query)),
      ),
    [logs, active, source, query],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of live) c[l.level] = (c[l.level] ?? 0) + 1;
    return c;
  }, [live]);

  const kql = useMemo(() => {
    const parts = ["union AzureDiagnostics, ContainerInsights, PiPoints, HeartBeat"];
    const lv = LEVELS.filter((l) => active.has(l));
    if (lv.length && lv.length < LEVELS.length)
      parts.push(`| where Level in (${lv.map((l) => `"${l}"`).join(", ")})`);
    if (source !== "all")
      parts.push(
        `| where SourceSystem == "${SOURCE_BY_ID.get(source)?.name.split(" · ")[0] ?? source}"`,
      );
    if (query) parts.push(`| where Message has "${query}"`);
    parts.push("| order by TimeGenerated desc");
    return parts.join("\n");
  }, [active, source, query]);

  const toggle = (l: LogLevel) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(l)) next.delete(l);
      else next.add(l);
      return next;
    });

  const freeze = () => {
    if (!frozen) setSnapshot(live);
    setFrozen((f) => !f);
  };

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {/* KQL + counts */}
      <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
        <div className="rounded-xl border bg-card p-3">
          <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <ScrollText className="size-3.5 text-primary" /> Log Analytics query
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-2.5 font-mono text-[11px] leading-relaxed text-foreground">
            {kql}
          </pre>
        </div>
        <div className="grid grid-cols-5 gap-2 lg:w-[360px]">
          {LEVELS.map((l) => (
            <div key={l} className="rounded-lg border bg-card p-2 text-center">
              <div
                className="text-base font-bold tabular-nums leading-none"
                style={{ color: LEVEL_COLOR[l] }}
              >
                {counts[l] ?? 0}
              </div>
              <div className="mt-1 text-[9px] uppercase tracking-wide text-muted-foreground">
                {l}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {LEVELS.map((l) => (
            <button
              key={l}
              onClick={() => toggle(l)}
              className={cn(
                "rounded-md border px-2 py-1 text-[10.5px] font-semibold uppercase transition-opacity",
                !active.has(l) && "opacity-40",
              )}
              style={{
                background: `${LEVEL_COLOR[l]}18`,
                color: LEVEL_COLOR[l],
                borderColor: `${LEVEL_COLOR[l]}44`,
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="rounded-md border bg-card px-2 py-1 text-[11.5px] outline-none focus:border-primary/50"
        >
          <option value="all">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {SOURCE_BY_ID.get(s)?.name.split(" · ")[0] ?? s}
            </option>
          ))}
        </select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter messages…"
            className="w-48 rounded-md border bg-card py-1 pl-7 pr-2 text-[11.5px] outline-none focus:border-primary/50"
          />
        </div>
        <button
          onClick={freeze}
          className={cn(
            "ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold",
            frozen ? "bg-amber-500/15 text-amber-400" : "text-muted-foreground hover:bg-accent",
          )}
        >
          {frozen ? (
            <>
              <Play className="size-3.5" /> Resume
            </>
          ) : (
            <>
              <Pause className="size-3.5" /> Pause tail
            </>
          )}
        </button>
      </div>

      {/* table */}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border bg-card">
        <table className="w-full border-collapse text-[11.5px]">
          <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
            <tr className="border-b text-left text-[9.5px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-semibold">Time</th>
              <th className="px-2 py-2 font-semibold">Level</th>
              <th className="px-2 py-2 font-semibold">Source</th>
              <th className="px-2 py-2 font-semibold">Table</th>
              <th className="px-2 py-2 font-semibold">Asset</th>
              <th className="px-3 py-2 font-semibold">Message</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {filtered.map((l) => {
              const asset = ASSET_BY_ID.get(l.assetId);
              return (
                <tr
                  key={l.id}
                  className="border-b border-border/40 last:border-0 hover:bg-accent/40"
                >
                  <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                    {fmtMsAgo(l.tsMsAgo)}
                  </td>
                  <td className="px-2 py-1.5">
                    <span
                      className="rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase"
                      style={{
                        background: `${LEVEL_COLOR[l.level]}22`,
                        color: LEVEL_COLOR[l.level],
                      }}
                    >
                      {l.level}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">
                    {SOURCE_BY_ID.get(l.source)?.name.split(" · ")[0] ?? l.source}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">{l.table}</td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {asset ? (
                      <button
                        onClick={() => onOpenAsset?.(asset.id)}
                        className="text-primary hover:underline"
                      >
                        {asset.name}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">{l.assetId}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-foreground">{l.message}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-8 text-center font-sans text-[12px] text-muted-foreground"
                >
                  No log lines match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
