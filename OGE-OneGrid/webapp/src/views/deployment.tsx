import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, Check, CloudSun, Database, ExternalLink, HelpCircle, History, Loader2, PlayCircle, Shield, Sparkles } from "lucide-react";
import { useState } from "react";

import { AppShell, PageHeader } from "@/components/ops/AppShell";
import { OpsLink, useOpsBase } from "@/components/ops/ops-nav";
import { layersQuery } from "@/lib/hooks/use-ops-data";
import { isEntraConfigured } from "@/lib/auth/config";
import { getServiceConfig } from "@/lib/services/azure-config";
import { getDataPlaneStatus, type ProbeResult } from "@/lib/services/azure/server";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Honest, read-only deployment status. Infrastructure is provisioned by the
// Bicep/ARM template ("Deploy to Azure"), not from the app — so this page reports
// what is actually wired to this deployment rather than pretending to configure it.

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

type ReportApiStatus = {
  ok: boolean;
  configured?: boolean;
  capacityPaused?: boolean;
  connectionError?: boolean;
  message?: string;
};

const ROLES: [string, string][] = [
  ["Viewer", "Read-only access to dashboards, map and alerts"],
  ["Operator", "Acknowledge and resolve alerts, adjust thresholds for owned assets"],
  ["Analyst", "Configure risk weightings, forecast providers and reporting"],
  ["Administrator", "Manage tenancy, data connections, roles and deployment settings"],
];

const SECURITY: string[] = [
  "Microsoft Entra sign-in with your directory's MFA and conditional access",
  "Managed identity for service-to-service access — no keys in the app or source",
  "Data-plane roles (GeoCatalog, Storage, AI) assigned to the app identity at deploy time",
  "Non-secret configuration published at runtime; secrets never reach the browser",
];

// Initial-condition sources the Aurora pipeline supports (see aurora_pipeline/
// initial_conditions.py). HRES = public WeatherBench2 archive (2016–2022, ECMWF);
// GFS = public NOAA real-time analysis on AWS Open Data (2021 → today). Each drives
// the same detect → forecast → publish cycle; only the starting snapshot differs.
type IcSource = "hres_t0" | "gfs";

const TODAY = new Date().toISOString().slice(0, 10);
const SOURCE_OPTIONS: { id: IcSource; label: string; blurb: string; min: string; max: string }[] = [
  { id: "hres_t0", label: "ECMWF HRES", blurb: "WeatherBench2 archive · 2016–2022", min: "2016-01-01", max: "2022-12-31" },
  { id: "gfs", label: "NOAA GFS", blurb: "Real-time analysis · 2021–now", min: "2021-02-27", max: TODAY },
];

// One-click historical storms. The bbox is the genesis-detection search box; numSteps
// × 6h is the forecast horizon. Sent to /api/aurora/run, which starts the Aurora job
// with these as per-execution env overrides (ANALYSIS_TIME / DETECTION_BBOX / …).
// `source` decides which archive the snapshot comes from — pre-2023 storms use HRES,
// recent ones use GFS (the only public source that covers them).
type StormPreset = {
  id: string;
  label: string;
  sub: string;
  source: IcSource;
  analysisTime: string;
  bbox: string;
  numSteps: number;
};

