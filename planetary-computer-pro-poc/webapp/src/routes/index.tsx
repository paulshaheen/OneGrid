import { createFileRoute, redirect } from "@tanstack/react-router";

// This is the PRODUCT app (what customers fork + "Deploy to Azure"). It carries
// no marketing landing and no demo console — those live in the separate
// marketing app/repo. A tenant deployment signs into the /app console.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/app" });
  },
});
