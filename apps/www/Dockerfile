# Pinwren website (landing page, docs, live demo) — a standalone Next.js server, no database.
#   docker build -f apps/www/Dockerfile -t pinwren-www .
#   docker run --rm -p 3200:3000 pinwren-www
# Base images are pinned by digest (tag kept for readability); Dependabot's docker updates refresh it.
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS base
RUN corepack enable
WORKDIR /repo

# --- dependencies (cached until a manifest or the lockfile changes) ------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/www/package.json apps/www/
COPY packages/core/package.json packages/core/
COPY packages/widget/package.json packages/widget/
RUN pnpm install --frozen-lockfile --filter "@pinwren/www..." --filter "@pinwren/widget..."

# --- build -------------------------------------------------------------------------------------------------
# The site reads the repository at build time (scripts/prepare.mjs): the env schema in packages/api, the
# CHANGELOG, and the widget bundles it serves on /demo.
FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @pinwren/widget build && pnpm --filter @pinwren/www build

# --- runtime -----------------------------------------------------------------------------------------------
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/www/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/www/.next/static ./apps/www/.next/static
COPY --from=build --chown=node:node /repo/apps/www/public ./apps/www/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:3000/robots.txt || exit 1
CMD ["node", "apps/www/server.js"]
