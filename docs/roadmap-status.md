# Roadmap status and remaining work

Reconciled **2026-11-16** against upstream implementation commit
`0762e937f5b23d3e18415701ee5cf19e1eeb79cf`.
This is the current completion checklist; dated execution plans are historical records.
The [blueprint roadmap](../blueprint/10-roadmap.md) remains the scope and release-gate specification.

“Implemented” below means source and automated coverage exist. It does not establish live service
availability, npm publication, production deployment, or completion of a phase's release gate.
This reconciliation inspected code, tests, ADRs and recorded CI; it did not rerun application suites.
The release manifest records app **0.6.0**, widget **0.7.0**, SDK/MCP/CLI **0.4.0**, React **0.2.0**.

Follow-up on `feat/roadmap-completion` (2026-11-16): the sign-in race and three reviewed Cloud worker
defects are fixed. Fresh local evidence is 9/9 journey checks, 591 tests across 23 PostgreSQL 17
isolation suites, 1,224 workspace unit tests, typechecking and production builds. See the
[review and remaining worker findings](security/2026-11-16-cloud-worker-review.md).
The initial documentation reconciliation above did not run tests; this follow-up did.

## Implemented work removed from the backlog

- [x] Core self-host feedback, triage, capture, notifications, Docker/setup and CLI; widget parity extras
      (WP-00–13 and WP-30). The doctor command and backup limitations below still differ from the full spec.
- [x] Realtime/presence, board/pages/rounds/saved views, webhooks/chat, issue sync, token API, SDK/MCP,
      replay, localisation and React wrapper (WP-14–20). See [feature parity](../blueprint/14-feature-parity.md).
- [x] Standalone guest portal, private widget/email entry, reporter-scoped threads and public replies:
      [API](../packages/api/src/routes/guest.ts), [API tests](../packages/api/src/guest-portal.test.ts),
      [browser tests](../apps/web/e2e/guest-portal.e2e.ts), [widget tests](../packages/widget/e2e/guest-portal.e2e.ts).
- [x] Launcher light/dark colours and hover toggle, plus organisation favicon branding:
      [launcher tests](../packages/widget/src/fab.test.ts), [branding route](../packages/api/src/routes/branding.ts).
- [x] Cloud tenant isolation, provisioning/startup guards and cross-tenant test runner (WP-21 foundation):
      [security evidence](security/cloud-tenant-isolation.md), [runner](../scripts/tenant-isolation.mjs).
- [x] Cloud sign-up/onboarding, consent, verification and abuse limits. Implemented, closed by default:
      [sign-up tests](../packages/api/src/cloud-signup-db.test.ts), [environment schema](../packages/api/src/env.ts).
- [x] Dodo Payments Free/Pro checkout, portal, signed/idempotent webhooks, usage limits and dunning
      (WP-22 partial). Dodo supersedes Stripe: [ADR 0023](adr/0023-cloud-billing-with-dodo-payments.md),
      [billing tests](../packages/api/src/cloud-billing-db.test.ts).
- [x] Offline licence verification, signing tool, licence admin UI/grace handling, white-label and Jira Cloud
      entitlements (WP-23 and part of WP-25): [licence features](../packages/core/src/license.ts).
- [x] Marketing/docs site (WP-26) and optional AI summaries, triage, candidate duplicate checking,
      reproduction steps and translation (WP-27 partial): [AI package](../packages/ai/src/index.ts).
- [x] Later additions: AI labels/automation, agent hand-off/repro tests, report sharing/client sign-off,
      error-triggered report prompts/observability links, screen recording/voice, custom fields/form builder,
      releases/fixed-in/regressions, reporting widgets, additional tracker adapters, interactive Slack,
      named/shared dashboards, server persistence/filter bar and account preferences.
      Evidence: [ADRs 0026–0040](adr/), [Slack tests](../packages/api/src/slack-db.test.ts),
      [dashboard tests](../apps/web/e2e/dashboards-named.e2e.ts).

## Release blockers and readiness checks

