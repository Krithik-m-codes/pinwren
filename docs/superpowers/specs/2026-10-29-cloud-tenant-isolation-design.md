# Cloud tenant isolation foundation

Date: 2026-10-29

Status: written specification approved by the user on 2026-10-29.

## Intent and scope

The user authorized completing unfinished roadmap work, fixing regressions, pushing changes, and
closing PRs through GitHub CLI. The approved WP-21 approach is transaction-scoped tenant identity,
PostgreSQL row-level security (RLS), explicit handling of jobs and public routes, and cross-tenant
tests. The intended outcome is a database boundary that still rejects a foreign organization's
rows when application code accidentally omits its organization filter.

This specification covers WP-21's isolation foundation. Cloud signup, versioned CDN delivery,
widget version kill switches, organization rate limits, and optional Redis adapters remain WP-21
follow-on deliverables. Completing this foundation does not complete WP-21 or certify Cloud ready
for customers. Billing and enterprise features retain their roadmap sequencing.

## Existing system

`packages/db/src/index.ts` exposes one global Drizzle database backed by postgres-js. Tenant
services call `getDb()` and usually filter `orgId` explicitly. `requireSession` validates the active
organization's membership, but establishes no database tenant scope. Token authentication has a
separate middleware. Public widget, inbound integrations, guest capabilities, account management,
server-rendered branding, and pg-boss jobs also access the database.

Most application tables have `org_id`; diagnostics, translations, watchers, and feedback-label
links derive tenancy through parents. Authentication and identity tables serve users who may
belong to multiple organizations. Global configuration, rate counters, licensing, and queue tables
are not all tenant-owned. A schema inventory must classify every table before policy activation.

## Deployment and database roles

The same build supports `PINWREN_MODE=selfhost|cloud`, defaulting to `selfhost`. Postgres remains
the only required service; this stage adds no Redis or paid service dependency.

Cloud uses separate migration/provisioning and runtime credentials. The runtime role must neither
own protected tables nor have superuser, BYPASSRLS, policy-altering, role-switching, or privileged
role membership capabilities. Migration credentials must not be available to request handlers.
System operations use a separately configured, narrowly granted service connection, never an
arbitrary boolean or tenant-supplied session setting that disables RLS on the runtime connection.

Schema migrations install the policy definitions and required relationship constraints. A dedicated
Cloud provisioning command enables and forces RLS atomically on the complete protected inventory,
and validates grants. It must not change the security state according to an individual request's
mode. Self-host databases retain their existing deployment behavior until explicitly provisioned
for Cloud. A Cloud-provisioned database cannot be silently opened by changing the application mode.

Cloud process startup verifies role capabilities, expected policy definitions, ENABLE/FORCE flags,
and table inventory coverage. Missing or incompatible setup fails startup with an actionable error.
Every newly added tenant table must acquire a policy and inventory entry before Cloud starts.

## Tenant transaction contract

Expose `withOrg(orgId, callback)` from the database package. It opens a transaction, installs the
organization identifier with a parameterized transaction-local PostgreSQL setting, and runs the
callback with a scoped Drizzle database. AsyncLocalStorage makes `getDb()` return the current
transaction inside that callback so existing service calls inherit its boundary.

The identifier must be a nonempty validated internal organization identifier, never an unverified
header, request body, or route parameter. Policies compare it to row tenancy; absent context denies
tenant reads and writes. Values must be parameterized rather than interpolated into SQL text.

Nested scopes for the same organization reuse the active transaction. A nested scope for another
organization throws before executing SQL. Concurrent requests have independent context. Exceptions
roll back the transaction, and connection reuse cannot retain tenant identity. A caller must not
retain the transaction object or start detached work outside the awaited callback.

Cloud tenant services cannot fall back to an unrestricted connection when scope is missing.
Identity/bootstrap and system repositories use separately named database entry points whose
call sites are inventoried and reviewed. `getDb()` is not a silent general-purpose system bypass.

## Policies and relationships

Policies apply to SELECT, INSERT, UPDATE, and DELETE. Both USING and WITH CHECK enforce tenant
ownership. Tenant tables with `org_id` compare against the transaction organization. Child tables
without that column use a protected parent relationship, including both sides of join tables.
Policy expressions must avoid recursive policy dependencies.

An organization-owned row cannot reference another organization's project, feedback, round,
webhook endpoint, integration, label, or other tenant parent. Use composite foreign keys and unique
parent keys where available; otherwise enforce the invariant with an explicit checked relationship.
RLS alone does not establish cross-table tenancy consistency. Existing inconsistent rows cause an
actionable migration failure; migration must not silently reassign or delete them.

