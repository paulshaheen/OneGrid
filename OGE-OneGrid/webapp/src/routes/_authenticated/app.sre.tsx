import { createFileRoute } from "@tanstack/react-router";

import { SreDemoPage } from "@/views/sre-demo";

export const Route = createFileRoute("/_authenticated/app/sre")({
  head: () => ({
    meta: [
      { title: "SRE Demo | OneGrid" },
      {
        name: "description",
        content:
          "Break the OneGrid dev site on purpose and watch Azure SRE Agent detect, investigate and fix it.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SreDemoPage,
});
