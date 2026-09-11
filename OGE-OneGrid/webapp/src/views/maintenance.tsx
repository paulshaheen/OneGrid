import { useSearch } from "@tanstack/react-router";

import { PersonaMount } from "./_persona";

// Digital Twin · Maintenance — faithful report-app persona: work-order KPIs, equipment
// list filtered by condition, open work-orders table, opening the asset-intelligence modal.
// A `?wo=<id>` deep-link (e.g. from the Command Center) pre-filters the work-order table.
export function MaintenancePage() {
  const { wo } = useSearch({ strict: false }) as { wo?: string };
  return (
    <PersonaMount
      name="Maintenance"
      loader={() => import("@/report/personas/Maintenance.jsx")}
      extraProps={{ focusWo: wo }}
    />
  );
}