const STORM_PRESETS: StormPreset[] = [
  { id: "ida", label: "Hurricane Ida", sub: "Aug 2021 · Louisiana", source: "hres_t0", analysisTime: "2021-08-29T00:00", bbox: "-100,15,-70,35", numSteps: 12 },
  { id: "laura", label: "Hurricane Laura", sub: "Aug 2020 · SW Louisiana", source: "hres_t0", analysisTime: "2020-08-26T12:00", bbox: "-100,15,-70,35", numSteps: 12 },
  { id: "ian", label: "Hurricane Ian", sub: "Sep 2022 · SW Florida", source: "hres_t0", analysisTime: "2022-09-27T12:00", bbox: "-90,18,-76,32", numSteps: 12 },
  { id: "michael", label: "Hurricane Michael", sub: "Oct 2018 · FL Panhandle", source: "hres_t0", analysisTime: "2018-10-09T12:00", bbox: "-95,18,-78,32", numSteps: 12 },
  { id: "harvey", label: "Hurricane Harvey", sub: "Aug 2017 · Texas coast", source: "hres_t0", analysisTime: "2017-08-25T00:00", bbox: "-100,18,-88,32", numSteps: 12 },
  { id: "irma", label: "Hurricane Irma", sub: "Sep 2017 · Florida", source: "hres_t0", analysisTime: "2017-09-09T00:00", bbox: "-88,18,-74,30", numSteps: 12 },
  { id: "otis", label: "Hurricane Otis", sub: "Oct 2023 · Acapulco", source: "gfs", analysisTime: "2023-10-24T12:00", bbox: "-105,12,-95,22", numSteps: 12 },
  { id: "beryl", label: "Hurricane Beryl", sub: "Jul 2024 · Caribbean", source: "gfs", analysisTime: "2024-07-01T00:00", bbox: "-78,10,-58,22", numSteps: 12 },
  { id: "helene", label: "Hurricane Helene", sub: "Sep 2024 · FL Big Bend", source: "gfs", analysisTime: "2024-09-25T12:00", bbox: "-90,20,-78,32", numSteps: 12 },
  { id: "milton", label: "Hurricane Milton", sub: "Oct 2024 · FL Gulf coast", source: "gfs", analysisTime: "2024-10-09T00:00", bbox: "-95,18,-80,30", numSteps: 12 },
];

// A run is still in flight — the job hasn't reported a terminal status yet.
const ACTIVE_RUN_STATUSES = new Set(["Running", "Pending", "InProgress"]);

const CYCLE_HOURS = ["00", "06", "12", "18"] as const;
const REGION_PRESETS: { label: string; bbox: string }[] = [
  { label: "Gulf of Mexico + Caribbean", bbox: "-100,15,-70,35" },
  { label: "Texas coast", bbox: "-100,18,-88,32" },
  { label: "Louisiana / Mississippi", bbox: "-95,20,-83,32" },
  { label: "Florida + Straits", bbox: "-88,18,-74,30" },
];