- [x] Resolve the fresh-install journey failure and obtain a fully green CI run on the pushed fix.
      At the audited upstream head, [CI run 43149389098](https://github.com/Krithik-m-codes/pinwren/actions/runs/43149389098)
      failed only `Extended E2E (journey)`: expected `/forgot-password`, stayed on `/sign-in`.
      Fixed locally on 2026-11-16: late setup response moved the centred sign-in card during a click.
      The footer now reserves both states' natural height. The deterministic delayed-response journey
      failed before the fix (8 passed / 1 failed) and passed afterwards (9/9, fresh PostgreSQL 17 database).
      All ten required checks passed on `10cb468` in [PR #81](https://github.com/Krithik-m-codes/pinwren/pull/81),
      [CI run 43916132122](https://github.com/Krithik-m-codes/pinwren/actions/runs/43916132122), including the
      fresh-install journey and both PostgreSQL isolation jobs. Later commits need their own CI evidence.
      Both PostgreSQL 16/17 isolation jobs, dashboard/widget E2E, website, API smoke, build, Docker and
      format/lint/typecheck/unit jobs passed in that run. These are upstream results, not checks of subsequent edits.
- [x] Obtain and retain an independent Cloud isolation source review:
      [2026-11-16 report](security/2026-11-16-cloud-worker-review.md). Remaining
      finding status is tracked in that report; the review does not certify production readiness.
- [x] Implement offline Cloud pg-boss provisioning and restricted service-role queue startup, with real
      send/consume/supervision/cron, grant, upgrade and recovery tests. See [ADR 0041](adr/0041-offline-cloud-job-queues.md).
      All required checks passed on `29d68b4` in [PR #83](https://github.com/Krithik-m-codes/pinwren/pull/83),
      [CI run 44020453858](https://github.com/Krithik-m-codes/pinwren/actions/runs/44020453858).
- [x] Bound maintenance transactions and per-workspace work: 500 root rows per transaction and ten
      batches per category per run, including tenant/system logs and counters. PostgreSQL regressions
      cover continuation, rollback, timeout and concurrent counter refresh; see [ADR 0042](adr/0042-bounded-maintenance.md).
      Local verification on 2026-11-17 passed 610 tests across all 25 isolation suites on PostgreSQL 17,
      1,224 workspace unit tests, full lint, formatting, typechecking and production builds.
      All required checks passed on `6312d62` in [PR #84](https://github.com/Krithik-m-codes/pinwren/pull/84),
      [CI run 44025517438](https://github.com/Krithik-m-codes/pinwren/actions/runs/44025517438).
- [x] Scope legacy Cloud startup URL encryption and page merging without widening database privileges.
      Real-role regression and review evidence: [legacy repair report](security/2026-11-17-cloud-legacy-repairs.md).
      All required checks passed on `9e44d4d` in [PR #85](https://github.com/Krithik-m-codes/pinwren/pull/85),
      [CI run 44040406671](https://github.com/Krithik-m-codes/pinwren/actions/runs/44040406671), including
      dashboard regrouping and API smoke after the selfhost scope regression fix.
- [x] Implement multi-workspace digests without shared-cursor suppression, with explicit tenant filters,
      confirmed queue acceptance and cursor preservation on partial failure. See the
      [digest evidence](security/2026-11-17-multi-workspace-digests.md). This follow-up needs its own green CI head.
      Local verification passed 625 tests across all 27 PostgreSQL 17 isolation suites, 1,224 workspace
      unit tests, full lint, formatting, typechecking and production builds.
      All findings in the [independent worker review](security/2026-11-16-cloud-worker-review.md) now have
      implementation fixes; multi-instance and operator acceptance below remain open.
- [ ] Exercise Cloud multi-instance isolation, presence/reconnect, rate limits and failure recovery.
      Existing fan-out uses PostgreSQL LISTEN/NOTIFY and counters use PostgreSQL; Redis is an optional
      unimplemented WP-28 addition, not a missing prerequisite for the existing implementation.
- [ ] Rehearse Cloud credential rotation, migrations/app rollback, legacy-data migration where applicable,
      and backup/restore of the database, files and secrets in a production-shaped environment.
- [ ] Complete live Dodo account/product/webhook setup and an end-to-end paid lifecycle before selling Cloud.
      Test-mode implementation does not verify live payments; production sign-up opening remains an operator action.
- [ ] Verify production widget CDN/version delivery and remote disable behaviour against the WP-21 gate;
      existing self-host/CDN-copy support and intake controls do not establish a deployed Cloud release gate.
- [ ] Commission the external penetration test required by the Phase 3 gate and close high findings.
- [ ] Confirm npm trusted publishers/authentication for all five public packages, actual publication of the
      intended versions, release tags, changelog, upgrade notes and Docker/CDN artifacts. See
      [release checklist](release/CHECKLIST.md); a local manifest is not publication evidence.
- [ ] Test clean amd64/arm64 installs and upgrades with seeded data from the prior release.
- [ ] Exercise real SMTP, S3 and tracker/chat accounts (including Slack and Trello/Asana/ClickUp/Notion);
      register Notion webhook subscriptions manually and record the results.
- [ ] Check screenshot fidelity/guest markers and installation detection on real sites, keyboard/screen-reader
      workflows, dashboard mouse drag/reorder, and real Chrome/Safari/Firefox screen-recording prompts and playback.
- [ ] Complete trademark/domain clearance before launch announcements.

## Missing implementation in Phases 1–4

- [ ] **WP-12:** extend `pinwren doctor` beyond HTTP health, widget delivery and origin/key checks to the
      specified storage writability, SMTP, configuration and pending-migration diagnostics. Current checks:
      [checks.ts](../packages/cli/src/checks.ts).
- [ ] **WP-22:** Business plan and its entitlements/limits, extra-seat add-ons, tax/invoice currency handling,
      read-only behaviour for over-limit projects after downgrade, and seat-overage dashboard notification.
      Free/Pro and refusal of new over-limit projects/seats already exist; see [ADR 0023](adr/0023-cloud-billing-with-dodo-payments.md).
- [ ] **WP-22:** subscription trials, replay-storage usage metering, and the specified Cloud AI quota model.
      Current [plan limits](../packages/core/src/billing.ts) meter seats/projects/reports; AI remains provider-configured.
- [ ] **WP-23:** automated Enterprise licence issuance from paid invoices with managed signing-key custody;
      the existing signing CLI is manual, not the billing-triggered issuance flow described in blueprint 07.
- [ ] **WP-24:** SAML/OIDC SSO with enforcement, domain capture and recovery; SCIM provisioning/deprovisioning.
- [ ] **WP-24:** audit log/export and custom roles/permissions.
- [ ] **WP-25:** customer custom-domain provisioning/verification/TLS and legal hold. White-label and
      Jira Cloud are already built; Jira Data Center remains unsupported.
- [ ] **Enterprise follow-ups:** SIEM streaming and the planned priority-support entitlement/service.
      These remain in [PLANNED_LICENSE_FEATURES](../packages/core/src/license.ts), not implemented entitlements.
- [ ] **Localisation:** Arabic/Hebrew and RTL layout support specified for Phase 3; current widget/dashboard
      catalogues cover eleven LTR locales ([widget locales](../packages/widget/src/i18n.ts)).
- [ ] **WP-27:** embedding storage/pgvector indexing and automatic duplicate clustering. Existing AI
      candidate duplicate verification and regression detection do not implement this clustering pipeline.
- [ ] **WP-28:** Helm chart, read-replica query routing and optional Redis integration.
- [ ] **WP-28:** automated backup scheduling and a database/files backup → wipe → restore drill in CI.
      Operator commands are already [documented](../apps/www/content/docs/self-hosting/backups.mdx).
- [ ] **WP-28:** fresh k6 capacity measurements for the current feature set and documented deployment limits.
      [Existing measurements](../loadtest/README.md) predate AI and later features.
- [ ] **WP-29:** full dashboard/widget accessibility and performance pass, dashboard Lighthouse ≥95
      evidence, and VPAT draft. Website accessibility CI exists; it does not complete this product-wide gate.
- [ ] **Secrets lifecycle:** separately managed encryption key/rotation remains deferred by
      [ADR 0014](adr/0014-background-jobs-and-wave-1-backend.md); current credential encryption derives from `PINWREN_SECRET`.

## Explicitly deferred additions

These are recorded gaps, not prerequisites for declaring the current core feedback loop implemented.

- [ ] Dashboard per-card measure/group/filter/palette/goal editor and funnel/gauge/pie/text-note widgets;
      dashboard favourites and an overview for settings remain outside the shipped named-dashboard scope.
      See [dashboard design](superpowers/specs/2026-11-02-v2-dashboards-design.md) and
      [ADR 0037](adr/0037-server-dashboards-named-shared.md).
- [ ] Custom questions in idea/question/comment composers; currently the widget form builder applies to bug reports
      ([ADR 0032](adr/0032-custom-fields-and-form-builder.md)).
- [ ] Screen recording: native Element Capture exclusion, streamed uploads for larger clips, trimming and transcripts
      ([ADR 0029](adr/0029-widget-screen-recording.md)).
- [ ] **Phase 5:** browser extension for sites without the script.
- [ ] **Phase 5:** native mobile SDKs, React Native first.
- [ ] **Phase 5:** public feedback/roadmap/voting board add-on.
- [ ] **Phase 5:** Figma/design-frame comparison.

## Maintenance rule

Update this checklist and the relevant parity row in the same change that implements or verifies an item.
Link code/tests for implementation, and dated run/review/deployment evidence for operational gates.
Do not reopen an implemented feature merely because an old plan has unchecked steps, or close a release gate
because a feature merged. Historical test counts and design choices remain historical unless explicitly superseded.
