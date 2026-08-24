import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    tsConfigPaths(),
    tailwindcss(),
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR
    // error wrapper). Nitro builds the Node server output from this.
    tanstackStart({ server: { entry: "server" } }),
    viteReact(),
  ],
  // MapLibre ships its own web worker; pre-bundling it breaks worker loading in dev.
  optimizeDeps: { exclude: ["maplibre-gl"] },
});
