import { createFileRoute } from "@tanstack/react-router";

import { TimelinePage } from "@/views/timeline";

export const Route = createFileRoute("/_authenticated/app/timeline")({
  head: () => ({
    meta: [
      { title: "Forecast Timeline | Weather & Asset Risk" },
      {
        name: "description",
        content:
          "120-hour forecast scrubbing showing how storm position and asset exposure evolve.",
      },
      { property: "og:title", content: "Forecast Timeline | Weather & Asset Risk" },
      {
        property: "og:description",
        content:
          "120-hour forecast scrubbing showing how storm position and asset exposure evolve.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TimelinePage,
});
