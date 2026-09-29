import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CloudSun, Database, Loader2, PlayCircle, Sparkles } from "lucide-react";

import { useOpsBase } from "@/components/ops/ops-nav";
import {
  getWeatherSource,
  setWeatherSource,
  type WeatherSourceMode,
} from "@/lib/services/azure/server";

const OPTIONS: { mode: WeatherSourceMode; label: string; detail: string; Icon: typeof CloudSun }[] = [
  { mode: "fabric", label: "Demo storms", detail: "Unified-model sample storms", Icon: Database },
  { mode: "synthetic", label: "Synthetic", detail: "Canned Gulf hurricane — instant, no GPU", Icon: Sparkles },
  { mode: "aurora", label: "Aurora (live)", detail: "Live GPU forecast pipeline", Icon: CloudSun },
];

/**
 * Map-side control to choose the weather source. "Synthetic" publishes a canned
 * demo hurricane to the model-outputs blob (no GPU); "Aurora (live)" reads the real
 * pipeline's published forecast and can trigger a fresh cycle. Both are authoritative
 * over the default Fabric unified-model storms (see listAuroraWeatherEvents).
 */
export function WeatherSourceControl({
  activeModelSource,
}: {
  activeModelSource?: string | undefined;
}) {
  const base = useOpsBase();
  const queryClient = useQueryClient();
  const [note, setNote] = useState<string | null>(null);

  const source = useQuery({
    queryKey: [base, "weather-source"],
    queryFn: () => getWeatherSource(),
    staleTime: 60 * 1000,
  });

  const change = useMutation({
    mutationFn: (mode: WeatherSourceMode) => setWeatherSource({ data: { mode } }),
    onSuccess: async (result) => {
      setNote(result.message);
      await queryClient.invalidateQueries({ queryKey: [base, "weather-source"] });
      // Refresh every base-scoped query (events, risks, posture) so the map, cone
      // and exposure all reflect the newly-selected source.
      await queryClient.invalidateQueries({ queryKey: [base] });
    },
  });

  const runAurora = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/aurora/run", { method: "POST" });
      return (await res.json()) as { ok: boolean; message: string };
    },
    onSuccess: (result) => setNote(result.message),
  });

  const current = source.data?.mode ?? "fabric";
  const storageConfigured = source.data?.storageConfigured ?? true;
  const pendingMode = change.isPending ? change.variables : null;

  return (
    <div className="border-b p-3">
      <div className="label-xs mb-1 flex items-center gap-1.5">
        <CloudSun className="size-3.5 text-primary" /> Weather source
      </div>
      <p className="mb-2 text-[10px] leading-tight text-muted-foreground">Click a source to switch the map.</p>
      <div className="grid grid-cols-3 gap-1.5 rounded-lg border border-white/5 bg-black/20 p-1.5 shadow-[inset_0_1px_3px_rgba(0,0,0,0.4)]" role="group" aria-label="Weather source">
        {OPTIONS.map(({ mode, label, Icon }) => {
          const active = current === mode;
          const busy = pendingMode === mode;
          return (
            <button
              key={mode}
              type="button"
              disabled={change.isPending || !storageConfigured}
              onClick={() => {
                setNote(null);
                if (mode !== current) change.mutate(mode);
              }}
              title={OPTIONS.find((o) => o.mode === mode)?.detail}
              className={`relative flex min-h-11 min-w-0 cursor-pointer select-none flex-col items-center justify-center gap-1 rounded-md border px-1.5 py-1.5 text-center text-[11px] font-medium leading-tight shadow-[inset_0_1px_0_rgba(255,255,255,0.22),inset_0_-1px_0_rgba(0,0,0,0.35),0_2px_0_rgba(0,0,0,0.55),0_4px_6px_-2px_rgba(0,0,0,0.45)] transition-[background-color,border-color,box-shadow,transform] duration-150 motion-reduce:transition-none motion-safe:enabled:hover:-translate-y-px motion-safe:enabled:active:translate-y-px enabled:active:shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none ${
                active
                  ? "border-primary/80 bg-primary/25 text-foreground ring-1 ring-primary/40 enabled:hover:border-primary enabled:hover:bg-primary/30"
                  : "border-white/20 bg-white/[0.12] text-foreground enabled:hover:border-white/30 enabled:hover:bg-white/[0.18]"
              }`}
              aria-pressed={active}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
        {OPTIONS.find((o) => o.mode === current)?.detail}
        {activeModelSource ? (
          <>
            {" · showing "}
            <span className="text-foreground">{activeModelSource}</span>
          </>
        ) : null}
      </p>

      {current === "aurora" && (
        <button
          type="button"
          onClick={() => {
            setNote(null);
            runAurora.mutate();
          }}
          disabled={runAurora.isPending}
          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-sm border border-primary/40 bg-primary/10 px-2 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/15 disabled:opacity-70"
        >
          {runAurora.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <PlayCircle className="size-3.5" />
          )}
          Run forecast cycle
        </button>
      )}

      {!storageConfigured && (
        <p className="mt-1.5 text-[10px] text-risk-elevated">
          Storage is not configured for this deployment; the source cannot be changed.
        </p>
      )}
      {note && <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">{note}</p>}
    </div>
  );
}
