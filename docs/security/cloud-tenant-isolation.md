# Cloud tenant isolation

Status: implementation in progress. Cloud signup is not ready for customers. The transaction context,
policy definitions, relationship constraints, Cloud provisioning and startup validation are implemented.
Authenticated request integration includes identity repositories, finite tenant scopes, streams and mixed-I/O
handlers. Public capability integration includes key/Origin, guest/review, signed asset/unsubscribe and inbound
signature boundaries. Worker query integration remains unfinished. The approved design and implementation plan are in
`docs/superpowers/specs/2026-10-29-cloud-tenant-isolation-design.md` and
`docs/superpowers/plans/2026-10-29-cloud-tenant-isolation.md`.

## Database inventory

`packages/db/src/tenant-inventory.ts` classifies all 41 exported tables. The inventory test compares
against actual Drizzle schema exports and tenant foreign keys, so a new table or relationship must be
classified. Direct ownership means a protected `org_id`; parent ownership means a child derives its
organization through all declared protected parents. Identity tables serve users across memberships;
system tables serve explicitly authorized instance operations.

Cloud also protects organization, membership and invitation rows by their organization identifier.
Tenant reads of user profiles expose only `id`, `name`, `email` and `image`, and only for members or
contributors linked to that organization's feedback, comments, activity or watcher rows. Private account
flags remain available only through the authenticated account repository. There are 31 protected tables.

Better Auth uses a separate, stable identity pool. Its service role has identity/system grants and a
fixed eight-column token-verification projection; it cannot read tenant feedback or token display names.
Additional policies are restricted to that service role and validated during startup. Cloud sessions
disable Better Auth's cookie cache so revocation takes effect on the next request. Current membership
is checked for every session and token request. Self-host authentication retains its existing cache.

Finite authenticated tenant handlers commit only on a successful response. Handled errors roll back
their writes; jobs and broadcasts wait for the outer commit, including successful nested savepoints.
Exports open a new scope for each database batch. SSE project validation finishes before subscription,
and reconnects recheck the session and membership. Server branding/name cache misses use the organization
already verified by the viewer check. Cloud entitlement seat counts are scoped to that organization and
do not reuse the self-host process-wide resolved entitlement cache.

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
The final acceptance step must associate them with real test evidence before Cloud is ready.

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

## Public capability repositories

`packages/api/src/db/bootstrap.ts` exposes fixed capability lookups. The Cloud service role can read
five project authority columns, asset id/organization pairs, and seven integration signature columns.
It cannot read project configuration or signing keys, storage keys, tracker access tokens, or feedback
content. Provisioning installs role-specific SELECT policies and exact column grants, and startup
rejects extra readable columns. Run offline provisioning after an application upgrade adds projections.

Content is re-read through the runtime role after key/Origin or signature validation. Widget/guest
queries retain project, reporter, signed-item and public-comment restrictions. Project keys and inbound
integration state are checked again before content access; report writes recheck key/Origin after
uploads. Signed image links are checked against a live, non-trashed parent. Cross-project issue links
are ignored even when their organizations match.

Uploads and object reads run outside tenant transactions. Failed uploads create no page/report rows;
failed database writes clean up staged files. Diagnostic inserts follow their new feedback parent in a
second command within the same transaction, so parent-derived RLS sees the row and all writes remain
atomic. Concurrent retries return one record and emit one success event. Unsubscribe changes and the
remaining database work share a transaction so later failures roll back suppression state.

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

The policy/context tranche passed 80 checks on local PostgreSQL 16 across inventory, context, real pooled connection
reuse/rollback, row policies and migration failure tests. The original 27 content tables have scoped read and
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

## Provisioning and process credentials

Provisioning is currently for isolated verification while application integration is completed.
Use PostgreSQL 16+ and separately created LOGIN roles without superuser, BYPASSRLS, CREATEDB,
CREATEROLE, REPLICATION or inherited privileged memberships. In `psql` as the database administrator:

```sql
CREATE ROLE pinwren_runtime LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE pinwren_service LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
\password pinwren_runtime
\password pinwren_service
```

Set connection URLs in the indicated process environment. All URLs must name the same database
endpoint, with distinct runtime and service roles. The application must not receive the privileged
migration URL. Provisioning configures existing roles and never sets or prints their passwords.

| Process              | `DATABASE_URL`            | `PINWREN_SERVICE_DATABASE_URL` | `PINWREN_MIGRATION_DATABASE_URL` | Command                                      |
| -------------------- | ------------------------- | ------------------------------ | -------------------------------- | -------------------------------------------- |
| Offline migrations   | Privileged migration role | Unset                          | Unset                            | `pnpm --filter @pinwren/db migrate`          |
| Offline provisioning | Runtime role              | Service role                   | Privileged migration role        | `pnpm --filter @pinwren/db provision:cloud`  |
| Cloud application    | Runtime role              | Service role                   | Unset                            | Application starts with `PINWREN_MODE=cloud` |

The provisioning command locks the database change transaction, revokes PUBLIC/table/CREATE grants,
grants CONNECT and schema USAGE to the two roles, grants tenant CRUD plus the restricted user-profile
projection to runtime, and grants identity/system CRUD plus the fixed token-verification projection to
the service role. It enables and forces RLS on all protected tables, and validates
the actual roles and catalogs before committing. A failed validation rolls the changes back. Repeating
successful provisioning is supported. Existing extra permissive policies cause a failure rather than
being silently deleted.

