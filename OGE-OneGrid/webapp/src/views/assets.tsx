import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
  Globe,
  HelpCircle,
  Layers,
  Loader2,
  Plug,
  Server,
  Upload,
} from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { AppShell, PageHeader } from "@/components/ops/AppShell";
import { useOpsBase } from "@/components/ops/ops-nav";
import { assetsQuery } from "@/lib/hooks/use-ops-data";
import { getDataPlaneStatus, uploadAsset } from "@/lib/services/azure/server";
import { ASSET_TYPE_LABEL, STATUS_LABEL, coords } from "@/lib/format";
import { SkeletonRows } from "@/components/ops/Skeleton";

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

// Downloadable examples matching SCHEMA exactly, so a user can see the expected shape
// before uploading (same idea as Azure Migrate's downloadable assessment templates).
// Served as static files from public/samples/ so no server round-trip is needed.
const SAMPLE_FILES: Record<string, { file: string; label: string }[]> = {
  csv: [
    { file: "sample-assets.csv", label: "Download sample CSV" },
    // Fictional oil & gas and utility operators on the Gulf/Southeast coast, placed so
    // every storm preset on the Deployment page crosses named assets.
    { file: "sample-assets-hurricane-coast.csv", label: "Hurricane-coast sample (oil & gas + utility)" },
  ],
  geojson: [{ file: "sample-assets.geojson", label: "Download sample GeoJSON" }],
};

function sampleHref(file: string): string {
  return `${import.meta.env.BASE_URL.replace(/\/$/, "")}/samples/${file}`;
}

// Plain-language "what is this and how do I use it" text behind the (?) on each card.
const CONNECTOR_HELP: Record<string, string> = {
  csv: "A spreadsheet of your assets, one row per asset. Required columns: id, name, type, latitude, longitude. Download the sample below to see the exact format, fill in your own rows, then click Upload file.",
  geojson: "A GeoJSON FeatureCollection for assets that aren't a single point \u2014 pipelines (LineString) and lease blocks (Polygon), plus regular point assets. Each feature's properties use the same fields as the CSV. Download the sample below for a working example of all three geometry types.",
  shapefile: "A zipped ESRI shapefile (.shp/.shx/.dbf/.prj bundled in one .zip) exported from GIS software like ArcGIS or QGIS. Upload the .zip directly \u2014 it's converted to the same asset schema on ingest.",
  arcgis: "Point this at a live ArcGIS Feature Service URL from your corporate GIS so assets stay in sync automatically instead of being uploaded as a one-time file. Set the service URL when you deploy this environment (or ask your admin to configure it).",
  blob: "Wire this deployment to read from a cloud storage container you already manage (e.g. an existing data lake landing zone), so new files dropped there are ingested on a schedule instead of uploaded by hand. Configured at deploy time.",
  fabric: "Connect to a governed asset master in your enterprise analytics platform (e.g. a Fabric/Power BI dataset) so this becomes the system of record instead of a duplicate copy. Configured at deploy time.",
  rest: "Pull assets from an existing system \u2014 a maintenance system, SCADA historian, or asset-management API \u2014 over a REST endpoint you provide. Configured at deploy time.",
};

const CONNECTORS = [
  {
    id: "csv",
    name: "CSV upload",
    detail: "Point-asset registers with latitude and longitude columns",
    icon: FileSpreadsheet,
    status: "Available",
  },
  {
    id: "geojson",
    name: "GeoJSON",
    detail: "Point, line and polygon geometry for corridors and lease blocks",
    icon: Globe,
    status: "Available",
  },
  {
    id: "shapefile",
    name: "Shapefile",
    detail: "Zipped ESRI shapefiles from survey and GIS teams",
    icon: Layers,
    status: "Available",
  },
  {
    id: "arcgis",
    name: "ArcGIS feature service",
    detail: "Live feature layers from the corporate GIS",
    icon: Globe,
    status: "Configure",
  },
  {
    id: "blob",
    name: "Cloud storage container",
    detail: "Scheduled ingest from your governed data landing zone",
    icon: Database,
    status: "Configure",
  },
  {
    id: "fabric",
    name: "Enterprise data platform",
    detail: "Governed asset master from your analytics platform",
    icon: Server,
    status: "Configure",
  },
  {
    id: "rest",
    name: "REST API",
    detail: "Pull from maintenance, SCADA or asset-management systems",
    icon: Plug,
    status: "Configure",
  },
];

