import { createFileRoute } from "@tanstack/react-router";

import { SapPage } from "@/views/sap";

export const Route = createFileRoute("/_authenticated/app/sap")({
  validateSearch: (search: Record<string, unknown>): { tab?: string } => {
    const out: { tab?: string } = {};
    if (typeof search["tab"] === "string") out.tab = search["tab"];
    return out;
  },
  head: () => ({
    meta: [
      { title: "SAP S/4HANA | OneGrid" },
      {
        name: "description",
        content:
          "SAP plants, equipment, warranties and outage finance replicated into OneLake with Fabric Mirroring.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SapPage,
});
