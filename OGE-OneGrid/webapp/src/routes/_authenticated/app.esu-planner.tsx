import { createFileRoute } from "@tanstack/react-router";

import { EsuPlannerPage } from "@/views/esu-planner";

export const Route = createFileRoute("/_authenticated/app/esu-planner")({
  head: () => ({
    meta: [
      { title: "ESU Planner | OneGrid" },
      {
        name: "description",
        content:
          "ESU Compass — Extended Security Updates cost and modernization planner for Windows Server and SQL Server.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EsuPlannerPage,
});
