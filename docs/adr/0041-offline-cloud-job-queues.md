# ADR 0041 — Offline Cloud job queues and restricted service access

**Status:** accepted. Extends Cloud provisioning and the Postgres-backed job architecture in ADR 0014.

## Problem

The Cloud tenant runtime correctly cannot create schemas or read identity/system tables. pg-boss
startup previously used those credentials to install/migrate `pgboss`, making a provisioned Cloud
instance unable to start its jobs. Queue payloads can contain rendered mail and data from different
workspaces, so granting tenant connections access to that global infrastructure would weaken isolation.

## Decision

- `scripts/cloud-migrate.sh` has three offline stages: app migrations, Cloud table/RLS provisioning,
  and queue provisioning. The third invokes the existing database package's `tsx` runner with the
  API's queue CLI. It introduces no dependency or additional deployed credential.
- The migration owner installs/migrates pg-boss and creates all twelve Pinwren queues plus its cron
  queue. Queue names, retries and expiry options share one definition with self-host startup.
  Repeated provisioning preserves queued jobs. Existing partitioned/custom queues are unsupported
  and require operator inspection; this installation uses `job_common` and standard queue policy.
- The Cloud app uses `PINWREN_SERVICE_DATABASE_URL` only for global queue infrastructure, with
  usage/execution and ordinary queue DML grants. The tenant role has no queue-payload access. Both
  application roles retain the existing no-owner/no-CREATE checks.
- Schema migration, automatic reindexing, persisted queue-stat partitions and persisted warning
  partitions are disabled in Cloud runtime. Ordinary job supervision, retries, dependency resolution,
  cron and application worker registrations remain enabled. Queue metrics/warnings that need owner
  DDL are an operator responsibility; do not grant DDL to restore them.
- Application roles cannot write pg-boss's BAM migration-command table or the version marker.
  The service can update only operational `cron_on`, `flow_on` and `monitor_backoff_on` stamps.
  Effective privilege checks include inherited and `SET ROLE`-accessible memberships, column ACLs, table/function ownership,
  TRUNCATE and trigger privileges. Unsafe inherited grants fail provisioning/startup rather than
  being silently accepted after direct grants were revoked.
- Before privileged pg-boss startup, validate queue metadata and install an invoker trigger rejecting
  unexpected names, partitions, table names or policies. Validate after installing the trigger to
  close the concurrent-update window. Owner migration SQL must not trust application-writable
  metadata to select arbitrary tables. The installer does not run cron consumers as the owner.
- Wait for pending asynchronous index builds to complete, and reject failed or timed-out BAM work
  before reporting successful provisioning. The ten-minute bound prevents an offline command from
  claiming success while Cloud's migration-disabled runtime has nobody to finish an upgrade.
- Failed runtime startup closes partially opened queue resources and names the offline repair command.
  Migration credentials never enter the application environment.

## Verification and limits

`packages/api/src/cloud-queue-db.test.ts` uses real roles and PostgreSQL. It covers send/fetch/complete,
cron claims, supervision and dependency resolution, effective grants and migration-command denial,
preserving pending jobs, the offline CLI, invalid endpoints/shared roles, metadata poisoning,
inherited and non-inherited payload grants, asynchronous index completion and recovery after missing queue definitions.
The original runtime startup failed with `permission denied for schema pgboss` before the fix.

The independent review identified operational timestamp grants, asynchronous migration completion,
effective ACL checks and metadata protection; those findings are addressed here. No arbitrary-code
execution exploit was demonstrated or claimed. This change does not establish production multi-instance
capacity or close the maintenance, legacy repair, digest or external pentest roadmap items.

Follow-up verification on 2026-11-17: all ten queue cases passed. The non-inherited membership case
first reproduced a bypass (ambient read denied, SET ROLE read allowed, provisioning incorrectly
succeeded); inspecting every member role's privileges closed it.
