# Pinwren release checklist

Status reconciled on **2026-11-16**. The release manifest records app **0.6.0**, widget **0.7.0**,
SDK/MCP/CLI **0.4.0** and React **0.2.0**. These are source version records; a GitHub release and an npm
publication are separate events and must each be verified. The current implementation backlog and
readiness gates are in [the roadmap checklist](../roadmap-status.md).

At upstream `0762e93`, [CI run 43149389098](https://github.com/Krithik-m-codes/pinwren/actions/runs/43149389098)
passed format/lint/types/unit, production/Docker builds, PostgreSQL 16/17 isolation, dashboard/widget
browser tests, website and API smoke. The fresh-install journey failed: expected `/forgot-password`,
stayed on `/sign-in`. The late-setup layout shift is now fixed locally: a deterministic regression
failed before the change, and the complete fresh-install journey passed 9/9 afterwards against a fresh
PostgreSQL 17 database. Release readiness remains open until CI is fully green on the intended release
head. Cloud worker findings and fixes are recorded in the [independent review](../security/2026-11-16-cloud-worker-review.md).

## Automated release gates

- Run `pnpm verify`: formatting, ESLint, TypeScript, unit tests and production builds.
- CI additionally runs widget and React wrapper Playwright, dashboard Playwright with Postgres,
  website accessibility/link/demo tests, the fresh-install journey, API smoke and a Docker build.
- Widget builds fail when a gzip budget is exceeded. The capture chunk has an explicit **92 KiB**
  exception because SnapDOM alone exceeds the original 75 KiB target (ADR 0022); it remains lazy.
- Run `pnpm audit` and review open CodeQL findings. A green analysis job only means the scan ran;
  it does not prove there are no open findings.
- Confirm required GitHub checks pass on the exact release commit before tagging or publishing.

Historical evidence from the 2026-10-26 candidate: API smoke 607/607; dashboard Playwright 73/73;
widget Playwright 68/68; website Playwright 85/85. These counts are historical, not fresh verification
of later commits. The earlier load results also predate AI enrichment.

Production smoke intentionally rejects the development licence key and loopback webhook targets;
do not hide unrelated failures as expected differences. Production licence public key `pinwren-2026`
is already committed; private keys stay outside the repository.

## Publishing prerequisites

The release workflow packs with pnpm (which rewrites `workspace:` dependencies) and publishes the
tarball with npm's OIDC-capable client. Already-published versions are skipped.

Register a trusted publisher for **each** of `@pinwren/widget`, `@pinwren/react`, `@pinwren/sdk`,
`@pinwren/mcp` and `@pinwren/cli` with these exact claims:

- GitHub owner: `Krithik-m-codes`
- Repository: `pinwren`
- Workflow filename: `release-please.yml`
- Environment: `npm`

The local npm token can read package metadata but received HTTP 403 when reading trusted-publisher
settings on 2026-10-27. Registration therefore needs the package owner's authenticated npm session
with 2FA. See [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/).
An `NPM_TOKEN` in the GitHub `npm` environment is an alternative while supported by npm policy.
Never commit that token. Verify the next actual publication; a skipped existing version does not
exercise authentication. Optionally configure `RELEASE_PLEASE_TOKEN` so generated PR events run CI.

## Manual validation still required

- Install on clean amd64 and arm64 hosts, then upgrade seeded data from the previous release.
- Perform a backup and restore drill and verify both Postgres data and uploaded files.
- Exercise real S3 storage, real Jira/Linear accounts and SMTP delivery; existing mock tests cannot
  establish real-service compatibility or deliverability.
- Spot-check captures on three realistic sites and keyboard/screen-reader workflows.
- Record fresh load/capacity and accessibility results before making release performance claims.
- Keep the server private until the first owner account exists (Compose binds loopback by default).
- Trademark clearance remains an owner/legal task, separate from code verification.

## Implemented features previously listed as missing

Screenshot-on-comment, optional AI triage, dashboard/widget translations, Jira Cloud and white-label
entitlements are implemented. The standalone guest portal, launcher theming/favicon, interactive Slack,
Cloud tenant isolation and sign-up/onboarding are also implemented. Cloud sign-up defaults to closed;
Free/Pro Dodo Payments billing, limits and dunning are built in test mode.

Later additions include named/shared server-persisted dashboards and filters, account preferences,
custom fields, release/regression tracking, tracker adapters, screen recording/voice, AI labels/automation,
agent hand-off/repro tests and sharing/client sign-off. SSO, SCIM, audit logs, custom roles, custom
domains, legal hold and SIEM streaming remain unimplemented. The
[remaining-work checklist](../roadmap-status.md) records billing gaps, scale/AI work and validation separately.

## Known operational limits

- CSP permits inline scripts for prerendered Next.js shells (ADR 0021).
- Project exports are built in memory, one job per process. Files beyond the 512 MB aggregate cap
  are omitted and counted in the archive's README; exports expire after seven days.
- Optional `env_file` syntax requires Docker Compose v2.24 or newer.
- Refresh comparison tables against their linked upstream sources before launch announcements.
