# Release readiness fixes

**Goal:** Resolve the actionable findings from the repository status review and push verified fixes.

**Scope:** Existing Community functionality, security, CI, release tooling and documentation. Cloud and planned Enterprise features remain separate roadmap work.

1. Recheck current source, GitHub alerts, releases and PRs. Preserve unrelated user changes.
2. Add regression coverage for AI response parsing, provider URL normalization and the published CLI command; replace backtracking regular expressions with linear string operations.
3. Override the vulnerable transitive Happy DOM release and regenerate the lockfile.
4. Make the local demo serve built widget assets from its own origin; keep API requests restricted to loopback targets.
5. Add missing React/website/journey/API smoke CI checks, enforce bundle budgets and record an explicit capture-size exception rather than silently passing it.
6. Repair npm publishing using packed workspace packages and the supported npm OIDC client; document account-side publisher configuration that cannot be created from this checkout.
7. Correct comparison tables, stale parity entries and the release checklist. Enable available GitHub security settings and branch protections after the push.
8. Run formatting, lint, type checks, unit tests, production builds and relevant browser tests; obtain an independent review, commit, push and monitor CI.
9. Close the open generated release PRs with `gh` as requested; verify no open PRs remain.

**Verification:** Tests must exercise malformed and fenced AI replies, trailing URL slashes and the scoped CLI command. CI uses isolated Postgres databases and test-only credentials. No npm release or new commercial feature is required by this maintenance pass.

**Execution:** Inline. Existing clean checkout and installed dependencies are retained to avoid duplicating several gigabytes on a drive with limited space. The user explicitly authorized fixes, pushing and PR closure.
