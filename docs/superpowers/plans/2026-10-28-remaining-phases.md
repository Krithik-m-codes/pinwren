# Remaining phases execution plan

**Goal:** Progress unfinished roadmap work in dependency order, starting with the Community collaboration gap.

**Spec:** `docs/superpowers/specs/2026-10-28-guest-portal.md`, blueprint 06 section 7 and WP-20.

**Execution:** The guest portal is being implemented on `feat/phase2-guest-portal`, followed by security
review, integration checks and protected-branch delivery. The checkout retains installed dependencies
without duplicating several gigabytes on a nearly full drive.

## Current tranche: guest portal

1. Define the shared Zod request/response and credential schemas in core. Test malformed, excessive,
   foreign and expired capabilities rather than trusting browser-supplied ids.
2. Implement the public guest router, minimal query projections, public replies, rate limits and
   entitled branding. Add no database migration: existing reporter hashes and signed tokens suffice.
3. Implement the standalone guest page with RTK Query, client credential handling, list/thread/reply,
   responsive states and existing design components. No component-level fetches.
4. Add the widget's private portal entry and reporter-email portal links. Keep credentials in the
   fragment and keep widget functionality unchanged when storage is unavailable.
5. Add real-DB smoke and browser journeys, including another reporter and an internal note. Verify
   formatting, lint, types, unit tests, widget budgets, builds and browser checks sequentially where
   outputs overlap. Obtain independent code/security/UI review before delivery.
6. Update parity and public docs only for behaviour verified by tests. Push via a feature branch and
   required checks; main is protected. Preserve release PR closure preference.

**Status:** The shared contract, API, email-link integration, widget entry, localized portal, browser
credential handling and API smoke cases are implemented. Core/API/web focused tests, all API tests,
all widget tests, widget typecheck/build/budget, the widget portal browser journey and formatting pass.
The dashboard browser journey and real-Postgres smoke still need the database-backed CI environment;
Docker Desktop is unavailable in this checkout. Repo lint is currently being rerun after fixing the
issues it found. Full code review and protected-branch CI are still outstanding.

## Following tranches

- Finish remaining launcher theming and organisation favicon parity.
- WP-21: tenant isolation and cross-tenant tests before exposing Cloud sign-up. **Status:** Tasks 1-8 coverage is implemented on `feat/wp21-tenant-isolation` (PR #27, draft): database policies, request/public/worker scoping and route-wide real-PostgreSQL acceptance for all 173 inventory routes (368 isolation tests passing locally). **Still incomplete:** independent whole-branch review, required CI green on PostgreSQL 16/17, Redis/multi-instance isolation, operator rehearsal, and enabling Cloud sign-up (kept disabled). See `docs/security/cloud-tenant-isolation.md`.
- WP-22: billing, usage limits and dunning, using test-mode fixtures until live-account setup exists.
- WP-24/25: audit foundation, custom roles, SSO/SCIM, custom domains and legal hold.
- WP-27/28/29: remaining duplicate clustering, backup/restore automation, Helm/read replicas, capacity
  and accessibility evidence. Phase 5 reach features remain demand-driven per the roadmap.

Ruling: existing blueprint requirements and the user's explicit direction authorize implementation;
do not ask them to approve the same scope again. Account credentials, paid services and irreversible
production changes remain separate from local implementation and test-mode verification.
