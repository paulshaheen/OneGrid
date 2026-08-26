import { PersonaMount } from "./_persona";

// Admin · Governance & Security — faithful report-app persona: OneLake access posture,
// who-has-access / who-can-see-this explorers, access-change diff and policy tests.
export function GovernancePage() {
  return (
    <PersonaMount name="Governance" loader={() => import("@/report/personas/Governance.jsx")} />
  );
}
