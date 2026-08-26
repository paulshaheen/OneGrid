import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/simulation")({
  beforeLoad: () => {
    throw redirect({ to: "/app/simulation" });
  },
});
