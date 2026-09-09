import { createFileRoute } from "@tanstack/react-router";

import { CommandCenterPage } from "@/views/command-center";

export const Route = createFileRoute("/_authenticated/app/command")({
  head: () => ({
    meta: [
      { title: "Command Center | OneGrid" },
      {
        name: "description",
        content:
          "Prototype energy grid command center — grid health, alerts, live holographic map, storm simulation, and maintenance overview.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CommandCenterPage,
});
