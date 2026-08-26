import { PersonaMount } from "./_persona";

// Ontology — faithful report-app persona: force-directed knowledge graph of the OneGrid
// data model (entities, tables, tags, relationships) with search and detail inspector.
export function OntologyPage() {
  return <PersonaMount name="Ontology" loader={() => import("@/report/personas/Ontology.jsx")} />;
}
