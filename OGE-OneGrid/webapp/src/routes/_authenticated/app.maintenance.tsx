import { createFileRoute } from "@tanstack/react-router";

import { MaintenancePage } from "@/views/maintenance";

export const Route = createFileRoute("/_authenticated/app/maintenance")({
  head: () => ({
    meta: [{ title: "Maintenance | OneGrid" }, { name: "robots", content: "noindex" }],
  }),
  component: MaintenancePage,
});
