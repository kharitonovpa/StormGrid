# ── Stage 1: install & build ──────────────────────────────────
FROM oven/bun:1 AS build

WORKDIR /app
COPY bun.lock package.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/client/package.json packages/client/package.json
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/client packages/client

RUN bun run --cwd packages/server build

ARG VITE_API_URL
RUN cd packages/client && bunx vite build && bun run inline-bundle.ts

# ── Stage 2: nginx with client static files ──────────────────
FROM nginx:alpine AS nginx
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/client/dist /var/www/wheee

# ── Stage 3: server runtime ──────────────────────────────────
FROM oven/bun:1-slim AS server

WORKDIR /app
COPY --from=build /app/packages/server/dist/index.js ./index.js
COPY --from=build /app/packages/server/drizzle ./drizzle

ENV PORT=3001
ENV DB_PATH=/data/wheee.db
EXPOSE 3001

CMD ["bun", "run", "index.js"]
