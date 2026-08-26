import { createFileRoute } from "@tanstack/react-router";

import { ControlRoomPage } from "@/views/controlroom";

export const Route = createFileRoute("/_authenticated/app/control-room")({
  head: () => ({
    meta: [{ title: "Control Room | OneGrid" }, { name: "robots", content: "noindex" }],
  }),
  component: ControlRoomPage,
});
