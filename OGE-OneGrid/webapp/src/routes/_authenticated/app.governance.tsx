import { createFileRoute } from "@tanstack/react-router";

import { GovernancePage } from "@/views/governance";

export const Route = createFileRoute("/_authenticated/app/governance")({
  head: () => ({
    meta: [
      { title: "Governance & Security | OneGrid" },
      {
        name: "description",
        content: "OneLake security and lineage review — access, sensitivity and provenance.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: GovernancePage,
});
