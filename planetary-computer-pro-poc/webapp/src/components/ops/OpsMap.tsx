import { Suspense, lazy, useEffect, useState } from "react";

import type { LayerState, OpsMapProps } from "./GeoMap";
import { cn } from "@/lib/utils";

export type { LayerState, OpsMapProps };

const GeoMap = lazy(() => import("./GeoMap"));

/**
 * Operational map. Renders a real tiled basemap (coastlines, borders, cities)
 * with storm and asset layers on top. Browser-only: MapLibre needs a DOM.
 */
export function OpsMap(props: OpsMapProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div className={cn("bg-ocean-deep flex items-center justify-center", props.className)}>
        <span className="label-xs text-muted-foreground">Loading basemap…</span>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className={cn("bg-ocean-deep flex items-center justify-center", props.className)}>
          <span className="label-xs text-muted-foreground">Loading basemap…</span>
        </div>
      }
    >
      <GeoMap {...props} />
    </Suspense>
  );
}
