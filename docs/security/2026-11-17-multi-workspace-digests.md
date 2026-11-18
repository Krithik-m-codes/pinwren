# Multi-workspace digest remediation — 2026-11-17

The digest cursor is account-wide (`user_preference.last_digest_at`). The worker previously queried
and processed each workspace in turn, updating that cursor immediately. A person's first workspace
could therefore suppress their next workspace's digest. In selfhost mode, missing explicit workspace
predicates also allowed notifications and project mutes from different workspaces to mix.

## Implementation

- Snapshot due recipients across all workspaces before advancing any account cursor. Before reading a
  workspace's content, recheck current membership, digest settings and email opt-outs through the fixed
  identity repository. Content reads/rendering remain inside runtime `withOrg` scopes; no role or policy
  changes are required.
- Query unread notifications in `(last cursor, run cutoff]`, subject to the existing seven-day lookback,
  row and summary limits. Explicit organisation predicates cover notifications, feedback joins and
  project mute preferences, including when selfhost has no RLS.
- Advance a user's cursor only after all their due workspaces have completed, including empty/muted
  workspaces. A failure preserves the old cursor. Cursor updates use PostgreSQL `greatest` so an older
  overlapping run cannot move the account's progress backwards.
- `enqueueRequired` confirms that pg-boss returned a persisted job ID and propagates errors or a null
  result. It rejects use inside tenant transactions. The digest invokes it after content preparation
  commits. Existing best-effort enqueue helpers retain their request/ingest behavior.

The shared cursor and retry model remain intentionally unchanged: successful workspace emails may
be queued again if another workspace fails or the process stops before cursor persistence. Queue
acceptance is not SMTP delivery. This is at-least-once behavior, not exactly-once delivery. A failure
while collecting/rechecking recipients aborts before final cursor updates; retries may repeat queued
work. Snapshot storage grows with due memberships. Production capacity and multi-instance failure
rehearsals remain in [the roadmap checklist](../roadmap-status.md).

## Evidence

All four initial PostgreSQL regressions failed before the fixes: second-workspace suppression,
incorrect progress after partial failure, cross-workspace content/mutes without RLS, and skipped
notifications after the run cutoff. The partial-failure case also caught the existing enqueue helper
swallowing queue errors; the strict background enqueue path fixes that without changing ingest.

All eight new cases passed with real provisioned runtime/service roles. They cover those four
properties, membership removal after snapshot collection, monotonic cursors, nested global-work
refusal and a queue response without a persisted job ID. Rendering and the queue transport are
replaced to inspect messages/scopes without sending mail; database queries, tenant transactions and
the enqueue helper are real. Existing worker/email coverage also passed (29 targeted checks total).

Independent source review found no blocking correctness, compatibility or privilege issues. It ran
no tests. Optional coverage for full overlapping worker runs and late account opt-outs remains a
possible extension; the membership recheck and database cursor tests cover the implemented boundaries.
This source review does not establish production operational readiness.

The complete local PostgreSQL 17 isolation run passed **625 tests across all 27 runner suites**.
Workspace unit tests passed **1,224 cases**; database-dependent cases run separately from that count.
Full lint, formatting, workspace typechecking, production builds and changed-document link checks
passed. All required checks passed on `f5c8e31` in
[CI run 44106834458](https://github.com/Krithik-m-codes/pinwren/actions/runs/44106834458), including
both PostgreSQL isolation versions. Later follow-ups require their own green head.
