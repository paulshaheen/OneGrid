# syntax=docker/dockerfile:1
# Unified OneGrid container image for the legacy Container Apps instance
# (onegrid-app-75033e). Reproduces the run-from-package payload that
# deploy-app.ps1 ships to App Service: the report-app server serves /api + the
# webapp SSR and spawns the chatagent, listening on REPORT_PORT (8080).

# ---- build the webapp SSR + client bundles (base path /webapp) ----
FROM node:22-bookworm-slim AS webapp-build
WORKDIR /app/webapp
COPY webapp/package*.json ./
RUN npm install --no-audit --no-fund
COPY webapp/ ./
ENV APP_BASE_PATH=/webapp
RUN npm run build && npm prune --omit=dev

# ---- install report-app runtime deps (ws) ----
FROM node:22-bookworm-slim AS reportapp-deps
WORKDIR /app/report-app
COPY report-app/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# ---- runtime: report-app + built webapp + chatagent ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV REPORT_PORT=8080
# report-app source + its runtime node_modules
COPY report-app/ ./report-app/
COPY --from=reportapp-deps /app/report-app/node_modules ./report-app/node_modules
# never ship a resolved Fabric target (prod is wired via container env)
RUN rm -f report-app/server/target.json report-app/server/target.local.json
# prebuilt webapp (dist + pruned runtime deps + public assets)
COPY --from=webapp-build /app/webapp ./webapp
# chatagent (spawned by the report server; zero npm deps)
COPY chatagent/ ./chatagent/
EXPOSE 8080
CMD ["node", "report-app/server/index.js"]
