import { createFileRoute } from "@tanstack/react-router";

import { RiskPage } from "@/views/risk";

export const Route = createFileRoute("/_authenticated/app/risk")({
  head: () => ({
    meta: [
      { title: "Asset Risk | Weather & Asset Risk" },
      {
        name: "description",
        content:
          "Ranked infrastructure exposure with transparent risk scoring, impact ETA and primary threat by asset.",
      },
      { property: "og:title", content: "Asset Risk | Weather & Asset Risk" },
      {
        property: "og:description",
        content:
          "Ranked infrastructure exposure with transparent risk scoring, impact ETA and primary threat by asset.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RiskPage,
});
