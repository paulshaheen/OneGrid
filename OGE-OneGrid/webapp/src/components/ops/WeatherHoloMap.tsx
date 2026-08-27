import { Suspense, lazy, useEffect, useState } from "react";

import type { OpsMapProps } from "./GeoMap";
import type { WeatherEvent } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

/** The 3D map can render several concurrent storms; the 2D map stays single-event. */
export type WeatherHoloMapProps = OpsMapProps & {
  events?: WeatherEvent[];
  /** Auto-advance an internal forecast playhead (for embeds with no timeline). */
  autoPlay?: boolean;
  /** Open drilled-in and framed on this event, skipping the Level-0 globe. */
  initialFocusEventId?: string;
};

// The scene statically imports three.js + R3F + postprocessing, so defer its
// import to the browser (WebGL needs a DOM) exactly like OpsMap does for MapLibre.
const WeatherHoloScene = lazy(
  () => import("./WeatherHoloScene.jsx"),
) as unknown as React.LazyExoticComponent<React.ComponentType<WeatherHoloMapProps>>;

/**
 * Holographic 3D weather map. Drop-in alternative to {@link OpsMap}: it receives
 * the same props (assets, risks, event, hour, selectedId, onSelect) plus an
 * optional `events` array, and renders a React Three Fiber "storm room" — a
 * textured US terrain, one or more storms (forecast track, growing cone,
 * asymmetric wind field, and a procedural cloud vortex for tropical systems),
 * and risk-coloured asset markers. Browser-only.
 */
export function WeatherHoloMap(props: WeatherHoloMapProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const fallback = (
    <div className={cn("bg-ocean-deep flex items-center justify-center", props.className)}>
      <span className="label-xs text-muted-foreground">Rendering storm room…</span>
    </div>
  );

  if (!mounted) return fallback;

  return (
    <div className={cn("relative", props.className)}>
      <Suspense fallback={fallback}>
        <WeatherHoloScene {...props} />
      </Suspense>
    </div>
  );
}
