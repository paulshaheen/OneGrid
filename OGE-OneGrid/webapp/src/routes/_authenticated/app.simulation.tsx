import { createFileRoute } from "@tanstack/react-router";

import { SimulationPage } from "@/views/simulation";

export const Route = createFileRoute("/_authenticated/app/simulation")({
  head: () => ({
    meta: [{ title: "Failure Simulation | OneGrid" }, { name: "robots", content: "noindex" }],
  }),
  component: SimulationPage,
});
