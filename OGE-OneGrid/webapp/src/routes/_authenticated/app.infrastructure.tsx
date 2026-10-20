import { createFileRoute } from "@tanstack/react-router";

import { InfrastructurePage } from "@/views/infrastructure";

export const Route = createFileRoute("/_authenticated/app/infrastructure")({
  validateSearch: (search: Record<string, unknown>): { tab?: string; asset?: string } => {
    const out: { tab?: string; asset?: string } = {};
    if (typeof search["tab"] === "string") out.tab = search["tab"];
    if (typeof search["asset"] === "string") out.asset = search["asset"];
    return out;
  },
  head: () => ({
    meta: [
      { title: "Infrastructure | OneGrid" },
      {
        name: "description",
        content:
          "IT & OT asset management — the servers, databases, network and Azure Local/edge estate that runs OneGrid.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: InfrastructurePage,
});
