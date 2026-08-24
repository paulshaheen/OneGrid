# Predictive Maintenance dashboard (report-app) + bundled chat agent.
# The report server builds/serves the SPA, exposes the data API + realtime WebSocket,
# and spawns the chat agent internally — exactly like localhost. Auth to Fabric uses the
# container's managed identity (fabric.js: SP -> MI -> az CLI).

# ---- build the SPA ----
FROM node:20-alpine AS build
WORKDIR /app/report-app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY report-app/package.json report-app/package-lock.json ./
RUN npm ci
COPY report-app/ ./
RUN npm run build

# ---- runtime: report server + chat agent (spawned) ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production REPORT_PORT=8080
# report server + built SPA + its only runtime dependency (ws)
COPY report-app/package.json ./report-app/package.json
COPY report-app/server ./report-app/server
COPY --from=build /app/report-app/dist ./report-app/dist
COPY --from=build /app/report-app/node_modules/ws ./report-app/node_modules/ws
# chat agent (sibling folder, zero npm deps) — spawned by the report server
COPY chatagent ./chatagent
# Governance review-plane manifest(s). The sample always exists (so the plane renders
# with real role shapes instead of the hardcoded 'fallback'); a governance-enabled deploy
# also drops a real governance-manifest.json at the repo root, which this wildcard picks up.
# governance.js reads these from the image root (/app).
COPY governance-manifest*.json ./
EXPOSE 8080
CMD ["node", "report-app/server/index.js"]
