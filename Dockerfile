FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npx vite build --config apps/playground/vite.config.ts

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DB_PATH=/data/turnpike.sqlite PORT=8080
COPY --from=build /app /app
VOLUME /data
EXPOSE 8080
CMD ["npx", "ts-node", "--transpile-only", "apps/gateway/src/server.ts"]
