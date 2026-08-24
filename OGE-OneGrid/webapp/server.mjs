// Production Node host for the TanStack Start SSR app.
//
// The Vite build emits two things:
//   - dist/client/  : static assets (JS/CSS chunks, favicon.ico, robots.txt)
//   - dist/server/server.js : a Web-standard `fetch` handler (SSR)
//
// This host serves the static client files first, then delegates everything
// else to the SSR handler. It listens on the port Azure App Service provides
// via process.env.PORT (defaulting to 3000 for local runs). srvx is the same
// universal server TanStack Start uses internally, so the request/response
// bridging is identical to dev.
import { join } from "node:path";
import { serve } from "srvx";
import { serveStatic } from "srvx/static";

const distDir = process.env.DIST_DIR || "dist";
const { default: ssr } = await import(`./${distDir}/server/server.js`);
const clientDir = join(import.meta.dirname, distDir, "client");
const port = Number(process.env.PORT) || 3000;

serve({
  port,
  hostname: "0.0.0.0",
  middleware: [serveStatic({ dir: clientDir })],
  fetch: (request) => ssr.fetch(request, {}, {}),
});

console.log(`web app listening on port ${port}`);
