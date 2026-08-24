import { createFileRoute } from "@tanstack/react-router";

import { ThresholdsPage } from "@/views/thresholds";

export const Route = createFileRoute("/_authenticated/app/thresholds")({
  head: () => ({
    meta: [
      { title: "Thresholds | Weather & Asset Risk" },
      {
        name: "description",
        content: "Configurable operational limits per asset class that drive automated alerting.",
      },
      { property: "og:title", content: "Thresholds | Weather & Asset Risk" },
      {
        property: "og:description",
        content: "Configurable operational limits per asset class that drive automated alerting.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ThresholdsPage,
});
