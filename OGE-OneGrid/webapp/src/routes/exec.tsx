import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/exec")({
  beforeLoad: () => {
    throw redirect({ to: "/app/exec" });
  },
});
