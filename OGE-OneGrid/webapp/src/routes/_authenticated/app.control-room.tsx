import { createFileRoute } from "@tanstack/react-router";

import { ControlRoomPage } from "@/views/controlroom";

export const Route = createFileRoute("/_authenticated/app/control-room")({
  validateSearch: (search: Record<string, unknown>): { plant?: string; asset?: string } => ({
    plant: typeof search.plant === "string" ? search.plant : undefined,
    asset: typeof search.asset === "string" ? search.asset : undefined,
  }),
  head: () => ({
    meta: [{ title: "Control Room | OneGrid" }, { name: "robots", content: "noindex" }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { plant, asset } = Route.useSearch();
  return <ControlRoomPage initialPlant={plant} initialAsset={asset} />;
}
