#!/usr/bin/env bash
# Offline Cloud migration + provisioning (docs/self-hosting/fly-supabase.md). Run from a trusted shell or
# CI job with the repository checked out and `pnpm install --frozen-lockfile` done. NEVER run it inside the
# app's Fly machine, and never `fly secrets set` any of these variables on the app.
#
# Required (all DIRECT Supabase connections, db.<ref>.supabase.co:5432, plain role names):
#   PINWREN_MIGRATION_DATABASE_URL   privileged role that owns the schema (Supabase `postgres`)
#   PINWREN_RUNTIME_DIRECT_URL       pinwren_runtime
#   PINWREN_SERVICE_DIRECT_URL       pinwren_service
set -euo pipefail

for v in PINWREN_MIGRATION_DATABASE_URL PINWREN_RUNTIME_DIRECT_URL PINWREN_SERVICE_DIRECT_URL; do
  if [ -z "${!v:-}" ]; then echo "$v is not set" >&2; exit 1; fi
done

echo "[1/2] migrating"
DATABASE_URL="$PINWREN_MIGRATION_DATABASE_URL" \
  PINWREN_SERVICE_DATABASE_URL= PINWREN_MIGRATION_DATABASE_URL= \
  pnpm --filter @pinwren/db migrate

echo "[2/2] provisioning Cloud isolation"
DATABASE_URL="$PINWREN_RUNTIME_DIRECT_URL" \
  PINWREN_SERVICE_DATABASE_URL="$PINWREN_SERVICE_DIRECT_URL" \
  PINWREN_MIGRATION_DATABASE_URL="$PINWREN_MIGRATION_DATABASE_URL" \
  pnpm --filter @pinwren/db provision:cloud

echo "done. Now deploy the app: fly deploy"
