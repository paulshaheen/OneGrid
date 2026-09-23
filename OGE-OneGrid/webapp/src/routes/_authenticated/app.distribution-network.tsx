import { createFileRoute } from "@tanstack/react-router";

import { DistributionNetworkPage } from "@/views/distribution-network";

export const Route = createFileRoute("/_authenticated/app/distribution-network")({
  head: () => ({
    meta: [{ title: "Distribution Network | OneRig" }, { name: "robots", content: "noindex" }],
  }),
  component: DistributionNetworkPage,
});
