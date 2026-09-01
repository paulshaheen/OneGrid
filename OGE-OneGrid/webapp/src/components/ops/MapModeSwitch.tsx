import { useState } from "react";
import { Box, Map as MapIcon } from "lucide-react";

import { OpsMap } from "./OpsMap";
import { WeatherHoloMap, type WeatherHoloMapProps } from "./WeatherHoloMap";
import { cn } from "@/lib/utils";

/**
 * A map that defaults to the 3D "storm room" with a small toggle to switch back
 * to the 2D operational basemap. Shared by the Live Map, Weather Events, and
 * Forecast Timeline pages. Extra 3D-only props (events, autoPlay,
 * initialFocusEventId) are ignored by the 2D map.
 */
export function MapModeSwitch({
  defaultMode = "3d",
  className,
  ...props
}: WeatherHoloMapProps & { defaultMode?: "2d" | "3d" }) {
  const [mode, setMode] = useState<"2d" | "3d">(defaultMode);
  return (
    <div className={cn("relative", className)}>
      {mode === "3d" ? (
        <WeatherHoloMap className="h-full w-full" {...props} />
      ) : (
        <OpsMap className="h-full w-full" {...props} />
      )}
      <div className="absolute top-3 left-3 z-10 flex overflow-hidden rounded-md border bg-popover/90 shadow-lg backdrop-blur">
        <button
          onClick={() => setMode("2d")}
          aria-pressed={mode === "2d"}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs ${
            mode === "2d" ? "bg-accent font-semibold" : "hover:bg-accent/60"
          }`}
        >
          <MapIcon className="size-3.5" /> 2D
        </button>
        <button
          onClick={() => setMode("3d")}
          aria-pressed={mode === "3d"}
          className={`inline-flex items-center gap-1.5 border-l px-2.5 py-1.5 text-xs ${
            mode === "3d" ? "bg-accent font-semibold" : "hover:bg-accent/60"
          }`}
        >
          <Box className="size-3.5" /> 3D
        </button>
      </div>
    </div>
  );
}
