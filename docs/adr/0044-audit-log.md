# ADR 0044: Audit log

Date: 2026-11-27. Status: accepted. Extends [ADR 0019](0019-enterprise-licence-files-and-white-label.md) and
[ADR 0023](0023-cloud-billing-with-dodo-payments.md). Feature F-092, first slice of WP-24 (SSO, SCIM and
custom roles are separate).

## Context

Enterprise and Business customers need to answer "who changed what, and when" for access and configuration.
The blueprint lists the audit log as an Enterprise licence feature (`audit_log`) and a Business plan feature
with 30 days of history in Cloud.

## Decision

- **Table.** `audit_log` (migration 0019): `org_id`, `actor_id` (set null if the user is deleted),
  `actor_label` (name and email snapshot taken when the entry is written), `actor_ip`, `action`
  (`area.verb`, listed in `AUDIT_ACTIONS` in `packages/core`), `target_type`, `target_id`, `data`, `created_at`.
  Tenant policy and inventory like every direct-owned table; indexes on `(org_id, created_at desc)` and
  `(org_id, action)`.
- **Append-only.** In Cloud the runtime role is provisioned with SELECT, INSERT and DELETE on `audit_log`,
  never UPDATE (`appendOnly` in the tenant inventory; the Cloud catalogue check fails startup if it is not
  so). DELETE exists only for the retention job: a database-level "no delete" would need a second role for
  maintenance, which the single-runtime-role model deliberately avoids. The API has no route that updates or
  deletes entries. On self-host the app owns the table; the guarantee there is the API surface.
- **Recording.** `recordAudit` / `audit(c, action, target, data)` in `packages/api/src/services/audit.ts` run
  in the caller's organisation transaction, so a request that fails or is refused leaves no entry. It never
  throws into the caller: the insert runs in a savepoint and a failure is only logged. `data` passes through
  `redactAuditData` (keys that look like secrets, tokens, passwords, cookies, signatures or hashes are replaced,
  strings capped, depth capped); callers also only pass field names and ids, never secret values.
- **Entitlement.** Entries are recorded, listed and exported only while `hasFeature("audit_log")`:
  Cloud Business, or a licence naming `audit_log`. Not recording while unentitled means a downgrade does not
  retroactively expose history that accumulated under a previous plan beyond what the retention rule keeps,
  and an upgrade does not invent history. History written while entitled is kept (not deleted on downgrade) but
  unreadable until the feature returns. Not entitled: `403 LICENSE_REQUIRED`, like Jira.
- **Retention.** Cloud: the daily retention job deletes entries older than `AUDIT_CLOUD_RETENTION_DAYS` (30)
  for every workspace, in bounded batches. Self-host (Enterprise): everything is kept.
- **Access.** Workspace Admins only (`settings.manage`): `GET /api/audit` (filters actor, action or area
  prefix, target type, from, to; cursor paging) and `GET /api/audit/export?format=csv|jsonl` (at most 10,000
  rows, newest first; CSV neutralises formula characters and is RFC 4180 escaped). Exporting is itself recorded.
- **Not a security-event feed.** Sign-ins, failed logins and report-level activity are not recorded here; the
  SIEM stream and the sign-in audit belong to later Enterprise work.

## Consequences

- A new admin action adds one `audit(...)` line and, if it is a new action, an entry in `AUDIT_ACTIONS` and
  the dashboard labels (all ten catalogues).
- Actor IP honours `PINWREN_TRUST_PROXY` like rate limiting; it is stored in full (not privacy-truncated) because
  the audit log is an Admin-only security record.
