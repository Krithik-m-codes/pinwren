# Remaining phases execution plan — reconciled 2026-11-16

The original guest-portal execution tranche is implemented and merged. Its old branch/CI narrative
has been retired to avoid reopening finished work. The current source of truth is
[Roadmap status and remaining work](../../roadmap-status.md), reconciled against upstream `0762e93`.

## Completed tranches

- [x] Guest contract/API, scoped portal, widget/private email entry and automated coverage (PR #19).
- [x] Launcher light/dark/hover controls and organisation favicon branding (PR #21).
- [x] WP-21 tenant isolation foundation, role provisioning and route-wide cross-tenant tests (PR #27).
- [x] WP-22 Free/Pro Dodo Payments test-mode billing, usage limits and dunning (PR #28).
- [x] Fly.io/Supabase deployment configuration and runbooks (PR #29).
- [x] Cloud sign-up/onboarding, consent, verification and abuse limits; closed by default (PR #31).
- [x] Later v2 additions: server/named/shared dashboards, interactive Slack, custom fields, releases and
      regressions, tracker adapters, recording/voice, AI labels/automation, agent hand-off, sharing/sign-off.

## Remaining tranches

- [ ] Release readiness: fix the fresh-install journey, obtain a fully green release run, verify artifacts,
      real accounts/sites and clean installs/upgrades.
- [ ] Cloud gate: independent review, remaining worker audit, multi-instance/operational rehearsals,
      live billing setup and deployment evidence before opening production sign-up.
- [ ] WP-22: Business/add-ons, currency/tax handling and downgrade behaviour gaps.
- [ ] WP-24/25: audit log/export, custom roles, SSO/SCIM, custom domains, legal hold and planned SIEM/support.
- [ ] WP-27/28/29: pgvector clustering, Helm/read replicas/optional Redis, backup automation/restore CI,
      current capacity and accessibility/performance/VPAT evidence.
- [ ] Phase 5 and optional UI/capture additions remain deferred; see the full checklist for each item.

Implementation does not imply a completed release gate. PostgreSQL 16/17 isolation and dashboard
browser CI passed at the audited upstream head; the fresh-install journey failed. See the current
checklist for evidence and avoid treating dated plan checkboxes as the current build state.
