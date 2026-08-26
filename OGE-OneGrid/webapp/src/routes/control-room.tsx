import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/control-room")({
  beforeLoad: () => {
    throw redirect({ to: "/app/control-room" });
  },
});
