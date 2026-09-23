import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";

import { AppShell } from "@/components/ops/AppShell";
import { useMode } from "@/lib/theme-mode";

// Client-only mount for a ported report-app persona. The personas statically import the
// three.js engine + framer-motion, so we defer their import to the browser (SSR-safe) and
// render them full-height inside the OneGrid shell with the dark OneGrid theme.
export function PersonaMount({
  loader,
  name,
  extraProps,
}: {
  loader: () => Promise<{ default: ComponentType<Record<string, unknown>> }>;
  name: string;
  extraProps?: Record<string, unknown>;
}) {
  const [C, setC] = useState<ComponentType<Record<string, unknown>> | null>(null);
  const mode = useMode();
  const load = useRef(loader);
  useEffect(() => {
    let ok = true;
    load
      .current()
      .then((m) => ok && setC(() => m.default))
      .catch(() => ok && setC(null));
    return () => {
      ok = false;
    };
  }, []);
  return (
    <AppShell fullHeight>
      <div className={`h-full min-h-[calc(100vh-3.5rem)] ${mode.app}`} style={mode.appStyle}>
        {C ? (
          <C theme={mode} {...(extraProps || {})} />
        ) : (
          <div className="grid h-full min-h-[60vh] place-items-center text-sm text-muted-foreground">
            Loading {name}…
          </div>
        )}
      </div>
    </AppShell>
  );
}
