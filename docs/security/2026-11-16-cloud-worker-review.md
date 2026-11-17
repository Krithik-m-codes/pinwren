# Independent Cloud isolation review — 2026-11-16

An independent agent reviewed implementation `0762e93` at documentation head `d94e338`, reading
the approved Cloud isolation design, RLS/provisioning/startup checks, authentication and public
capabilities, transaction effects, dispatch/notification/AI/maintenance/digest workers and realtime.
No confirmed cross-tenant disclosure was found in the inspected paths. This is a bounded source
review, not an external penetration test or production certification. The reviewer ran no tests;
the implementer's regression results below are separate evidence.

## Findings and resolution

| Priority  | Finding                                                                                                                                                                                                   | Status                                                                                                                                                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1        | `jobs/boss.ts` starts pg-boss with runtime credentials and default schema migration/queue creation, while Cloud correctly forbids CREATE privileges. Fresh provisioned Cloud cannot initialise its queue. | **Fixed in the queue follow-up:** offline owner provisioning, constrained service-role queue access, no tenant queue access or runtime DDL, effective ACL/topology checks and async-index completion. Real-role queue tests; see ADR 0041. |
| P1        | `jobs/notify.ts` joins identity-only `user_preference` through the tenant runtime connection; normal Cloud dispatch fails permission checks.                                                              | **Fixed:** scoped recipient query plus fixed membership-checked `db/identity.ts` preference projection. Existing restrictive grants remain.                                                                                                |
| P1        | Bell broadcasts and queue jobs escape before `dispatchEvent` commits; a later failure can roll back records after email/issue/Slack/AI work has escaped.                                                  | **Fixed:** bell publication uses `afterOrgCommit`; ordinary and delayed enqueue helpers defer when an organisation transaction is active, covering all dispatch queue call sites. Outside a transaction their awaited behaviour remains.   |
| P2        | Disabled/privacy/provider-error AI paths write status before validating the feedback's project. A forged same-org mixed-project job can overwrite another project's enrichment state.                     | **Fixed:** validate org/project/feedback before any skipped/failed write or provider lookup.                                                                                                                                               |
| Follow-up | Retention/trash loops hold one transaction across all batches; `BATCH=500` limits SQL result size, not transaction duration.                                                                              | **Fixed in the maintenance follow-up:** independent 500-root-row transactions, ten batches/category/workspace/run, local statement/lock timeouts and bounded tenant/system logs. See [ADR 0042](../adr/0042-bounded-maintenance.md).       |
| Follow-up | Legacy startup webhook encryption/page merging uses bare `getDb()` and fails closed in Cloud, leaving legacy repairs undone.                                                                              | **Open:** scoped/offline upgrade repair, without widening privileges.                                                                                                                                                                      |
| Follow-up | Digest uses global `user_preference.lastDigestAt` after each workspace; a user's first workspace can suppress that user's next workspace digest.                                                          | **Open:** org-specific cursors or snapshot due recipients before updating shared state, with multi-membership regression coverage.                                                                                                         |

The positive controls inspected include fail-closed unscoped database access, transaction-local
organisation settings and nested savepoints, service/runtime separation and constrained bootstrap
projections, Cloud membership rechecks and disabled auth-cookie caching, participant-limited profile
reads, deferred asset deletion, org/project/user realtime filters and shared PostgreSQL rate counters.

## Reproducing and checking the fixes

`packages/api/src/cloud-workers-db.test.ts` uses a real PostgreSQL database, provisioned runtime and
service roles, real tenant transactions and AI/notification code. Only outbound bus/queue sinks are
replaced so the tests can observe attempted side effects without sending mail or tracker work.

All five new cases failed before the fixes: permission-denied preference reads, pre-commit broadcasts
and jobs, and another project's AI status changed to `skipped`. After the fixes, these five cases and
the five existing AI unit cases passed locally. The successful notification case asserts no effect
inside the transaction and no tenant scope in post-commit sinks; the failed case asserts rollback
left neither a notification record nor an outbound effect. The test runner now also includes the
previously omitted Cloud billing suite.

On Windows this checkout's multi-file Vitest collection stalled; targeted suites passed with
`--pool=threads --maxWorkers=1`, and the broader isolation suites are run sequentially with the same
flags. The completed local run passed **591 tests across all 23 isolation-runner suites** on PostgreSQL 17.
Workspace unit tests passed **1,224 tests**; their database-dependent cases are intentionally skipped
without fixture URLs and are exercised separately by the isolation run. The web unit suite also has
one existing skipped test. Typechecking, production builds and widget size budgets passed.
The full fresh-install journey passed **9/9** after its delayed-response regression failed before the fix.

CI remains the release gate. Real pg-boss startup is now covered by the queue follow-up (ADR 0041); remaining worker properties and production
multi-instance/operator rehearsals remain open in [the roadmap checklist](../roadmap-status.md).

A second independent source review of the fixes found no actionable issues in the changed code.

## Maintenance follow-up — 2026-11-17

An independent source review of the bounded maintenance change found a counter-refresh race: the
candidate query could see an expired counter while a request refreshed it under a row lock; deleting
by candidate ID alone then removed the active counter. A two-connection regression reproduced that
failure. The outer deletes now recheck expiry after waiting for the lock. Both application and auth
counters survive concurrent refreshes.

All nine new maintenance cases passed locally on PostgreSQL 17. They record actual transaction IDs
and settings, exercise backlog caps and later runs, rollback-safe asset effects, a later-batch lock
timeout preserving earlier committed progress, timeout reset, and tenant selection with RLS disabled.
The review's test gaps were addressed with these cases; the reviewer did not run tests. See
[ADR 0042](../adr/0042-bounded-maintenance.md) for the limits and remaining operational work.
