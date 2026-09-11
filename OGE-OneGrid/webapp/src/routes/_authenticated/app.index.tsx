import { createFileRoute } from "@tanstack/react-router";

import { CommandCenterPage } from "@/views/command-center";

// The Command Center is the landing page (mapped to Overview). The original
// Operations Overview is archived at /app/overview-legacy.
export const Route = createFileRoute("/_authenticated/app/")({
  head: () => ({
    meta: [
      { title: "Command Center | OneGrid" },
      {
        name: "description",
        content:
          "OneGrid command center — grid health, weather exposure, live holographic map, storm and digital-twin failure simulation, and maintenance overview.",
      },
      { property: "og:title", content: "Command Center | OneGrid" },
      {
        property: "og:description",
        content:
          "Unified energy grid command center: weather exposure, digital-twin status, and asset-risk operations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CommandCenterPage,
});
