import { createFileRoute } from "@tanstack/react-router";

import { AssetExplorerPage } from "@/views/asset-explorer";

export const Route = createFileRoute("/_authenticated/app/asset-explorer")({
  head: () => ({
    meta: [{ title: "Asset Explorer | OneGrid" }, { name: "robots", content: "noindex" }],
  }),
  component: AssetExplorerPage,
});
