# Annota — single self-hostable image: dashboard, API, widget bundles, migrations.
#   docker build -f docker/Dockerfile -t annota .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

# --- dependencies (cached until a manifest or the lockfile changes) ------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/api/package.json packages/api/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/widget/package.json packages/widget/
RUN pnpm install --frozen-lockfile

# --- build -----------------------------------------------------------------------------------------------
FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @annota/widget build && pnpm --filter @annota/web build

# --- runtime ---------------------------------------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    ANNOTA_DATA_DIR=/data \
    ANNOTA_MIGRATIONS_DIR=/app/migrations \
    ANNOTA_WORKERS=2
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
COPY --from=build --chown=node:node /repo/packages/db/drizzle ./migrations
COPY --chown=node:node docker/cluster.cjs ./cluster.cjs
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "cluster.cjs"]
