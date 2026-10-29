# Cloud tenant isolation

Status: implementation in progress. Cloud signup is not ready for customers. The transaction context,
policy definitions and relationship constraints are implemented. Cloud provisioning, startup validation
and request/worker integration have not yet been delivered. The approved design and implementation plan are in
`docs/superpowers/specs/2026-10-29-cloud-tenant-isolation-design.md` and
`docs/superpowers/plans/2026-10-29-cloud-tenant-isolation.md`.

## Database inventory

`packages/db/src/tenant-inventory.ts` classifies all 41 exported tables. The inventory test compares
against actual Drizzle schema exports and tenant foreign keys, so a new table or relationship must be
classified. Direct ownership means a protected `org_id`; parent ownership means a child derives its
organization through all declared protected parents. Identity tables serve users across memberships;
system tables serve explicitly authorized instance operations.

The four tables without their own organization column are `diagnostics`, `feedback_translation`,
`feedback_watcher`, and `feedback_label`. The last references both feedback and labels. Self-references
for duplicate feedback, and AI duplicate candidates, must also preserve tenancy. Nullable
`email_delivery.org_id` rows belong to system email and are invisible to tenant connections.

Tenant parents and all foreign key columns are defined in `packages/db/src/schema/app.ts`; the test
checks their completeness in the inventory. Organization consistency alone does not grant project or
audience access: existing project, reporter, review-link, internal-comment and role restrictions remain
required.

## HTTP entry points

`packages/api/src/tenant-route-inventory.json` records all 173 mounted endpoint signatures, including
the ALL-method `/mcp` handler. Each record names its authorization boundary, whether its handler needs
special treatment for streaming/external work, and its required authorization test case. These names
are planned coverage identifiers, not claims that the corresponding integration test already passes.
The final acceptance step must associate them with real test evidence before Cloud can start.

| Boundary               | Organization authority                        | Database behavior required                             |
| ---------------------- | --------------------------------------------- | ------------------------------------------------------ |
| Dashboard              | Session plus current membership               | Finite organization-scoped service operations          |
| Token API and MCP      | Verified token plus current membership/scopes | Same tenant boundary as dashboard                      |
| Widget                 | Project key and Origin                        | Narrow bootstrap, then derived organization scope      |
| Guest/review           | Valid reporter or signed/review capability    | Project/reporter restrictions plus derived scope       |
| Public assets          | Existing asset capability                     | Narrow validation then scoped content access           |
| Tracker inbound        | Verified integration signature                | Narrow integration lookup then scoped mutation         |
| Unsubscribe            | Signed link                                   | Scope from verified claims                             |
| Account/auth           | Verified user identity                        | Identity repository, no implicit tenant-content bypass |
| Instance admin         | Verified instance authorization               | Explicit system repository                             |
| Health/setup/preflight | Existing public contract                      | No broad tenant content projection                     |

The route list protects mounted signatures, not just source declarations. New endpoints fail its
coverage comparison until explicitly classified. Middleware signatures are excluded, with `/mcp`
included because its ALL-method handler is a real endpoint. The auth wildcard remains an identity
entry point delegated to Better Auth.

## Background and deferred work audit

Database access exists in 64 source/script files at the initial audit. The integration tasks must
resolve each `getDb()` or raw postgres call according to the following boundaries:

| Entry point                  | Source                                                                       | Required split                                                         |
| ---------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Tenant event dispatch        | `packages/api/src/jobs/dispatch.ts`                                          | Event org/resource validation; SQL separated from queued notifications |
| AI enrichment                | `packages/api/src/jobs/ai.ts`                                                | Org/project/feedback consistency; provider call outside transaction    |
| Project export               | `packages/api/src/services/project-export.ts`                                | Finite batches scoped independently of archive/storage work            |
| Webhook delivery             | `packages/api/src/webhooks/deliver.ts`                                       | Derive org from delivery; network call outside transaction             |
| Digest                       | `packages/api/src/jobs/digest.ts`                                            | Minimal global enumeration, independent per-org content reads          |
| Retention/trash              | `packages/api/src/jobs/maintenance.ts`                                       | Global scheduling, tenant deletion units, external object cleanup      |
| Email outcomes               | `packages/api/src/email/deliveries.ts`                                       | Separate global/tenant delivery records; SMTP outside transaction      |
| Branding server reads        | `apps/web/src/lib/server/org-data.ts`                                        | Verified org scope; preserve cache keys                                |
| Realtime                     | `packages/api/src/realtime/`                                                 | Infrastructure pool separate from tenant content access                |
| SSE/export responses         | `packages/api/src/routes/realtime.ts`, `packages/api/src/export/feedback.ts` | Deferred callbacks re-enter scope without retaining a transaction      |
| Events                       | `packages/api/src/events.ts`                                                 | Publish/enqueue only after committed writes                            |
| Identity/bootstrap           | `packages/api/src/auth.ts`, account/public routes                            | Narrow named repositories and fixed projections                        |
| Startup/instance maintenance | `packages/api/src/startup.ts`, settings/setup/workspace services             | Explicit system work; Cloud security checks must block unsafe startup  |

Existing startup migrations are awaited. Startup fixes and workers currently log errors and continue;
the Cloud security check must run before them and propagate errors to prevent requests being served.
Queue payloads vary: domain/AI/export jobs carry tenant identifiers, while webhook jobs carry only a
delivery identifier and scheduled digest/retention/cleanup jobs enumerate globally. Payload presence
does not replace validating stored resource ownership.

## Evidence

Inventory assertions were observed failing with an empty table inventory, an empty route inventory,
and a missing duplicate-feedback parent. These verify that the coverage gate detects omissions.
The focused runner `node scripts/tenant-isolation.mjs` requires `PINWREN_ISOLATION_ADMIN_URL` pointing
to a disposable PostgreSQL database whose name contains `isolation`; it exits with an error if that
configuration is missing. The test administrator must be able to create fixture roles and databases.
The suite creates a distinct non-owner runtime role and cleans its fixture rows, grants, roles and
temporary databases. Never point it at customer data.

Current local PostgreSQL 16 evidence: 80 checks pass across inventory, context, real pooled connection
reuse/rollback, row policies and migration failure tests. All 27 protected tables have scoped read and
missing-context cases. All 23 direct ownership tables reject ownership changes and foreign
UPDATE/DELETE RETURNING. Valid local CRUD succeeds. Twenty-one composite tenant foreign keys are
validated. Foreign project references, duplicate links and cross-tenant label joins are rejected,
including label inconsistencies introduced by privileged maintenance. Upgrade tests prove that
inconsistent legacy page ownership and label joins abort the migration without changing rows or
leaving partial indexes. These are database boundary checks, not full application isolation evidence.

Migrations install policy definitions without enabling RLS on selfhost databases. The integration
fixture activates ENABLE/FORCE RLS locally for its restricted runtime tests. Composite foreign keys
and label integrity checks apply in all modes; inconsistent legacy data aborts the upgrade with a
named constraint, allowing the operator to investigate rather than losing or reassigning rows.
The custom label triggers and policies are intentionally installed with versioned SQL migrations;
future Cloud startup validation must check them in addition to the Drizzle schema inventory.

Operator provisioning commands, worker integration, route-wide foreign-resource tests, and rollback
instructions will be recorded with their implementation.
Until those checks pass, this document records work in progress and provides no Cloud readiness claim.
