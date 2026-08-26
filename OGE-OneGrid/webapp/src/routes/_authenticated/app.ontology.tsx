import { createFileRoute } from "@tanstack/react-router";

import { OntologyPage } from "@/views/ontology";

export const Route = createFileRoute("/_authenticated/app/ontology")({
  head: () => ({
    meta: [
      { title: "Ontology | OneGrid" },
      {
        name: "description",
        content: "Knowledge graph of the Fabric semantic model — entities, keys and relationships.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OntologyPage,
});
