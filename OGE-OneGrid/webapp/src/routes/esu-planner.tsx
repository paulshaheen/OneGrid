import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/esu-planner")({
  beforeLoad: () => {
    throw redirect({ to: "/app/esu-planner" });
  },
});
