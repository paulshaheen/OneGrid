import { PersonaMount } from "./_persona";

// Digital Twin · Control Room — the faithful report-app persona: holographic US fleet
// globe, drill-in to textured 3D equipment trains, live streaming tag values, Map/List
// toggle, live alert rail and the full asset-intelligence modal.
export function ControlRoomPage() {
  return (
    <PersonaMount name="Control Room" loader={() => import("@/report/personas/ControlRoom.jsx")} />
  );
}
