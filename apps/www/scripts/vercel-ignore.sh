#!/usr/bin/env bash
# Vercel "Ignored Build Step": exit 0 skips the deployment, exit 1 builds it. Every deployment keeps its
# source and build output in Vercel storage, so a push that cannot change the marketing site (API,
# dashboard, tests, docs) must not create one. Paths are what `scripts/prepare.mjs` and the app read.
set -u
cd "$(git rev-parse --show-toplevel)" || exit 1
# Unknown history (shallow clone, first commit): build rather than guess.
git rev-parse --verify -q HEAD^ >/dev/null || exit 1
if git diff --quiet HEAD^ HEAD -- \
  apps/www packages/core packages/widget packages/api/src/env.ts CHANGELOG.md \
  package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json; then
  echo "No change under the marketing site's inputs; skipping this deployment."
  exit 0
fi
exit 1
