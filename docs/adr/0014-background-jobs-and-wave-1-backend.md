# ADR 0014 — Background jobs and wave-1 backend choices

**Status:** accepted

## Context

Wave 1 adds email, notifications, webhooks, retention and API tokens. The blueprint names pg-boss for jobs
(02 §2, ADR 0003) but leaves the process model, retry mechanics and a few security details open. Pinwren runs as a
Next.js standalone server under `node:cluster` (ADR 0013), possibly with several replicas.

## Decision

1. **pg-boss in every server process.** `startJobs()` runs from the Next.js Node instrumentation hook (not awaited,
   so a queue problem never blocks startup). Each cluster worker / replica has its own `PgBoss` (schema `pgboss`,
   pool `PINWREN_JOBS_POOL_MAX`, default 3); `SKIP LOCKED` gives each job to one process and the cron schedules
   (`retention.apply` 03:15, `assets.cleanup` 03:45 UTC) fire once. `PINWREN_ROLE=web` only enqueues;
   `worker`/`all` also process.
2. **Queues:** `events.dispatch` (fan-out of one domain event to in-app notifications, emails and webhook
   deliveries), `notify.email`, `webhook.deliver`, `retention.apply`, `assets.cleanup`.
3. **Enqueue after the write, fire-and-forget.** The widget insert stays one SQL statement (ADR 0013); the event
   is queued after it and never awaited by the response. A crash in that gap loses the notification, never the
   report — the accepted trade-off against an outbox table.
4. **Webhook retries are ours, not pg-boss's.** Each attempt is a `webhook_delivery` row; a failed attempt
   writes the next row and schedules it with `sendAfter` at 1 m, 5 m, 30 m, 2 h, 6 h, 12 h (blueprint 04 §5), so
   the log shows every attempt with its response. 3 days of continuous failure disables the endpoint. Logs are
   pruned after 30 days by `retention.apply`. Private/loopback targets are allowed (self-hosters post to internal
   tools); revisit for Cloud.
5. **Secrets at rest** (SMTP password, webhook signing secrets): AES-256-GCM, key = HKDF-SHA256 of
   `PINWREN_SECRET`. The blueprint's separate `PINWREN_ENCRYPTION_KEY` with rotation is deferred; rotating
   `PINWREN_SECRET` today means re-entering those secrets.
6. **API tokens:** `ann_` + 32 random bytes, scrypt-hashed (N=2^14, r=8, p=1; Node built-in, no native argon2
   dependency). The first 12 characters are stored as a unique lookup prefix. Verified secrets are remembered in
   memory for 5 min by SHA-256 so busy integrations don't pay scrypt per request; the row is re-read every time, so
   revocation is immediate.
7. **Instance admin** (SMTP settings): emails in `PINWREN_ADMIN_EMAILS`, or — unset — the first user who signed
   up. Org owners are not instance admins: sign-up is open by default.
8. **Invitations** are accepted without prior email verification (`requireEmailVerificationOnInvitation: false`):
   there is no verification flow yet and SMTP is optional. The invitation id (random UUID) only reaches the
   invitee's inbox and the org's admins, and Better Auth still requires the signed-in email to match.
9. **Project settings** `retentionDays`, `notifyReporter` and `widgetRateLimitPerMin` are project columns, not keys
   in `capture_config`: the server enforces them and the widget never needs them.
10. **Trash:** soft-deleted feedback is purged with its files after 30 days (`assets.cleanup`). Retention and
    purges delete rows first, then files — a crash leaves an orphan file, never a dangling row.

## Consequences

- Still one required service (Postgres). pg-boss adds its own schema and ~3 connections per process: size
  `max_connections` ≥ workers × (`DATABASE_POOL_MAX` + `PINWREN_JOBS_POOL_MAX`) + headroom.
- Notifications are at-most-once on crash; webhooks are at-least-once (receivers dedupe on `Pinwren-Delivery`).
