import { createFileRoute } from "@tanstack/react-router";

import { ExecBriefPage } from "@/views/exec-brief";

export const Route = createFileRoute("/_authenticated/app/exec")({
  validateSearch: (search: Record<string, unknown>): { layout?: "actions" | "scorecard" } =>
    search["layout"] === "actions" || search["layout"] === "scorecard"
      ? { layout: search["layout"] }
      : {},
  head: () => ({
    meta: [
      { title: "Executive Brief | OneGrid" },
      {
        name: "description",
        content:
          "One-page executive brief: weather threat, equipment risk, estimated cost at risk and the decisions needed this week.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ExecBriefPage,
});
