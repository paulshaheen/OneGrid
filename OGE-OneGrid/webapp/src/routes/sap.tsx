import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/sap")({
  beforeLoad: () => {
    throw redirect({ to: "/app/sap" });
  },
});
