import { createFileRoute } from "@tanstack/react-router";

import { MaintenancePage } from "@/views/maintenance";

export const Route = createFileRoute("/_authenticated/app/maintenance")({
  validateSearch: (search: Record<string, unknown>): { wo?: string } => ({
    wo: typeof search.wo === "string" ? search.wo : undefined,
  }),
  head: () => ({
    meta: [{ title: "Maintenance | OneGrid" }, { name: "robots", content: "noindex" }],
  }),
  component: MaintenancePage,
});