Cloud startup validates role attributes/membership/ownership, DDL and TRUNCATE capabilities,
unreviewed callable security-definer functions, table coverage, exact policy definitions, runtime CRUD
grants, service exclusion from tenant tables, composite foreign keys, and integrity trigger/function
definitions. Malformed connection URL errors omit credentials. The Next.js startup hook awaits this
check before maintenance or workers; it never runs migrations using Cloud runtime credentials.
Standalone API requests and worker startup apply the same gate. Setting `PINWREN_SKIP_MIGRATIONS`
does not skip the Cloud guard. Selfhost retains its existing migration behavior.

The Cloud database mode is persistent: changing the application flag to selfhost does not disable
RLS or grant additional table privileges. Return to a previously compatible application version or
restore the database/configuration from a tested backup during rollback; do not automatically remove
policies to work around a startup error. Authenticated/public/worker integration and route-wide
evidence remain required before treating Cloud as usable.

CI is configured to run the isolation suite against PostgreSQL 16 and 17 using disposable administrator fixtures and
separate runtime/service roles. Local startup/provisioning cases cover idempotency, revoked PUBLIC
CONNECT access, dangerous role attributes, inherited memberships, table ownership, missing grants,
unknown tables, disabled RLS/FORCE/triggers, missing/extra policies, weakened trigger conditions,
unreviewed security definers, service access to tenant rows, and failed-provisioning rollback.
The focused runner includes real cookies and API tokens, current-membership/session revocation, MCP
delegation, account preferences/deletion, invitation rendering, finite export batches, SSE reconnects,
and post-commit jobs, broadcasts and file removal. Network/storage transport fixtures assert that no
tenant transaction remains open during external operations. Database-only cases are skipped in ordinary
selfhost unit runs and exercised by the integration runner.

### Route-wide acceptance evidence (Task 8)

Every entry of `packages/api/src/tenant-route-inventory.json` (173 routes) has one executable case, and the
inventory and the case registries are compared in both directions, so an added, renamed or reclassified
route without a case fails. Both suites run against real PostgreSQL with the restricted runtime role, in a
fixture holding two workspaces (A and B) with a project, report, comment, label, round, review link, saved view,
webhook endpoint and delivery, tracker integration, asset, notification, template, brand asset, email delivery
and API token each.

- `cloud-routes-db.test.ts` covers the 117 `tenant`, 10 `identity`, 17 `system` and 5 `public` routes.
  Signed in (cookie or API token) to workspace A, each id-bearing tenant route names workspace B's resource and must
  answer 404 or 403; routes with no id (lists, creates, singleton settings) run as A and must return nothing of B's.
  Every case also hashes all of workspace B's rows (direct tables, parent-owned tables, workspace, members,
  invitations, member accounts and preferences) before and after and requires them unchanged. System routes
  require a 403 for a workspace owner who is not an instance administrator; identity routes touch only the
  signed-in account; every session-only route answers 401 without credentials.
- `cloud-routes-public-db.test.ts` covers the 24 `capability` routes. The caller holds a valid capability for
  workspace A (project key, reporter token, page link, review link, signed claim, integration secret) and names
  workspace B's resource; the refusal, the absence of B content and B's unchanged rows are asserted. Inbound
  GitHub, GitLab, Linear and Jira webhooks sharing a repository or team key across both workspaces change only the
  workspace whose secret signed the request.
- Both registries were mutation-checked: pointing a case at workspace A's own resource makes it fail.

The one real isolation inconsistency found: `GET /api/projects/:id/integrations` answered 200 with an empty
list for another workspace's project id instead of 404 (row security hid the rows, so no data leaked). It now
verifies the project and answers 404, like every sibling route. The Better Auth organization endpoints clear the
caller's own active workspace after refusing a foreign workspace id; this is vendor behavior with no cross-tenant
effect and is restored by the test.

Documented exceptions (not generic foreign-id cases): public brand-asset ids and signed email-image tokens are
capabilities that deliberately serve their owner's image to anyone holding them; their cases assert malformed,
unknown and expired ids answer 404 and that the streaming read holds no transaction (`cloud-public-db.test.ts`).
`/api/v1/*` and `/mcp` skip the unauthenticated 401 sweep because the failed-token rate limit is shared per
address; token authentication, scope and membership are covered in `cloud-api-db.test.ts`.

Verified on PostgreSQL 16.15: `node scripts/tenant-isolation.mjs` passes 14 files / 368 tests (151 + 25 new).

## Remaining WP-21 work (explicitly incomplete)

- Cloud sign-up is **not enabled** and must not be until the items below are done; `PINWREN_DISABLE_SIGNUP`
  semantics and first-account promotion remain closed in Cloud mode.
- Branch review: one independent whole-branch review against the spec has not yet been obtained.
- Required protected-branch CI (PostgreSQL 16 and 17 matrix, existing builds and browser journeys) has not been
  observed green for this head; local PostgreSQL 17 and the dashboard Playwright journeys were not run.
- Redis-backed realtime/presence and rate-limit isolation across instances, and multi-instance behavior.
- Operator procedures not yet exercised against a production-shaped environment: credential rotation,
  migration/rollback rehearsal, backup/restore of a Cloud database.
- Billing, usage limits, audit foundation, custom roles/SSO and legacy-data migration (WP-22/24/25) are separate.
