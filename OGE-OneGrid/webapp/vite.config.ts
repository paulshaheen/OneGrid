import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  // When embedded as the OneGrid "Explorer" tab the app is reverse-proxied under
  // /webapp, so asset URLs + the router must carry that prefix. Standalone builds
  // leave APP_BASE_PATH unset and serve from root.
  base: process.env.APP_BASE_PATH || "/",
  plugins: [
    tsConfigPaths(),
    tailwindcss(),
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR
    // error wrapper). Nitro builds the Node server output from this.
    tanstackStart({ server: { entry: "server" } }),
    viteReact(),
  ],
  // MapLibre ships its own web worker; pre-bundling it breaks worker loading in dev.
  // Pre-bundle the report-app 3D/chart/animation deps so the lazily-loaded personas
  // (Asset Explorer, Simulation, Control Room) don't trigger a first-load optimizer
  // reload when their routes are first opened.
  optimizeDeps: {
    exclude: ["maplibre-gl"],
    include: [
      "recharts",
      "framer-motion",
      "three",
      "@react-three/fiber",
      "@react-three/drei",
      "@react-three/postprocessing",
      "postprocessing",
    ],
  },
});
