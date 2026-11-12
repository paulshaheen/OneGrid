import { createFileRoute } from "@tanstack/react-router";

import { OffshoreWeatherPage } from "@/views/offshore-weather";

export const Route = createFileRoute("/_authenticated/app/offshore-weather")({
  head: () => ({
    meta: [
      { title: "Offshore Weather | OneRig" },
      {
        name: "description",
        content: "Wind and sea state at each offshore site: when crane, helicopter, supply-vessel, transfer and riser weather windows close, Aurora vs NOAA.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OffshoreWeatherPage,
});
