import { MapPin, Tag, Ticket as TicketIcon, Lightbulb } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  ASSET_BY_ID,
  SITE_BY_ID,
  SOURCE_BY_ID,
  KIND_LABEL,
  CATEGORY_META,
  STATUS_COLOR,
  STATUS_LABEL,
  REL_LABEL,
  edgesFor,
  TICKETS,
  COST_RECS,
  PERF_RECS,
  SQL_LIFECYCLE,
  SQL_STATE_META,
  ESU_META,
  sqlState,
  type InfraAsset,
  type SqlMeta,
} from "@/lib/infra/infra-data";
import { liveAssetStatus } from "@/lib/infra/infra-live";
import { KindIcon, LiveMetricRow, StatusDot } from "./infra-ui";
import { fmtCost } from "./infra-format";

const SEV_COLOR: Record<string, string> = {
  sev1: "#ff5a5f",
  sev2: "#f0803c",
  sev3: "#f0b429",
  sev4: "#7d8597",
};

export function InfraAssetDetail({
  assetId,
  onSelect,
  onClose,
  compact,
}: {
  assetId: string;
  onSelect?: (id: string) => void;
  onClose?: () => void;
  compact?: boolean;
}) {
  const asset = ASSET_BY_ID.get(assetId);
  if (!asset) return null;
  const site = SITE_BY_ID.get(asset.siteId);
  const cat = CATEGORY_META[asset.category];
  const liveStatus = liveAssetStatus(asset);
  const edges = edgesFor(asset.id);
  const tickets = TICKETS.filter((t) => t.assetId === asset.id && t.status !== "resolved");
  const recs = [
    ...COST_RECS.filter((r) => r.assetId === asset.id).map((r) => ({
      kind: "Cost",
      title: r.title,
      detail: `Save ${fmtCost(r.monthlySaving)}/mo · ${r.detail}`,
    })),
    ...PERF_RECS.filter((r) => r.assetId === asset.id).map((r) => ({
      kind: "Perf",
      title: r.title,
      detail: r.detail,
    })),
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-card">
      {/* header */}
      <div
        className="flex items-start justify-between gap-2 border-b p-3"
        style={{ background: `linear-gradient(90deg, ${cat.color}14, transparent)` }}
      >
        <div className="flex min-w-0 items-start gap-2.5">
          <div
            className="grid size-9 shrink-0 place-items-center rounded-lg"
            style={{ background: `${cat.color}1f`, color: cat.color }}
          >
            <KindIcon kind={asset.kind} className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-foreground">{asset.name}</span>
              <StatusDot status={liveStatus} pulse />
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {KIND_LABEL[asset.kind]} · <span style={{ color: cat.color }}>{cat.label}</span>
            </div>
          </div>
        </div>
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
          style={{ background: `${STATUS_COLOR[liveStatus]}22`, color: STATUS_COLOR[liveStatus] }}
        >
          {STATUS_LABEL[liveStatus]}
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {asset.note && (
          <p className="rounded-lg bg-muted/40 p-2 text-[12px] text-muted-foreground">
            {asset.note}
          </p>
        )}

        {/* identity */}
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
          {site && (
            <div className="col-span-2 flex items-center gap-1 text-muted-foreground">
              <MapPin className="size-3" /> <span className="text-foreground">{site.name}</span> ·{" "}
              {site.location}
            </div>
          )}
          {asset.os && <Field label="OS" value={asset.os} />}
          {asset.sku && <Field label="SKU" value={asset.sku} />}
          {asset.ip && <Field label="Address" value={asset.ip} mono />}
          <Field label="Environment" value={asset.env.toUpperCase()} />
          {asset.costMonthly > 0 && (
            <Field label="Run-rate" value={`${fmtCost(asset.costMonthly)}/mo`} />
          )}
        </dl>

        {asset.sql && <SqlLifecycle meta={asset.sql} />}

        {/* live telemetry */}
        <section>
          <SectionTitle>
            <span className="inline-flex items-center gap-1.5 text-emerald-400">
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" /> Live telemetry
            </span>
          </SectionTitle>
          <div className="space-y-2">
            {asset.metrics.map((m) => (
              <LiveMetricRow key={m.key} asset={asset} metric={m} />
            ))}
          </div>
        </section>

        {/* relationships */}
        {edges.length > 0 && (
          <section>
            <SectionTitle>Relationships</SectionTitle>
            <div className="space-y-1">
              {edges.slice(0, compact ? 5 : 20).map((e) => {
                const isOut = e.from === asset.id;
                const otherId = isOut ? e.to : e.from;
                const other = ASSET_BY_ID.get(otherId);
                if (!other) return null;
                return (
                  <button
                    key={e.id}
                    onClick={() => onSelect?.(otherId)}
                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent"
                  >
                    <StatusDot status={other.status} size={7} />
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {isOut ? REL_LABEL[e.rel] : `${REL_LABEL[e.rel]} by`}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
                      {other.name}
                    </span>
                    <KindIcon
                      kind={other.kind}
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* source systems */}
        <section>
          <SectionTitle>Observed by</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {asset.sources.map((sid) => {
              const s = SOURCE_BY_ID.get(sid);
              if (!s) return null;
              return (
                <span
                  key={sid}
                  className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 text-[10.5px] text-foreground"
                >
                  <span
                    className="size-1.5 rounded-full"
                    style={{
                      background:
                        s.status === "connected"
                          ? "#3fb950"
                          : s.status === "degraded"
                            ? "#f0b429"
                            : "#4f8cff",
                    }}
                  />
                  {s.name.split(" · ")[0]}
                </span>
              );
            })}
          </div>
        </section>

        {/* tags */}
        <section>
          <SectionTitle>Tags</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(asset.tags).map(([k, v]) => (
              <span
                key={k}
                className="inline-flex items-center gap-1 rounded-md bg-muted/50 px-1.5 py-0.5 text-[10.5px] text-muted-foreground"
              >
                <Tag className="size-2.5" /> {k}=<span className="text-foreground">{v}</span>
              </span>
            ))}
          </div>
        </section>

        {/* incidents */}
        {tickets.length > 0 && (
          <section>
            <SectionTitle>Open incidents</SectionTitle>
            <div className="space-y-1.5">
              {tickets.map((t) => (
                <div key={t.id} className="rounded-lg border bg-muted/30 p-2">
                  <div className="flex items-center gap-1.5">
                    <TicketIcon
                      className="size-3 shrink-0"
                      style={{ color: SEV_COLOR[t.severity] }}
                    />
                    <span
                      className="rounded px-1 py-0.5 text-[9px] font-bold uppercase"
                      style={{
                        background: `${SEV_COLOR[t.severity]}22`,
                        color: SEV_COLOR[t.severity],
                      }}
                    >
                      {t.severity}
                    </span>
                    <span className="truncate text-[11.5px] font-medium text-foreground">
                      {t.title}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10.5px] text-muted-foreground">
                    {t.id} · {t.assignee} · {t.team}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* recommendations */}
        {recs.length > 0 && (
          <section>
            <SectionTitle>Recommendations</SectionTitle>
            <div className="space-y-1.5">
              {recs.map((r, i) => (
                <div
                  key={i}
                  className="flex gap-2 rounded-lg border border-primary/20 bg-primary/5 p-2"
                >
                  <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <div className="text-[11.5px] font-semibold text-foreground">{r.title}</div>
                    <div className="text-[10.5px] text-muted-foreground">{r.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {onClose && (
        <button
          onClick={onClose}
          className="shrink-0 border-t px-3 py-2 text-[11px] font-medium text-muted-foreground hover:bg-accent"
        >
          Close
        </button>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[9.5px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("truncate text-[11.5px] text-foreground", mono && "font-mono")}>{value}</dd>
    </div>
  );
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

function SqlLifecycle({ meta }: { meta: SqlMeta }) {
  const state = sqlState(meta.version);
  const sm = SQL_STATE_META[state];
  const esu = ESU_META[meta.esuStatus];
  const info = SQL_LIFECYCLE[meta.version];
  const eol = info.extendedEnd
    ? new Date(info.extendedEnd).toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : "evergreen";
  return (
    <section
      className="rounded-lg border p-2.5"
      style={{ background: `${sm.color}0d`, borderColor: `${sm.color}33` }}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <SectionTitle>SQL lifecycle</SectionTitle>
        <span
          className="rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase"
          style={{ background: `${sm.color}22`, color: sm.color }}
        >
          {sm.label}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
        <Field
          label="Engine"
          value={meta.engine === "SQL Server" ? `SQL Server ${meta.version}` : meta.engine}
        />
        <Field label="Edition" value={`${meta.edition} · ${meta.cores} cores`} />
        <Field label="End of life" value={eol} />
        <Field label="ESU" value={esu.label} />
        {meta.build && <Field label="Build" value={meta.build} mono />}
        <Field label="Databases" value={String(meta.databases)} />
      </dl>
    </section>
  );
}

export type { InfraAsset };