Nullable organization ownership, especially global email deliveries, requires an explicit system
classification. Tenant connections must never gain global rows through a null ownership exception.
Do not add broad permissive policies to accommodate system maintenance.

Identity tables are classified separately: Better Auth legitimately lists a user's memberships
across organizations. Authentication repositories must project only the identity/bootstrap data
required for authentication and membership validation. Their access does not confer unrestricted
access to tenant content. Account deletion and organization deletion require an explicit system
operation with authorization checked before execution.

## Entry points

Dashboard requests establish scope after session and current membership validation. Token requests
establish scope after token validation and current membership/scope checks. MCP inherits the token
API boundary. Server-rendered organization data explicitly enters the verified session organization.
Existing application organization predicates remain as defense in depth.

Public entry points first validate their existing capability: widget key and Origin, reporter or
review token, signed unsubscribe link, webhook signature, or public asset capability. Bootstrap
lookups use narrow repositories that expose only enough data to validate and derive the organization.
Subsequent tenant content access runs in that organization scope. A caller cannot select an
organization independently of the verified capability. Preserve public/internal comment filtering,
project restrictions, expiry, revocation, and asset access rules.

Tenant jobs validate their organization identifier and run each unit of database work in scope.
Global schedulers use an explicit system repository to enumerate work and dispatch independent
tenant units. A job carrying foreign feedback or project identifiers must not read or mutate them.
Queue bookkeeping and LISTEN/NOTIFY infrastructure remain separate from tenant content queries.

Do not hold a transaction or pooled connection for the lifetime of an SSE subscription, response
stream, remote API request, SMTP send, or object upload. Scope finite database operations explicitly.
Deferred response producers re-enter their verified organization for each database batch. Queue or
external side effects occur after the relevant database transaction commits; failures must not emit
success events for rolled-back writes. Audit existing side-effect sequencing before selecting which
handlers can safely use a whole-handler transaction.

## Error and compatibility behavior

Foreign resource reads and mutations return the established 404 or 403 response without leaking
whether the resource exists. Cross-tenant inserts and foreign references fail without partial writes.
Internal configuration errors fail closed and log actionable diagnostics without credentials or
capability tokens. Policy exceptions must not become generic success responses.

Preserve current self-host signup restrictions, authentication, API shapes, storage drivers, widget
behavior, and SSE behavior. Cloud signup remains unavailable until its separate design and isolation
acceptance checks are complete. Rollback restores a compatible application version or provisioning
state deliberately; it does not automatically disable RLS to make startup succeed.

## Acceptance evidence

Use real PostgreSQL 16+ with a production-like non-owner runtime role and separate fixture setup
credentials. Tests must prove that omitting an application organization predicate still restricts
reads, writes, deletes, and RETURNING results. Test tenant A, tenant B, missing context, incorrect
context, connection reuse, concurrent scopes, nested scopes, rollback, child tables, nullable global
rows, and foreign parent references. A superuser-only fixture is not evidence of enforcement.

Maintain a route inventory covering dashboard, token API, MCP delegation, public widget, guest and
review links, assets, integrations, exports, and organization settings. Every tenant resource route
has a foreign-organization rejection case or a documented non-resource classification. Exercise
list, detail, create with foreign relationship, update, delete, and download paths where exposed.
Capability routes require forged, revoked, expired, and cross-project cases as applicable.

Worker tests cover forged job relationships and global scheduling; stream tests prove database
access re-enters scope after response creation without retaining a transaction. Startup tests reject
missing policies, unprotected tenant tables, invalid mode, and privileged runtime roles. Existing
self-host API and browser journeys remain regression gates.

Run focused tests during implementation, database integration tests in CI if local Postgres is
unavailable, and repository-required lint, types, builds, and CI checks before delivery. Review the
complete branch independently before merging. Record actual evidence and any unverified paths.

## Delivery sequence

1. Inventory tenant tables, relationships, bootstrap access, side effects, and route ownership.
2. Add scoped database APIs and meaningful context/concurrency tests.
3. Add policies, relationship constraints, Cloud provisioning, and startup checks with real-DB tests.
4. Integrate authenticated routes and server reads, then public capabilities and worker paths.
5. Complete route-wide cross-tenant evidence, self-host regressions, documentation, and branch review.

These are implementation dependencies within one isolation foundation. Until all five are verified,
do not advertise tenant isolation or enable Cloud signup.
