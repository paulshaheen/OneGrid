import { createFileRoute } from "@tanstack/react-router";

import { DeploymentPage } from "@/views/deployment";

export const Route = createFileRoute("/_authenticated/app/deployment")({
  head: () => ({
    meta: [
      { title: "Deployment | Weather & Asset Risk" },
      {
        name: "description",
        content: "Azure reference architecture and adapter configuration for tenant deployment.",
      },
      { property: "og:title", content: "Deployment | Weather & Asset Risk" },
      {
        property: "og:description",
        content: "Azure reference architecture and adapter configuration for tenant deployment.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DeploymentPage,
});
