# ADR 0042: Bounded maintenance transactions

Date: 2026-11-17. Status: accepted.

## Context

Retention and trash selected 500 feedback rows at a time but kept one transaction open until an
organisation's entire backlog was gone. Delivery, notification, automation and rate-counter cleanup
also used unbounded deletes. A large workspace could monopolise a run and keep locks and deferred
asset effects alive for its whole backlog.

## Decision

- Select at most 500 root records per batch, with deterministic ordering. Commit each batch in its own
  transaction. Allow at most ten batches per category per workspace per invocation; system email and
  each rate-counter table have the same independent limit. Scheduled runs process remaining backlog.
- Apply these bounds to feedback retention, trash, webhook/email delivery logs, old read notifications,
  automation logs, instance email logs and expired application/authentication counters. Instance email
  cleanup uses the service repository with an explicit `org_id IS NULL` predicate.
- Retain explicit tenant predicates as well as Cloud RLS. A global maintenance invocation inside an
  existing tenant scope is rejected so nested scope reuse cannot defeat independent commits.
- Set transaction-local SQL statement and lock timeouts to 15 seconds and 2 seconds. Errors roll back
  the current batch and propagate to the job runner; previously committed batches survive. No privileged
  credentials, schema changes or relaxed Cloud policies are needed.
- Recheck counter expiry in the outer DELETE after any lock wait. A concurrent request that refreshes
  a selected counter must retain its active limit. Read-notification expiry is likewise rechecked.
- Preserve feedback asset deletion as an after-commit effect outside the tenant transaction. Rollback
  discards that effect. Existing storage failures are logged; this change adds no durable asset outbox.

The batch limit counts root records, not cascaded children. SQL timeouts bound individual statements,
not an absolute transaction or job duration. Organisation enumeration still spans all workspaces. A
failing workspace can abort the current invocation and rely on the existing job retry; this does not
implement a maintenance scheduler, global wall-clock budget or production throughput guarantee.

## Verification

`packages/api/src/cloud-maintenance-db.test.ts` uses PostgreSQL with provisioned runtime/service
roles and real transactions. A test-only invoker trigger records transaction IDs, row counts and SQL
settings. It covers per-workspace/category caps, later-run continuation, independent commits, fresh
and unread data, instance logs, asset commit/rollback effects, foreign report refusal, a blocked later
batch preserving earlier progress, timeout reset, concurrent counter refresh and tenant selection with
RLS disabled. Only storage removal is mocked.

The first four cases failed before implementation: the old sweep deleted all 5,128 reports, trash's
1,001 deletes shared one transaction, nested invocation reused a tenant scope, and Cloud instance
email was never pruned. Independent review found the concurrent counter-refresh issue; its
two-connection regression reproduced deletion of an active counter before the expiry recheck fix.

Production backlog/capacity measurements, multi-instance recovery and operator rehearsals remain
open in [the roadmap checklist](../roadmap-status.md).
