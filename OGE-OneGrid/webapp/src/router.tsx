import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    // Match Vite's `base` so client-side navigation stays under the deploy prefix
    // (e.g. /webapp when embedded as the OneGrid Explorer tab). Defaults to "/".
    basepath: import.meta.env.BASE_URL,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
