# Pinwren 0.1.0 — release checklist

Status as of 2026-10-22. Everything below "Verified" was run on the release candidate, not assumed. Nothing has
been pushed or published yet.

## Verified

| Check                                                      | Result                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `pnpm verify` (format, lint, typecheck, unit tests, build) | ✅ green — 358 unit tests across 10 packages, 13 typecheck tasks   |
| API smoke (`scripts/smoke.mjs`, dev server)                | ✅ 327 / 327, incl. 34 attack checks                               |
| API smoke against the production Docker image (2 workers)  | ✅ 288 pass; 11 expected differences (below)                       |
| Dashboard Playwright                                       | ✅ 33 / 33                                                         |
| Widget Playwright / React                                  | ✅ 59 / 59, React check ✅                                         |
| Website + docs Playwright (axe, link checker)              | ✅ 78 / 78                                                         |
| Load test, hardened image, 4 CPU / 4 workers               | ✅ all thresholds, ~130 req/s, p95 46 / 76 / 83 ms, 0 errors       |
| npm packages (`pnpm pack`, manifests, real install)        | ✅ widget, react, sdk, mcp, cli install and run from tarballs      |
| Independent security review                                | ✅ 3 high, 4 medium, 7 low found — all fixed and tested (ADR 0021) |

The 11 Docker-only smoke differences are by design: 10 licence checks sign with the development key, which a
production build refuses; one webhook check targets the host loopback, which the outbound guard blocks in
Docker. The SDK/MCP/CLI section runs from the host only (`SMOKE_SKIP_PACKAGES=1` in the container).

## Owner actions before release (only you can do these)

1. **Production licence key** — follow `docs/release/licence-keys.md` (generate on a trusted machine, keep the
   private key in your password manager, commit only the public key). Until then every official image build
   fails on purpose.
2. **Trademark** — search "Pinwren" in USPTO / EUIPO / your market before buying domains or announcing.
3. **Domains** — `pinwren.dev` (site) is the placeholder in `apps/www/src/lib/site.ts`; change it there if you
   pick another.
4. **npm** — in the `@pinwren` org, either add a **trusted publisher** for `Krithik-m-codes/pinwren`
   (workflow `release-please.yml`, environment `npm`) or create an automation token and save it as the
   `NPM_TOKEN` secret in a GitHub environment named `npm`.
5. **GitHub repo settings** — enable private vulnerability reporting (SECURITY.md points to it) and
   Discussions (the site links them); optionally add `RELEASE_PLEASE_TOKEN` so release PRs trigger CI.
6. **Disk space** — drive E has ~4 GB free; Next.js dev caches need 1–3 GB per app.

## Release steps (after your go-ahead)

1. `git push origin main` — pushes all local commits to the public repo. CI runs.
2. release-please opens a release PR (root app + `@pinwren/widget`, `sdk`, `mcp`, `cli`, `react`, all `0.1.0`).
   Fold the CHANGELOG's "Unreleased" notes into it, review, merge.
3. Merging tags the releases; the workflow publishes the packages to npm (SDK before MCP) with provenance and
   the multi-arch Docker image to GHCR.
4. Deploy `apps/www` (its own `Dockerfile`, or Vercel) to the site domain.

## Known gaps shipping in 0.1.0 (documented, not blockers)

- **"Screenshot with every comment"** project switch is saved but the widget doesn't read it yet (docs say so).
- **`widget-capture` chunk** is ~90 KB gzip (SnapDOM itself is ~88 KB); serve brotli (~76 KB). Loaded only when
  someone reports a bug.
- **Dashboard is English-only**; the widget ships 11 languages.
- **CSP allows inline scripts** (no third-party scripts): Next's nonces don't work with prerendered static
  shells — ADR 0021.
- **S3 storage** was tested against a simulated S3, not a real bucket — try your bucket before relying on it.
- **Project export is built in memory** (one job at a time per process): files beyond 512 MB in all are left out
  and counted in the zip's `README.txt`. Exports are kept 7 days; a new export replaces the old file.
- **`env_file` in `docker/compose.yml` needs Docker Compose v2.24+** (the optional-file syntax). Older Compose
  refuses the file; upgrade Compose or delete the `env_file` block and pass variables as before.
- **First account = instance admin** (BugPin model, ADR 0021 amendment): a server reachable from the internet
  before its owner signs up can be claimed by someone else. The compose file binds to 127.0.0.1 and the docs
  say to keep it private until the first account exists.
- **Dependabot** may not support the pnpm 12 lockfile yet.
- **Competitor comparison** cells on the site and README are from public pages as of Oct 2026 — re-check before
  launch posts.
