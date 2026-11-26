# ADR 0043: Over-limit projects become read-only after a downgrade

Date: 2026-11-26. Status: accepted. Extends [ADR 0023](0023-cloud-billing-with-dodo-payments.md).

## Context

Cloud refuses a new project beyond the plan, but a workspace that downgrades (cancelled, expired, or a
failed renewal past the 14-day grace) can already hold more live projects than Free allows. The blueprint
wants those projects kept, not deleted, and not usable as if the plan still covered them.

## Decision

- The oldest `limit` live projects (by creation time, ties by id) stay writable; the rest are read-only.
  The rule is a pure function, `overLimitProjectIds` in `packages/core/src/billing.ts`, evaluated at read
  time like `effectivePlan`, so there is no downgrade job and nothing to undo when the plan is raised.
- Archiving a project, or upgrading, lifts the restriction immediately. Nothing is deleted or hidden.
- Enforced first at widget intake: a report to a read-only project is refused with
  `403 PLAN_PROJECT_READ_ONLY`. `GET /api/billing` reports `readOnlyProjects` so the dashboard can say so.
- Without billing (self-host, Enterprise, Cloud before Dodo is configured) nothing is read-only.

## Not yet covered

Dashboard writes inside a read-only project (editing items, comments, settings) are not refused yet, and
the billing screen does not show the count. Both are tracked in `docs/roadmap-status.md`.
