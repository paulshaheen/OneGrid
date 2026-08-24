import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/posture")({
  beforeLoad: () => {
    throw redirect({ to: "/app/posture" });
  },
});
