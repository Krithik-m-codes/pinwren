# 12 — Testing and quality gates

## 1. Test layers

| Layer               | Tool                                                          | Scope                                                                                                                        | Runs                                    |
| ------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Unit                | Vitest                                                        | Pure logic: anchoring, selectors, serializers, redaction, URL normalisation, entitlements, licence verification, plan limits | Every commit                            |
| Component           | Vitest + Testing Library (dashboard), Preact testing (widget) | UI components, a11y roles, keyboard handling                                                                                 | Every commit                            |
| Integration         | Vitest + Testcontainers Postgres                              | API routes end-to-end against a real DB, jobs, RLS, migrations                                                               | Every commit                            |
| E2E                 | Playwright                                                    | Widget on fixture sites × flows; dashboard triage; self-host compose smoke                                                   | PR (smoke) / main (full matrix)         |
| Anchoring benchmark | Playwright + custom runner                                    | 10 pages × 30 mutations, re-attach rate                                                                                      | PR touching anchoring/widget; nightly   |
| Performance         | Playwright tracing, size-limit, k6                            | Widget main-thread/memory budgets, bundle sizes, API p95                                                                     | PR (size), nightly (perf), release (k6) |
| Security            | Custom integration tests + ZAP baseline                       | Each mitigation in 09 has a test; cross-tenant suite (Cloud)                                                                 | PR / nightly                            |
| Accessibility       | axe-core in Playwright, manual checklist                      | Every dashboard route + widget states                                                                                        | PR (axe) / release (manual)             |
| Visual regression   | Playwright screenshots                                        | Widget themes on hostile-CSS fixture, key dashboard screens                                                                  | PR                                      |

## 2. Fixture sites (`e2e/fixtures`)

plain-html · nextjs-app-router · nuxt · sveltekit · astro · wordpress-like (jQuery, global CSS) · hostile-css (`* { all: unset }`, `!important` everywhere, huge z-indexes) · csp-strict (nonce-only) · cross-origin-assets (images/fonts from another origin) · iframe-heavy · long-spa (virtualised list, route changes) · rtl.

## 3. Gates (CI must be green to merge)

1. `pnpm format:check` (Prettier) and `pnpm lint` (ESLint, ADR 0017).
2. `pnpm typecheck` — zero errors, no `any` without an explanatory comment, no `@ts-ignore`.
3. Unit + component + integration tests pass; coverage ≥ 80 % lines for `packages/anchoring`, `packages/capture`, `packages/core`, `ee/licensing`, `ee/billing`.
4. E2E smoke passes; full matrix passes on `main`.
5. size-limit budgets from 05 §2.
6. Anchoring re-attach ≥ 90 %.
7. axe: no serious/critical violations.
8. Licence check: MIT packages contain no copyleft dependencies; no AGPL code from third parties anywhere.
9. OpenAPI document regenerated and committed (diff check).

## 4. Definition of done (per work package)

- Acceptance criteria of every feature touched are met and covered by tests.
- Empty, loading, error states implemented for any new screen.
- Keyboard and screen-reader paths work.
- Docs and `env.example` updated.
- No TODO without a WP reference (`TODO(WP-xx)`).

## 5. Manual release checklist

- Fresh install on a clean VM via `install.sh` (amd64 and arm64).
- Upgrade from previous release with seeded data; verify migrations and that nothing is lost.
- Widget on three real public sites (staging copies) — capture fidelity spot check.
- Email deliverability check (SPF/DKIM guidance in docs, test send).
- Backup → wipe → restore drill.
