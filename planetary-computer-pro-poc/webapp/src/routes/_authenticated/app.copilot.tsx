import { createFileRoute } from "@tanstack/react-router";

import { CopilotPage } from "@/views/copilot";

export const Route = createFileRoute("/_authenticated/app/copilot")({
  head: () => ({
    meta: [
      { title: "Operations Assistant | Weather & Asset Risk" },
      {
        name: "description",
        content: "Natural-language assistant grounded in live asset, storm and risk data.",
      },
      { property: "og:title", content: "Operations Assistant | Weather & Asset Risk" },
      {
        property: "og:description",
        content: "Natural-language assistant grounded in live asset, storm and risk data.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CopilotPage,
});
