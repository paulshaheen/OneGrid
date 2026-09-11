import { Suspense, lazy, useEffect, useState } from "react";
import type { ComponentType } from "react";

import { MODES } from "@/report/lib/themes.js";
import { cn } from "@/lib/utils";

// The Control-Room 3D equipment train (Facility) statically imports three.js + R3F, so we
// defer its import to the browser (WebGL needs a DOM) and expose it as a default export for
// React.lazy. Drilled into `activePlant`, it renders that plant's textured equipment train.
const Facility = lazy(() =>
  import("@/report/three/Facility.jsx").then((m) => ({
    default: m.Facility as ComponentType<Record<string, unknown>>,
  })),
);

export function InlineFacility({
  model,
  activePlant,
  selectedAssetId,
  onSelect,
  onEnterPlant,
  className,
}: {
  model: unknown;
  activePlant?: string;
  selectedAssetId?: string;
  onSelect?: (node: { asset_id?: string; kind?: string } | null) => void;
  onEnterPlant?: (name: string) => void;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const fallback = (
    <div className={cn("flex items-center justify-center bg-[#0a1120]", className)}>
      <span className="label-xs text-muted-foreground">Building 3D model…</span>
    </div>
  );

  if (!mounted) return fallback;

  return (
    <div className={cn("relative", className)}>
      <Suspense fallback={fallback}>
        <Facility
          model={model}
          theme={MODES.dark}
          activePlant={activePlant}
          selected={selectedAssetId}
          onSelect={onSelect}
          onEnterPlant={onEnterPlant}
          values={{}}
        />
      </Suspense>
    </div>
  );
}
