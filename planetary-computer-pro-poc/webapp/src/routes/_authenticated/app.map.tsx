import { createFileRoute } from "@tanstack/react-router";

import { MapPage } from "@/views/map";

export const Route = createFileRoute("/_authenticated/app/map")({
  head: () => ({
    meta: [
      { title: "Live Map | Weather & Asset Risk" },
      {
        name: "description",
        content:
          "Interactive operations map with hurricane track, forecast cone, wind field and asset exposure layers.",
      },
      { property: "og:title", content: "Live Map | Weather & Asset Risk" },
      {
        property: "og:description",
        content:
          "Interactive operations map with hurricane track, forecast cone, wind field and asset exposure layers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MapPage,
});
