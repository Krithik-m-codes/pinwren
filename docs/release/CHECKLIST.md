# Pinwren release checklist

Status reconciled on 2026-10-27. The app is released at **0.2.0**, the widget at **0.3.0**, and React,
SDK, MCP and CLI at **0.2.0**. A GitHub release and an npm publication are separate events: check both.

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

Screenshot-on-comment, AI triage and dashboard translations are implemented. The widget and dashboard
support eleven languages. AI is optional and off by default. Jira Cloud and white-label entitlements
are implemented; SSO, SCIM, audit logs, custom roles, legal hold and SIEM streaming remain planned.
Cloud billing, the standalone guest portal and interactive Slack remain roadmap work.

## Known operational limits

- CSP permits inline scripts for prerendered Next.js shells (ADR 0021).
- Project exports are built in memory, one job per process. Files beyond the 512 MB aggregate cap
  are omitted and counted in the archive's README; exports expire after seven days.
- Optional `env_file` syntax requires Docker Compose v2.24 or newer.
- Refresh comparison tables against their linked upstream sources before launch announcements.
