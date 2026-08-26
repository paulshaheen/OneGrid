import { PersonaMount } from "./_persona";

// Digital Twin · Maintenance — faithful report-app persona: work-order KPIs, equipment
// list filtered by condition, open work-orders table, opening the asset-intelligence modal.
export function MaintenancePage() {
  return (
    <PersonaMount name="Maintenance" loader={() => import("@/report/personas/Maintenance.jsx")} />
  );
}
