# OneGrid: report-app backend (data API + realtime WebSocket + spawned chat agent)
# that hosts the unified webapp under /webapp as its sole frontend. Any non-API path
# redirects to /webapp/app. Auth to Fabric uses the container's managed identity
# (fabric.js: SP -> MI -> az CLI).

# ---- build the unified webapp (TanStack Start SSR) under base /webapp ----
FROM node:20-alpine AS build
WORKDIR /app/webapp
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY webapp/package.json webapp/package-lock.json ./
RUN npm ci
COPY webapp/ ./
RUN APP_BASE_PATH=/webapp npm run build

# ---- runtime: report server + webapp SSR child + chat agent (spawned) ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production REPORT_PORT=8080
# report server + its only runtime dependency (ws)
COPY report-app/package.json report-app/package-lock.json ./report-app/
RUN cd report-app && npm ci --omit=dev
COPY report-app/server ./report-app/server
# unified webapp: built output + SSR entry + production deps for the child the server spawns
COPY --from=build /app/webapp/server.mjs ./webapp/server.mjs
COPY --from=build /app/webapp/package.json ./webapp/package.json
COPY --from=build /app/webapp/dist ./webapp/dist
COPY --from=build /app/webapp/node_modules ./webapp/node_modules
# chat agent (sibling folder, zero npm deps) — spawned by the report server
COPY chatagent ./chatagent
# Governance review-plane manifest(s). The sample always exists (so the plane renders
# with real role shapes instead of the hardcoded 'fallback'); a governance-enabled deploy
# also drops a real governance-manifest.json at the repo root, which this wildcard picks up.
# governance.js reads these from the image root (/app).
COPY governance-manifest*.json ./
EXPOSE 8080
CMD ["node", "report-app/server/index.js"]