export function DeploymentPage() {
  const base = useOpsBase();
  const cfg = getServiceConfig();
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: [base, "data-plane-status"],
    queryFn: () => getDataPlaneStatus(),
    staleTime: 5 * 60 * 1000,
  });
  const layers = useQuery(layersQuery(base));

  // Manual trigger for the scheduled Aurora forecast job (see aurora.js) — runs the same
  // detect → forecast → publish cycle the cron does, on demand, from this page.
  const auroraRunStatus = useQuery({
    queryKey: [base, "aurora-run-status"],
    queryFn: async () => {
      const res = await fetch("/api/aurora/status", { headers: { Accept: "application/json" } });
      return (await res.json()) as {
        ok: boolean;
        configured?: boolean;
        latest?: { name: string; status?: string; startTime?: string; endTime?: string } | null;
        message?: string;
      };
    },
    staleTime: 15 * 1000,
    // Poll fast while a run is in flight so "Last run" reflects reality instead of
    // going stale the moment the trigger POST resolves; back off once it's terminal.
    refetchInterval: (query) => (ACTIVE_RUN_STATUSES.has(query.state.data?.latest?.status ?? "") ? 4 * 1000 : false),
  });
  const runAurora = useMutation({
    mutationFn: async (payload?: Record<string, unknown>) => {
      const res = await fetch("/api/aurora/run", {
        method: "POST",
        headers: payload ? { "Content-Type": "application/json" } : undefined,
        body: payload ? JSON.stringify(payload) : undefined,
      });
      return (await res.json()) as { ok: boolean; message: string };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [base, "aurora-run-status"] }),
  });

  // Historical-storm replay form state. `sourceMode` picks the initial-condition
  // archive; `selected` is a preset id, "custom", or "".
  const [sourceMode, setSourceMode] = useState<IcSource>("hres_t0");
  const [selected, setSelected] = useState<string>("");
  const [customDate, setCustomDate] = useState<string>("");
  const [customHour, setCustomHour] = useState<string>("12");
  const [customBbox, setCustomBbox] = useState<string>(REGION_PRESETS[0].bbox);
  const [customName, setCustomName] = useState<string>("");

  const sourceOption = SOURCE_OPTIONS.find((s) => s.id === sourceMode)!;
  const storms = STORM_PRESETS.filter((p) => p.source === sourceMode);

  // Switching source clears any storm/date chosen for the other archive.
  const pickSource = (id: IcSource) => {
    setSourceMode(id);
    setSelected("");
    setCustomDate("");
  };

  const replayPayload = (): Record<string, unknown> | null => {
    if (selected === "custom") {
      if (!customDate) return null;
      return {
        analysisTime: `${customDate}T${customHour}:00`,
        source: sourceMode,
        bbox: customBbox,
        stormName: customName.trim() || undefined,
        numSteps: 12,
      };
    }
    const preset = storms.find((p) => p.id === selected);
    if (!preset) return null;
    return {
      analysisTime: preset.analysisTime,
      source: preset.source,
      bbox: preset.bbox,
      stormName: preset.label,
      numSteps: preset.numSteps,
    };
  };

  const geoCatalogWired = Boolean(cfg.geoCatalogUrl);
  const foundryWired = Boolean(cfg.foundryEndpoint);
  const reportApiEnabled = cfg.reportApiEnabled;
  // The report-app backend is only *actually* connected when its /api/status probe
  // returns ok:true (the Fabric capacity answered). REPORT_API_ENABLED alone just
  // routes the personas to the live /api — it does not prove reachability, so we
  // verify rather than trust the flag.
  const reportStatus = useQuery({
    queryKey: [base, "report-api-status"],
    enabled: reportApiEnabled,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<ReportApiStatus> => {
      const res = await fetch("/api/status", { headers: { Accept: "application/json" } });
      return (await res.json()) as ReportApiStatus;
    },
  });
  const reportApiLive = reportApiEnabled && reportStatus.data?.ok === true;
  const reportApiLabel = !reportApiEnabled
    ? "Not configured"
    : reportStatus.isLoading
      ? "Checking…"
      : reportStatus.data?.ok
        ? "Connected"
        : reportStatus.data?.configured === false
          ? "No Fabric target"
          : reportStatus.data?.capacityPaused
            ? "Capacity paused"
            : "Unreachable";
  const uploadWired = status.data?.uploadConfigured ?? false;
  const auroraEndpointWired = status.data?.auroraEndpointConfigured ?? false;
  const auroraModelDeployed = status.data?.auroraModelDeployed ?? false;
  const auroraAdapterConnected = status.data?.auroraAdapterConnected ?? false;
  const entraWired = isEntraConfigured();

  // Turn the server-side live reachability probes into per-tile status. Unlike the
  // env-presence flags, these flip to "Unreachable" when a resource is paused, deleted,
  // or the app identity lost its role — the honest liveness the presence flags cannot give.
  const liveTile = (
    configured: boolean,
    live: ProbeResult | undefined,
  ): { wired: boolean; statusLabel: string } => {
    if (!configured) return { wired: false, statusLabel: "Not configured" };
    if (live === undefined)
      return { wired: false, statusLabel: status.isLoading ? "Checking…" : "Configured" };
    switch (live) {
      case "ok":
        return { wired: true, statusLabel: "Connected" };
      case "unauthorized":
        return { wired: false, statusLabel: "Access denied" };
      default:
        return { wired: false, statusLabel: "Unreachable" };
    }
  };
  const entraTile = liveTile(entraWired, status.data?.entraLive);
  const geoCatalogTile = liveTile(geoCatalogWired, status.data?.geoCatalogLive);
  const foundryTile = liveTile(foundryWired, status.data?.foundryLive);
  const storageTile = liveTile(uploadWired, status.data?.storageLive);

  const services: {
    name: string;
    detail: string;
    wired: boolean;
    endpoint?: string;
    statusLabel?: string;
  }[] = [
    {
      name: "Identity & sign-in (Microsoft Entra ID)",
      detail: !entraWired
        ? "Set ENTRA_CLIENT_ID and ENTRA_TENANT_ID to require directory sign-in — the console runs open until then"
        : entraTile.wired
          ? "Directory sign-in with your tenant's MFA and conditional access"
          : "Configured, but the tenant's identity metadata was unreachable — verify ENTRA_TENANT_ID is correct and the tenant still exists",
      wired: entraTile.wired,
      statusLabel: entraTile.statusLabel,
    },
    {
      name: "Geospatial catalog (Planetary Computer Pro)",
      detail: geoCatalogTile.wired || !geoCatalogWired
        ? "STAC collections and imagery for the operating region"
        : "Configured, but the app identity could not reach the GeoCatalog — check the resource exists and its data-plane role is still assigned",
      wired: geoCatalogTile.wired,
      endpoint: cfg.geoCatalogUrl ? hostOf(cfg.geoCatalogUrl) : undefined,
      statusLabel: geoCatalogTile.statusLabel,
    },
    {
      name: "AI operations assistant (Azure OpenAI)",
      detail: !foundryWired
        ? "Grounded natural-language answers"
        : foundryTile.wired
          ? cfg.foundryDeployment
            ? `Deployment: ${cfg.foundryDeployment}`
            : "Grounded natural-language answers"
          : "Configured, but the endpoint did not answer — check the Azure OpenAI resource exists and the app has the Cognitive Services OpenAI User role",
      wired: foundryTile.wired,
      endpoint: cfg.foundryEndpoint ? hostOf(cfg.foundryEndpoint) : undefined,
      statusLabel: foundryTile.statusLabel,
    },
    {
      name: "Operational data plane (Fabric Real-Time Intelligence)",
      detail: !reportApiEnabled
        ? "Serving the deterministic sample estate — deploy the OneGrid report backend to wire live Fabric Eventhouse / Power BI data"
        : reportApiLive
          ? "Live fleet health, work orders, anomalies and telemetry via the OneGrid /api"
          : reportStatus.data?.message ||
            "The report API is enabled but the Fabric backend did not answer — check the identity has access to the capacity and semantic model",
      wired: reportApiLive,
      statusLabel: reportApiLabel,
    },
    {
      name: "Data storage & upload",
      detail: storageTile.wired || !uploadWired
        ? "Blob container for uploaded assets and catalog ingestion sources"
        : "Configured, but the container did not answer — check the storage account/container exists and the app has Storage Blob Data Reader",
      wired: storageTile.wired,
      statusLabel: storageTile.statusLabel,
    },
    {
      name: "Aurora weather inference",
      detail: !auroraEndpointWired
        ? "Select Aurora and provide its model asset ID in the Azure deployment form"
        : !auroraModelDeployed
          ? "Azure ML endpoint provisioned; GPU model deployment still required"
          : "Aurora model deployed; WeatherEvent response adapter still required",
      wired: auroraModelDeployed && auroraAdapterConnected,
      statusLabel: !auroraEndpointWired
        ? "Not configured"
        : auroraModelDeployed
          ? "Adapter required"
          : "Model required",
    },
  ];

  return (
    <AppShell>
      <PageHeader
        title="Deployment"
        description="Infrastructure is provisioned by the deployment template using your Azure credentials. This page reports what is wired to this deployment — it does not provision resources."
      />
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <div className="panel">
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <span className="label-xs">Connected Azure services</span>
              {status.isLoading && (
                <span className="text-[11px] text-muted-foreground">Checking…</span>
              )}
            </div>
            <ul className="divide-y">
              {services.map((s) => (
                <li key={s.name} className="flex items-start justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium">{s.name}</div>
                    <div className="text-[11px] text-muted-foreground">{s.detail}</div>
                    {s.endpoint && (
                      <div className="num mt-0.5 truncate text-[10px] text-muted-foreground/80">
                        {s.endpoint}
                      </div>
                    )}
                  </div>
                  <span
                    className={`mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[10px] font-medium ${
                      s.wired
                        ? "border-risk-normal/50 bg-risk-normal/10 text-risk-normal"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    <span
                      className={`size-1.5 rounded-full ${s.wired ? "bg-risk-normal" : "bg-muted-foreground/50"}`}
                    />
                    {s.statusLabel ?? (s.wired ? "Connected" : "Not configured")}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="panel p-4">
            <div className="label-xs mb-2 flex items-center gap-1.5">
              <Database className="size-3.5 text-primary" /> Catalog contents
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              This deployment currently exposes{" "}
              <span className="num font-medium text-foreground">{layers.data?.length ?? 0}</span>{" "}
              geospatial {layers.data?.length === 1 ? "collection" : "collections"}. Assets are
              ingested from your GIS or uploaded — nothing is pre-populated.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <OpsLink
                to="/assets"
                className="inline-flex items-center gap-1.5 rounded-sm border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/15"
              >
                <Database className="size-3.5" /> Add data
              </OpsLink>
              <OpsLink
                to="/"
                className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px] hover:bg-accent"
              >
                <Sparkles className="size-3.5" /> Load a public sample
              </OpsLink>
            </div>
          </div>

          <div className="panel p-4">
            <div className="label-xs mb-2 flex items-center gap-1.5">
              <Boxes className="size-3.5 text-primary" /> Service adapters
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Assets, weather, events, risk, geospatial, alerts and the assistant are served through
              stable interfaces backed by the tenant's Azure resources. Each returns an honest empty
              result until the corresponding data is ingested — the app never falls back to
              synthetic sample data.
            </p>
          </div>

          <div className="panel p-4">
            <div className="label-xs mb-2 flex items-center gap-1.5">
              <CloudSun className="size-3.5 text-primary" /> Aurora configuration
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Configure Aurora in the Azure deployment form, not in this browser. Select the Aurora
              component, choose the GPU instance type, and provide the model asset ID. Bicep derives
              the scoring URI and stores it as a server-only app setting. No endpoint token or key
              is sent to the browser.
            </p>
            <div className="mt-2 rounded-sm border bg-card px-3 py-2 text-[10px] text-muted-foreground">
              Model asset example:{" "}
              <code className="text-foreground">
                azureml://registries/azureml/models/Aurora/versions/4
              </code>
            </div>
          </div>

          <div className="panel p-4">
            <div className="label-xs mb-2 flex items-center gap-1.5">
              <PlayCircle className="size-3.5 text-primary" /> Aurora forecast job
              <Popover>
                <PopoverTrigger
                  className="ml-auto text-muted-foreground hover:text-foreground"
                  aria-label="How does the Aurora forecast job work?"
                >
                  <HelpCircle className="size-3.5" />
                </PopoverTrigger>
                <PopoverContent className="w-96 text-[11px] leading-relaxed">
                  <div className="space-y-2">
                    <p>
                      <strong className="text-foreground">Where the data comes from:</strong> the
                      job reads a public NOAA GFS feed directly (updated every 6 hours, no
                      credentials needed) — nothing lands in your storage account first. It
                      builds a snapshot of pressure, wind and temperature at 13 altitudes over a
                      fixed region (the Gulf of Mexico + Caribbean).
                    </p>
                    <p>
                      <strong className="text-foreground">What your storage account is for:</strong>{" "}
                      Aurora's predictions are too large for a normal API response, so the job
                      uses a scratch blob container as a relay — it uploads the snapshot, the
                      Aurora GPU endpoint reads it and writes back its forecast, and the job reads
                      that back. It's temporary plumbing, not a saved dataset. The only thing that
                      persists afterward is the small final result,{" "}
                      <code className="text-foreground">model-outputs/weather-events.json</code>{" "}
                      (storm track + intensity), which is what this app displays.
                    </p>
                    <p>
                      <strong className="text-foreground">Cron vs. this button:</strong> both do
                      the exact same thing — fetch the current atmosphere, scan for storms, run
                      Aurora, publish results. The schedule just runs it automatically 4×/day; this
                      button runs the identical cycle on demand.
                    </p>
                    <p>
                      <strong className="text-foreground">Changing which storm it finds:</strong>{" "}
                      Aurora only forecasts a real cyclone it detects in the data — it can't
                      invent one. The two levers are the point in time analyzed and the
                      geographic search box. The <strong className="text-foreground">Replay a
                      historical storm</strong> panel below exposes exactly those: choose a data
                      source (ECMWF HRES for 2016–2022, NOAA GFS for 2021–now), pick a past
                      hurricane (or a custom date + region), and Aurora re-forecasts the real
                      system from that snapshot.
                    </p>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              A scheduled job runs the full forecast cycle four times a day (roughly every 6
              hours, matching the ECMWF/GFS cadence): it pulls the latest real atmospheric
              conditions, <strong className="text-foreground">detects</strong> any tropical
              cyclones already present, runs Aurora, and publishes the results. Aurora never
              simulates a hypothetical storm — it only forecasts a cyclone it actually detects.
              You can point it at <strong className="text-foreground">now</strong> (the button
              below) or <strong className="text-foreground">replay a past hurricane</strong> from
              the public archive (the panel below that) — in both cases Aurora finds and tracks
              the real system in that snapshot.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button
                disabled={!auroraRunStatus.data?.configured || runAurora.isPending}
                onClick={() => runAurora.mutate(undefined)}
                className="inline-flex items-center gap-1.5 rounded-sm border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {runAurora.isPending ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <PlayCircle className="size-3" />
                )}
                Run Aurora forecast now
              </button>
              {auroraRunStatus.data?.latest && (() => {
                const latest = auroraRunStatus.data.latest;
                const active = ACTIVE_RUN_STATUSES.has(latest.status ?? "");
                return (
                  <span
                    className={`inline-flex items-center gap-1.5 text-[11px] ${active ? "text-primary" : "text-muted-foreground"}`}
                  >
                    {active && <Loader2 className="size-3 animate-spin" />}
                    {active ? "Running" : `Last run: ${latest.status ?? "Unknown"}`}
                    {latest.startTime ? ` · ${new Date(latest.startTime).toLocaleString()}` : ""}
                  </span>
                );
              })()}
            </div>
            {runAurora.data && (
              <p className={`mt-2 text-[11px] ${runAurora.data.ok ? "text-risk-normal" : "text-risk-high"}`}>
                {runAurora.data.message}
              </p>
            )}
            {runAurora.isError && (
              <p className="mt-2 text-[11px] text-risk-high">
                Request failed — could not reach the server to start the job. Try again.
              </p>
            )}
            {!auroraRunStatus.data?.configured && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Not available: this deployment doesn't have the scheduled Aurora job enabled
                (select "Aurora scheduled forecast job" in the Azure deployment form to enable
                it).
              </p>
            )}

            {auroraRunStatus.data?.configured && (
              <div className="mt-4 border-t pt-3">
                <div className="label-xs mb-1 flex items-center gap-1.5">
                  <History className="size-3.5 text-primary" /> Replay a historical storm
                </div>
                <p className="mb-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  Re-run Aurora against a past hurricane and it re-forecasts the real system onto
                  your asset map — the same detect → forecast → publish cycle, aimed at a past date.
                  Pick a data source, then a storm.
                </p>

                <div className="mb-2.5">
                  <div className="label-xs mb-1 text-muted-foreground">1 · Data source</div>
                  <div className="inline-flex rounded-sm border p-0.5">
                    {SOURCE_OPTIONS.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => pickSource(s.id)}
                        title={s.blurb}
                        className={`rounded-[3px] px-2.5 py-1 text-[11px] font-medium transition-colors ${
                          sourceMode === s.id
                            ? "bg-primary/15 text-primary"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <span className="ml-2 text-[10px] text-muted-foreground">{sourceOption.blurb}</span>
                </div>

                <div className="label-xs mb-1 text-muted-foreground">2 · Storm</div>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {storms.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelected(p.id)}
                      className={`flex flex-col items-start rounded-sm border px-2 py-1.5 text-left transition-colors ${
                        selected === p.id
                          ? "border-primary/60 bg-primary/10"
                          : "border-border hover:bg-accent"
                      }`}
                    >
                      <span className="text-[11px] font-medium text-foreground">{p.label}</span>
                      <span className="text-[10px] text-muted-foreground">{p.sub}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setSelected("custom")}
                    className={`flex flex-col items-start rounded-sm border px-2 py-1.5 text-left transition-colors ${
                      selected === "custom"
                        ? "border-primary/60 bg-primary/10"
                        : "border-border hover:bg-accent"
                    }`}
                  >
                    <span className="text-[11px] font-medium text-foreground">Custom date…</span>
                    <span className="text-[10px] text-muted-foreground">Any {sourceOption.min.slice(0, 4)}–{sourceOption.max.slice(0, 4)} storm</span>
                  </button>
                </div>

                {selected === "custom" && (
                  <div className="mt-2.5 grid gap-2 rounded-sm border bg-card p-2.5 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
                      Analysis date (UTC)
                      <input
                        type="date"
                        min={sourceOption.min}
                        max={sourceOption.max}
                        value={customDate}
                        onChange={(e) => setCustomDate(e.target.value)}
                        className="rounded-sm border bg-background px-2 py-1 text-[11px] text-foreground"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
                      Cycle hour (UTC)
                      <select
                        value={customHour}
                        onChange={(e) => setCustomHour(e.target.value)}
                        className="rounded-sm border bg-background px-2 py-1 text-[11px] text-foreground"
                      >
                        {CYCLE_HOURS.map((h) => (
                          <option key={h} value={h}>{h}:00</option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
                      Search region
                      <select
                        value={customBbox}
                        onChange={(e) => setCustomBbox(e.target.value)}
                        className="rounded-sm border bg-background px-2 py-1 text-[11px] text-foreground"
                      >
                        {REGION_PRESETS.map((r) => (
                          <option key={r.bbox} value={r.bbox}>{r.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
                      Storm label (optional)
                      <input
                        type="text"
                        value={customName}
                        placeholder="e.g. Hurricane Delta"
                        onChange={(e) => setCustomName(e.target.value)}
                        className="rounded-sm border bg-background px-2 py-1 text-[11px] text-foreground"
                      />
                    </label>
                  </div>
                )}

                <div className="mt-3 flex items-center gap-2">
                  <button
                    disabled={
                      runAurora.isPending ||
                      replayPayload() === null
                    }
                    onClick={() => {
                      const payload = replayPayload();
                      if (payload) runAurora.mutate(payload);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-sm border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {runAurora.isPending ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <History className="size-3" />
                    )}
                    Replay selected storm
                  </button>
                  <span className="text-[10px] text-muted-foreground">
                    Runs on the GPU endpoint — allow a few minutes.
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="panel p-4">
            <div className="label-xs mb-2 flex items-center gap-1.5">
              <Shield className="size-3.5 text-primary" /> Security posture
            </div>
            <ul className="space-y-1.5 text-[11px] text-muted-foreground">
              {SECURITY.map((t) => (
                <li key={t} className="flex gap-2">
                  <Check className="mt-0.5 size-3 shrink-0 text-primary" />
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <div className="panel">
            <div className="border-b px-4 py-2.5 label-xs">Roles</div>
            <ul className="divide-y">
              {ROLES.map(([r, d]) => (
                <li key={r} className="px-4 py-2.5">
                  <div className="text-xs font-medium">{r}</div>
                  <div className="text-[11px] text-muted-foreground">{d}</div>
                </li>
              ))}
            </ul>
          </div>

          <div className="panel p-4">
            <div className="label-xs mb-2">Provisioning</div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Resources are created by the deployment template (Bicep/ARM) under your subscription,
              with the app's managed identity granted the data-plane roles above. To change what is
              deployed, redeploy the template — application code ships unchanged.
            </p>
            <a
              href="https://learn.microsoft.com/azure/planetary-computer/"
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-primary hover:underline"
            >
              Planetary Computer Pro documentation <ExternalLink className="size-3" />
            </a>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
