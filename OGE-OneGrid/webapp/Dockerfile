# OneGrid preview image — SSR Node host serving the sample-data build.
# Build stage compiles the client + SSR bundles with sample data baked in.
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund
COPY . .
ENV VITE_USE_SAMPLE_DATA=true
RUN npm run build

# Runtime stage: prod deps + built output + the Node host.
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV DIST_DIR=dist
COPY package.json package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server.mjs ./server.mjs
EXPOSE 8080
CMD ["node", "server.mjs"]
