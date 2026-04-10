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
RUN bun run --cwd packages/client build

# ── Stage 2: client static output (for nginx) ────────────────
FROM scratch AS client
COPY --from=build /app/packages/client/dist /dist

# ── Stage 3: server runtime ──────────────────────────────────
FROM oven/bun:1-slim AS server

WORKDIR /app
COPY --from=build /app/packages/server/dist/index.js ./index.js

ENV PORT=3001
EXPOSE 3001

CMD ["bun", "run", "index.js"]
