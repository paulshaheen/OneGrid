import { createFileRoute } from "@tanstack/react-router";

import { AssetExplorerPage } from "@/views/asset-explorer";

export const Route = createFileRoute("/_authenticated/app/asset-explorer")({
  validateSearch: (search: Record<string, unknown>): { asset?: string; category?: string } => ({
    asset: typeof search.asset === "string" ? search.asset : undefined,
    category: typeof search.category === "string" ? search.category : undefined,
  }),
  head: () => ({
    meta: [{ title: "Asset Explorer | OneGrid" }, { name: "robots", content: "noindex" }],
  }),
  component: AssetExplorerPage,
});
