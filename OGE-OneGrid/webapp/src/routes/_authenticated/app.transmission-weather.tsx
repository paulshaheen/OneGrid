import { createFileRoute } from "@tanstack/react-router";

import { TransmissionWeatherPage } from "@/views/transmission-weather";

export const Route = createFileRoute("/_authenticated/app/transmission-weather")({
  head: () => ({
    meta: [
      { title: "Transmission Weather | OneGrid" },
      {
        name: "description",
        content:
          "Corridor-level weather risk for transmission lines: wind and tree-fall outages, ice accretion, dynamic line ratings, heat-driven loading and crew pre-staging.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TransmissionWeatherPage,
});
