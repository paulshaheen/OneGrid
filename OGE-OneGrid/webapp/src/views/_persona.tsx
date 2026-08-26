import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";

import { AppShell } from "@/components/ops/AppShell";
import { MODES } from "@/report/lib/themes.js";

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
      <div className="h-full min-h-[calc(100vh-3.5rem)] bg-[#0a0f1a] text-[#aeb9cd]">
        {C ? (
          <C theme={MODES.dark} {...(extraProps || {})} />
        ) : (
          <div className="grid h-full min-h-[60vh] place-items-center text-sm text-slate-400">
            Loading {name}…
          </div>
        )}
      </div>
    </AppShell>
  );
}
