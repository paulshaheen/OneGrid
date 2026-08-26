import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/ontology")({
  beforeLoad: () => {
    throw redirect({ to: "/app/ontology" });
  },
});
