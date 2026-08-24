import { createFileRoute } from "@tanstack/react-router";

import { OverviewPage } from "@/views/index";

export const Route = createFileRoute("/_authenticated/app/")({
  head: () => ({
    meta: [
      { title: "Operations Overview | Weather & Asset Risk" },
      {
        name: "description",
        content:
          "Executive view of Severe weather exposure across offshore platforms, pipelines, refineries and LNG terminals.",
      },
      { property: "og:title", content: "Operations Overview | Weather & Asset Risk" },
      {
        property: "og:description",
        content:
          "Executive view of Severe weather exposure across offshore platforms, pipelines, refineries and LNG terminals.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OverviewPage,
});
