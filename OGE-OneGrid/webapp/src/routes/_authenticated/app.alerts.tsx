import { createFileRoute } from "@tanstack/react-router";

import { AlertsPage } from "@/views/alerts";

export const Route = createFileRoute("/_authenticated/app/alerts")({
  head: () => ({
    meta: [
      { title: "Alerts | Weather & Asset Risk" },
      {
        name: "description",
        content: "Prioritised operational alerts from hazard exposure and threshold breaches.",
      },
      { property: "og:title", content: "Alerts | Weather & Asset Risk" },
      {
        property: "og:description",
        content: "Prioritised operational alerts from hazard exposure and threshold breaches.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AlertsPage,
});
