import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/deployment")({
  beforeLoad: () => {
    throw redirect({ to: "/app/deployment" });
  },
});
