# OneGrid Teams demo bot (Microsoft 365 Agents SDK).
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3978
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . ./
EXPOSE 3978
CMD ["node", "index.js"]
