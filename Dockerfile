# Gateway image. Compiled JavaScript only, production dependencies only: no Hardhat, ts-node, test tooling or frontend in the runtime layer.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY tsconfig.build.json ./
COPY apps/gateway apps/gateway
COPY packages/middleware packages/middleware
RUN npx tsc -p tsconfig.build.json

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DB_PATH=/data/turnpike.sqlite PORT=8080
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Runs as root because a Fly volume mounts root-owned; the process only writes to /data.
VOLUME /data
EXPOSE 8080
CMD ["node", "dist/apps/gateway/src/server.js"]