const SCHEMA = [
  ["id", "string", "Unique asset identifier", "Required"],
  ["name", "string", "Operator-facing asset name", "Required"],
  ["type", "enum", "platform, pipeline, well, refinery, lng_terminal, storage, port, power_plant, substation", "Required"],
  ["latitude", "number", "Decimal degrees", "Required for point assets"],
  ["longitude", "number", "Decimal degrees", "Required for point assets"],
  ["geometry", "geojson", "Line or polygon geometry for corridors and areas", "Optional"],
  ["operator", "string", "Operating company", "Optional"],
  ["region", "string", "Operating region", "Optional"],
  ["business_unit", "string", "Reporting business unit", "Optional"],
  ["operating_status", "enum", "producing, reduced, shut_in, evacuating, standby", "Optional"],
  ["criticality", "enum", "standard, important, business_critical", "Drives risk weighting"],
  ["metadata", "object", "Design wind speed, capacity, personnel on board, etc.", "Optional"],
];

export function AssetsPage() {
  const base = useOpsBase();
  const queryClient = useQueryClient();
  const assetsQ = useQuery(assetsQuery(base));
  const assets = assetsQ.data ?? [];
  const [q, setQ] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const status = useQuery({
    queryKey: [base, "data-plane-status"],
    queryFn: () => getDataPlaneStatus(),
    staleTime: 5 * 60 * 1000,
  });
  const uploadReady = status.data?.uploadConfigured ?? false;

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const contentBase64 = await readAsBase64(file);
      return uploadAsset({ data: { name: file.name, contentBase64, contentType: file.type } });
    },
    onSuccess: (res) => {
      setNote({ ok: res.ok, text: res.message });
      if (res.ok) {
        // The upload only writes a blob — nothing re-parses it into the asset
        // register until this query refetches, so the table would otherwise
        // keep showing stale (often empty) data after a successful upload.
        queryClient.invalidateQueries({ queryKey: [base, "assets"] });
      }
    },
    onError: () => setNote({ ok: false, text: "Upload failed unexpectedly." }),
  });

  const rows = useMemo(
    () =>
      assets
        .filter((a) =>
          `${a.name} ${a.id} ${a.operator} ${a.region}`.toLowerCase().includes(q.toLowerCase()),
        )
        .slice(0, 100),
    [assets, q],
  );

  return (
    <AppShell>
      <PageHeader
        title="Asset Management"
        description="Connect your infrastructure estate. Upload files directly to this deployment's storage, or wire a live source — nothing is pre-populated."
      />
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
      <div className="space-y-4 p-4">
        {note && (
          <div
            className={`flex items-center gap-2 rounded-sm border px-4 py-2.5 text-xs font-medium ${
              note.ok
                ? "border-risk-normal/40 bg-risk-normal/10 text-risk-normal"
                : "border-risk-high/40 bg-risk-high/10 text-risk-high"
            }`}
          >
            {note.ok ? <CheckCircle2 className="size-4 shrink-0" /> : <Upload className="size-4 shrink-0" />}
            {note.text}
            {note.ok && " The asset register below has been refreshed."}
          </div>
        )}
        <div className="panel">
          <div className="border-b px-4 py-2.5">
            <span className="label-xs">Data sources</span>
          </div>
          <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
            {CONNECTORS.map((c) => {
              const isUpload = c.status === "Available";
              const samples = SAMPLE_FILES[c.id] ?? [];
              const help = CONNECTOR_HELP[c.id];
              return (
                <div key={c.id} className="bg-card p-4">
                  <div className="flex items-center gap-2">
                    <c.icon className="size-4 text-primary" />
                    <span className="text-xs font-medium">{c.name}</span>
                    {help && (
                      <Popover>
                        <PopoverTrigger
                          className="ml-auto text-muted-foreground hover:text-foreground"
                          aria-label={`What is ${c.name}?`}
                        >
                          <HelpCircle className="size-3.5" />
                        </PopoverTrigger>
                        <PopoverContent className="w-72 text-xs leading-relaxed">
                          {help}
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">{c.detail}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {isUpload ? (
                      <button
                        disabled={!uploadReady || upload.isPending}
                        onClick={() => fileInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 rounded-sm border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {upload.isPending ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Upload className="size-3" />
                        )}
                        {uploadReady ? "Upload file" : "Storage not wired"}
                      </button>
                    ) : (
                      <span className="inline-block rounded-sm border px-2 py-1 text-[11px] text-muted-foreground">
                        Configure at deploy time
                      </span>
                    )}
                    {samples.map((sample) => (
                      <a
                        key={sample.file}
                        href={sampleHref(sample.file)}
                        download
                        className="inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        <Download className="size-3" />
                        {sample.label}
                      </a>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="panel">
            <div className="flex items-center gap-2 border-b px-4 py-2.5">
              <span className="label-xs">Current asset register</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search"
                className="ml-auto w-56 rounded-sm border bg-card px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="max-h-[520px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card text-left text-[11px] text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">ID</th>
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">Type</th>
                    <th className="px-4 py-2 font-medium">Location</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {assetsQ.isLoading && rows.length === 0 && <SkeletonRows rows={8} cols={5} />}
                  {rows.map((a) => (
                    <tr key={a.id} className="border-t">
                      <td className="num px-4 py-2 text-muted-foreground">{a.id}</td>
                      <td className="px-4 py-2 font-medium">{a.name}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {ASSET_TYPE_LABEL[a.type]}
                      </td>
                      <td className="num px-4 py-2 text-muted-foreground">
                        {coords(a.lat, a.lon)}
                      </td>
                      <td className="px-4 py-2">{STATUS_LABEL[a.status]}</td>
                    </tr>
                  ))}
                  {!assetsQ.isLoading && rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                        {assets.length === 0
                          ? "No assets yet — upload a file or wire a source above to populate the register."
                          : "No assets match your search."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="border-t px-4 py-2 text-[11px] text-muted-foreground">
              Showing {rows.length} of {assets.length} assets in the tenant register.
            </div>
          </div>

          <div className="space-y-4">
            <div className="panel">
              <div className="flex items-center justify-between border-b px-4 py-2.5">
                <span className="label-xs">Asset schema</span>
                <a
                  href={sampleHref(SAMPLE_FILES.csv![0]!.file)}
                  download
                  className="inline-flex items-center gap-1.5 text-[11px] text-primary hover:underline"
                >
                  <Download className="size-3" />
                  Download sample CSV
                </a>
              </div>
              <table className="w-full text-[11px]">
                <tbody>
                  {SCHEMA.map(([field, type, desc, req]) => (
                    <tr key={field} className="border-t align-top">
                      <td className="num px-4 py-2 font-medium">{field}</td>
                      <td className="px-2 py-2 text-muted-foreground">{type}</td>
                      <td className="px-2 py-2 text-muted-foreground">{desc}</td>
                      <td className="px-4 py-2 text-right text-muted-foreground">{req}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="panel p-4">
              <div className="label-xs mb-2">How ingestion works</div>
              <ul className="space-y-1.5 text-[11px] text-muted-foreground">
                {[
                  "Uploaded files land in the deployment's blob container via managed identity — no keys",
                  "Risk scoring, alerts and the assistant read the same interfaces as live sources",
                  "Live connectors (ArcGIS, storage, data platform, REST) are wired at deploy time",
                ].map((t) => (
                  <li key={t} className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-primary" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
