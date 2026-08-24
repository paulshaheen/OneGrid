import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/assets")({
  beforeLoad: () => {
    throw redirect({ to: "/app/assets" });
  },
});
