import { createFileRoute } from "@tanstack/react-router";

import { RateAnalysisPage } from "@/views/rate-analysis";

export const Route = createFileRoute("/_authenticated/app/rates")({
  head: () => ({
    meta: [
      { title: "Customer Rate Analysis | OneGrid" },
      {
        name: "description",
        content:
          "Commercial rate comparison and savings opportunities across the customer portfolio.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RateAnalysisPage,
});
