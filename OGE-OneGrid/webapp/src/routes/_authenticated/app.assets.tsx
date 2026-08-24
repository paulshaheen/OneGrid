import { createFileRoute } from "@tanstack/react-router";

import { AssetsPage } from "@/views/assets";

export const Route = createFileRoute("/_authenticated/app/assets")({
  head: () => ({
    meta: [
      { title: "Asset Management | Weather & Asset Risk" },
      {
        name: "description",
        content:
          "Registry of platforms, wells, pipelines, refineries, terminals and ports under monitoring.",
      },
      { property: "og:title", content: "Asset Management | Weather & Asset Risk" },
      {
        property: "og:description",
        content:
          "Registry of platforms, wells, pipelines, refineries, terminals and ports under monitoring.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AssetsPage,
});
