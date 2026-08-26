import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/asset-explorer")({
  beforeLoad: () => {
    throw redirect({ to: "/app/asset-explorer" });
  },
});
