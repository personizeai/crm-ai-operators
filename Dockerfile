# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS run
WORKDIR /app

# tsx needed at runtime for ESM + TypeScript direct execution
RUN npm install -g tsx@4

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/
COPY manifests/ ./manifests/
COPY tsconfig.json ./

# Non-root user
RUN addgroup -S engine && adduser -S engine -G engine
USER engine

# Health-check via the engine's /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${ENGINE_PORT:-3000}/health || exit 1

EXPOSE 3000

CMD ["tsx", "src/scripts/engine.ts"]
