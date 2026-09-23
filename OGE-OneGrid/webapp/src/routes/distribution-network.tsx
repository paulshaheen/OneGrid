import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/distribution-network")({
  beforeLoad: () => {
    throw redirect({ to: "/app/distribution-network" });
  },
});
