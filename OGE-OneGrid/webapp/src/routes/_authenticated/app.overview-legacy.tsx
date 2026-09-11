import { createFileRoute } from "@tanstack/react-router";

import { OverviewPage } from "@/views/index";

// Archived original Operations Overview. Kept so it can be restored as the
// landing page if needed (the Command Center replaced it at /app).
export const Route = createFileRoute("/_authenticated/app/overview-legacy")({
  head: () => ({
    meta: [
      { title: "Overview (Legacy) | OneGrid" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OverviewPage,
});
