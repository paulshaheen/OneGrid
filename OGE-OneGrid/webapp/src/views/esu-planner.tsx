import { Calculator } from "lucide-react";

import { AppShell } from "@/components/ops/AppShell";
import { EsuCompass } from "@/features/esu/EsuCompass";

/**
 * Standalone, full-bleed home for the ESU Compass planner. It lives under the
 * sidebar "Resources" group (its own top-level solution) rather than inside the
 * Infrastructure tab shell — its own product header + the planner's section
 * sub-nav, no Infrastructure chrome.
 */
export function EsuPlannerPage() {
  return (
    <AppShell fullHeight>
      <div className="flex h-full flex-col">
        <div className="og-header-skin flex items-center gap-2.5 border-b bg-surface px-5 py-3">
          <div className="grid size-8 place-items-center rounded-lg bg-primary/15 text-primary">
            <Calculator className="size-5" />
          </div>
          <div>
            <h1 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
              ESU Compass
              <span className="rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                Planner
              </span>
            </h1>
            <p className="text-[11px] text-muted-foreground">
              Extended Security Updates cost &amp; modernization planning for Windows Server &amp;
              SQL Server.
            </p>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <EsuCompass />
        </div>
      </div>
    </AppShell>
  );
}
