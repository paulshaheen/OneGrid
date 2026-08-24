import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/risk")({
  beforeLoad: () => {
    throw redirect({ to: "/app/risk" });
  },
});
