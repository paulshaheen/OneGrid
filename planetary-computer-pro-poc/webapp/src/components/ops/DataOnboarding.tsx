import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { CheckCircle2, Database, Loader2, Sparkles, Upload } from "lucide-react";

import { useOpsBase } from "@/components/ops/ops-nav";
import { layersQuery } from "@/lib/hooks/use-ops-data";
import { getDataPlaneStatus, seedPublicSample, uploadAsset } from "@/lib/services/azure/server";
import { cn } from "@/lib/utils";

// Shown when a tenant deployment has no assets yet. Lets an operator make the
// deployment self-contained: upload data to the wired storage account and/or
// pre-seed the GeoCatalog with a public sample — all through managed identity.

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the "data:...;base64," prefix.
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

export function DataOnboarding({ className }: { className?: string }) {
  const base = useOpsBase();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const status = useQuery({
    queryKey: [base, "data-plane-status"],
    queryFn: () => getDataPlaneStatus(),
    staleTime: 5 * 60 * 1000,
  });
  const layers = useQuery(layersQuery(base));
  const layerCount = layers.data?.length ?? 0;

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const contentBase64 = await readAsBase64(file);
      return uploadAsset({ data: { name: file.name, contentBase64, contentType: file.type } });
    },
    onSuccess: (res) => setNote({ ok: res.ok, text: res.message }),
    onError: () => setNote({ ok: false, text: "Upload failed unexpectedly." }),
  });

  const seed = useMutation({
    mutationFn: () => seedPublicSample(),
    onSuccess: (res) => {
      setNote({ ok: res.ok, text: res.message });
      if (res.ok) void queryClient.invalidateQueries({ queryKey: [base, "layers"] });
    },
    onError: () => setNote({ ok: false, text: "Pre-seeding failed unexpectedly." }),
  });

  const uploadReady = status.data?.uploadConfigured ?? false;
  const catalogReady = status.data?.geoCatalogConfigured ?? false;
  const busy = upload.isPending || seed.isPending;

  return (
    <div className={cn("flex h-full items-center justify-center overflow-y-auto p-6", className)}>
      <div className="w-full max-w-xl rounded-md border bg-surface p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <Database className="size-5 text-primary" />
          <h2 className="text-base font-semibold tracking-tight">Add data to get started</h2>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          This deployment is connected but has no data yet. Upload your own geospatial files to the
          provisioned storage account, or pre-seed the catalog with a public sample. Everything runs
          through the app&apos;s managed identity — no keys or portal steps required.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {/* Upload own data */}
          <div className="flex flex-col rounded-sm border p-4">
            <div className="flex items-center gap-2">
              <Upload className="size-4 text-foreground" />
              <span className="text-sm font-medium">Upload data</span>
            </div>
            <p className="mt-1 flex-1 text-[11px] leading-relaxed text-muted-foreground">
              Send a file to the deployment&apos;s{" "}
              <code className="text-[10px]">sample-assets</code> container. Use it as a source for
              catalog ingestion.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={!uploadReady || busy}
              onClick={() => fileInputRef.current?.click()}
              className="mt-3 inline-flex items-center justify-center gap-2 rounded-sm border border-primary/40 bg-primary/10 px-3 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {upload.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              Choose file
            </button>
            {!uploadReady && status.isSuccess && (
              <span className="mt-2 text-[10px] text-muted-foreground">
                Storage not wired for this deployment.
              </span>
            )}
          </div>

          {/* Pre-seed public sample */}
          <div className="flex flex-col rounded-sm border p-4">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-foreground" />
              <span className="text-sm font-medium">Load public sample</span>
            </div>
            <p className="mt-1 flex-1 text-[11px] leading-relaxed text-muted-foreground">
              Ingest a few public Sentinel-2 scenes over the Gulf of Mexico into a sample collection
              so the map isn&apos;t empty.
            </p>
            <button
              type="button"
              disabled={!catalogReady || busy}
              onClick={() => seed.mutate()}
              className="mt-3 inline-flex items-center justify-center gap-2 rounded-sm border border-primary/40 bg-primary/10 px-3 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {seed.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              Load sample
            </button>
            {!catalogReady && status.isSuccess && (
              <span className="mt-2 text-[10px] text-muted-foreground">
                GeoCatalog not wired for this deployment.
              </span>
            )}
          </div>
        </div>

        {note && (
          <div
            className={cn(
              "mt-4 flex items-start gap-2 rounded-sm border px-3 py-2 text-[11px]",
              note.ok
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
                : "border-risk-high/40 bg-risk-high/10 text-risk-high",
            )}
          >
            {note.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /> : null}
            <span>{note.text}</span>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between border-t pt-3 text-[10px] text-muted-foreground">
          <span>
            Catalog collections: <span className="num text-foreground">{layerCount}</span>
          </span>
          <span>Assets are ingested from your GIS or uploaded above.</span>
        </div>
      </div>
    </div>
  );
}
