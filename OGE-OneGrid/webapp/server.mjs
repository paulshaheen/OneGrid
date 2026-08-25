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
import { join, extname } from "node:path";
import { existsSync, statSync, readFileSync } from "node:fs";
import { serve } from "srvx";

const distDir = process.env.DIST_DIR || "dist";
const { default: ssr } = await import(`./${distDir}/server/server.js`);
const clientDir = join(import.meta.dirname, distDir, "client");
const port = Number(process.env.PORT) || 3000;
// When embedded under a reverse-proxy prefix (e.g. /webapp) asset URLs carry that
// prefix but the files still live at the root of dist/client — strip it on lookup.
const base = (process.env.APP_BASE_PATH || "").replace(/\/+$/, "");

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".map": "application/json", ".txt": "text/plain", ".wasm": "application/wasm",
};

// Resolve a request to a built client asset file, or null to defer to SSR.
function resolveStatic(pathname) {
  let rel = pathname;
  if (base && rel.startsWith(base + "/")) rel = rel.slice(base.length);
  if (rel === "/" || rel === "") return null; // document routes → SSR
  const file = join(clientDir, decodeURIComponent(rel));
  if (!file.startsWith(clientDir)) return null; // path traversal guard
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

serve({
  port,
  hostname: "0.0.0.0",
  fetch: (request) => {
    const { pathname } = new URL(request.url);
    const file = resolveStatic(pathname);
    if (file) {
      const ext = extname(file).toLowerCase();
      const immutable = /[\\/]assets[\\/]/.test(file) && ext !== ".html";
      return new Response(readFileSync(file), {
        headers: {
          "content-type": MIME[ext] || "application/octet-stream",
          "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
        },
      });
    }
    return ssr.fetch(request, {}, {});
  },
});

console.log(`web app listening on port ${port}${base ? ` (base ${base})` : ""}`);
