import { ArrowUpRight, Receipt } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/ops/AppShell";
import { Spinner } from "@/components/ops/Spinner";

/** The Customer Rate Analysis app is a separate container app, embedded here full-bleed. */
export const RATES_URL = "https://onegrid-rates.niceisland-20053c21.eastus2.azurecontainerapps.io/";

export function RateAnalysisPage() {
  const [loaded, setLoaded] = useState(false);
  return (
    <AppShell fullHeight>
      <div className="flex h-full flex-col">
        <div className="og-header-skin flex items-center gap-2.5 border-b bg-surface px-5 py-3">
          <div className="grid size-8 place-items-center rounded-lg bg-primary/15 text-primary">
            <Receipt className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-[15px] font-semibold tracking-tight">Customer Rate Analysis</h1>
            <p className="text-[11px] text-muted-foreground">
              Commercial rate comparison: which accounts would save on a different tariff, and by
              how much.
            </p>
          </div>
          <a
            href={RATES_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
          >
            Open in new tab <ArrowUpRight className="size-3.5" />
          </a>
        </div>
        <div className="relative min-h-0 flex-1">
          {!loaded && (
            <div className="absolute inset-0 grid place-items-center">
              <Spinner label="Loading Customer Rate Analysis…" />
            </div>
          )}
          <iframe
            src={RATES_URL}
            title="Customer Rate Analysis"
            onLoad={() => setLoaded(true)}
            allow="clipboard-read; clipboard-write; fullscreen"
            className="size-full border-0"
          />
        </div>
      </div>
    </AppShell>
  );
}
