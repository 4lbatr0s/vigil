# syntax=docker/dockerfile:1

# ---- builder: install everything, build the web app and the server bundle ----
FROM node:24-bookworm-slim AS builder
# Build tools for better-sqlite3 in case no prebuilt binary matches this platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.15.0 --activate
WORKDIR /app
# Manifests first, so dependency layers are cached until a manifest changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @vigil/web build && pnpm --filter @vigil/server build
# A standalone production tree for the server: only its runtime dependencies, native modules compiled.
RUN pnpm --filter @vigil/server deploy --legacy --prod /out

# ---- runtime: plain node, no TypeScript, no build tools ----
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    VAULT_DIR=/data/vault \
    DB_PATH=/data/index.db \
    STATE_DB_PATH=/data/state.db \
    CHECKPOINT_DB_PATH=/data/checkpoints.db \
    SESSION_KEY_PATH=/data/session.key \
    VIGIL_STATIC_DIR=/app/web
WORKDIR /app
COPY --from=builder /out/node_modules ./node_modules
COPY --from=builder /out/package.json ./package.json
COPY --from=builder /app/apps/server/dist ./dist
COPY --from=builder /app/apps/web/build ./web
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# HOST=0.0.0.0 makes the server refuse to start without VIGIL_TOKEN (set it with -e or in compose).
CMD ["node", "dist/server.mjs"]
