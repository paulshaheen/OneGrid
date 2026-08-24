import { createFileRoute } from "@tanstack/react-router";

import { EventsPage } from "@/views/events";

export const Route = createFileRoute("/_authenticated/app/events")({
  head: () => ({
    meta: [
      { title: "Weather Events | Weather & Asset Risk" },
      {
        name: "description",
        content:
          "Active and monitored tropical systems with intensity, motion and forecast confidence.",
      },
      { property: "og:title", content: "Weather Events | Weather & Asset Risk" },
      {
        property: "og:description",
        content:
          "Active and monitored tropical systems with intensity, motion and forecast confidence.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EventsPage,
});
