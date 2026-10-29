# Cloud Tenant Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce organization isolation at the database boundary and prove it across tenant entry points before enabling Cloud signup.

**Architecture:** Use transaction-local organization identity and AsyncLocalStorage to propagate a scoped Drizzle transaction. Install policies and relationship constraints, provision Cloud database roles separately, and reject incomplete or unsafe Cloud deployments at startup. Keep bootstrap, identity, and global maintenance access explicit and finite.

**Tech Stack:** TypeScript, Node.js AsyncLocalStorage, Drizzle, postgres-js, Hono, PostgreSQL 16+, Vitest, existing smoke and Playwright CI.

**Spec:** `docs/superpowers/specs/2026-10-29-cloud-tenant-isolation-design.md` (approved).

**Execution:** Native implementation in this worktree, then one independent whole-branch review. The user authorized continuing remaining phases, pushing changes, and closing PRs; production provisioning and paid services are outside this plan.

## Global Constraints

- The same build supports `PINWREN_MODE=selfhost|cloud`, defaulting to `selfhost`.
- Postgres remains the only required service; this stage adds no Redis or paid service dependency.
- Migration credentials must not be available to request handlers.
- Existing application organization predicates remain as defense in depth.
- Cloud signup remains unavailable until its separate design and isolation acceptance checks are complete.
- Do not hold a transaction or pooled connection for the lifetime of an SSE subscription, response stream, remote API request, SMTP send, or object upload.
- Use real PostgreSQL 16+ with a production-like non-owner runtime role and separate fixture setup credentials.
- Until all five [specification delivery steps] are verified, do not advertise tenant isolation or enable Cloud signup.

## Review Focus

- Concurrent requests and pooled connection reuse must not inherit another organization's setting (Tasks 2, 4).
- A Hono handler error converted into an HTTP response must roll back its database writes (Task 5).
- A deferred export or SSE callback must re-enter its verified scope after its request callback has returned (Tasks 5, 7).
- A forged child relationship or job identifier must not bypass ownership through a valid local row (Tasks 3, 6, 7).
- A partial migration or newly added table must prevent Cloud startup rather than silently omit protection (Tasks 1, 4, 8).

## File responsibilities

- `packages/db/src/tenant-inventory.ts`: exhaustive table classifications and parent ownership relationships.
- `packages/db/src/tenant-context.ts`: organization scope lifecycle and transaction propagation.
- `packages/db/src/index.ts`: resolve scoped versus default database access; export the scoped API.
- `packages/db/src/cloud-security.ts`: inspect actual database role capabilities and security state.
- `packages/db/src/provision-cloud.ts`: privileged, standalone provisioning entry point.
- `packages/db/drizzle/`: generated migration SQL and metadata using the existing migration layout.
- `packages/api/src/db/identity.ts`, `bootstrap.ts`, `system.ts`: restricted repositories for explicitly authorized non-tenant work; no export of a generic unrestricted database to route handlers.
- `packages/api/src/tenant-scope.ts`: verified request organization propagation and finite database boundaries.
- `packages/api/src/tenant-isolation.test.ts`: real-Postgres boundary and application integration cases.
- `scripts/tenant-isolation.mjs`: fixture setup, role provisioning, and integration test orchestration.
- `docs/security/cloud-tenant-isolation.md`: operator setup, role grants, rollout, and evidence.

## Task 1: Inventory the complete boundary

**Files:** Create `packages/db/src/tenant-inventory.ts`, `packages/api/src/tenant-entrypoints.test.ts`, `docs/security/cloud-tenant-isolation.md`; read `packages/db/src/schema/{app,auth}.ts`, all API routers, jobs, server reads, and `scripts/smoke.mjs`.

**Interfaces:** Produce `tenantInventory`, a typed array of `{ table: string; ownership: "direct" | "parent" | "identity" | "system"; parents: readonly string[] }`. Direct entries require `org_id`; parent entries name the complete relationship chain. The route inventory records method, path, authentication mechanism, resource ownership, streaming/side effects, and required foreign-resource test.

- [ ] Collect schema table names and database imports without dumping entire source trees:

```powershell
rg -n 'pgTable\(' packages/db/src/schema
rg -l 'getDb\(|postgres\(' packages/api/src apps/web/src scripts
rg -n '\.(get|post|put|patch|delete)\(' packages/api/src/routes
```

Expected: an inspectable list covering application and auth tables, every database entry point, and registered route methods.

- [ ] Add a schema inventory test using Drizzle's `getTableName`/`is`/`PgTable` APIs and actual schema exports. Compare sorted schema table names with inventory names, assert unique names, and assert every parent exists. Initially omit one application table and watch the equality assertion fail, then complete the inventory. Classify nullable `email_delivery` ownership explicitly; global rows remain system-only.
- [ ] Record all child and parent keys, direct tenant foreign keys, auth/bootstrap queries, queue payload identifiers, and side effects. Record each route's named test case in the operator document. Resource routes without a foreign-resource case must fail the inventory test; exempt only documented identity/system or non-resource routes.
- [ ] Run `pnpm --filter @pinwren/api test -- src/tenant-entrypoints.test.ts`. Expected: inventory assertions pass after completion, including a test demonstrating that a simulated added table or route is rejected.
- [ ] Commit: `git commit -m "test: inventory cloud tenant database boundaries"`.

## Task 2: Transaction-local organization context

**Files:** Create `packages/db/src/tenant-context.ts`, `packages/api/src/tenant-context.test.ts`; modify `packages/db/src/index.ts`.

**Interfaces:** Produce `withOrg<T>(orgId: string, callback: (db: TenantDatabase) => Promise<T>): Promise<T>`, `currentOrgId(): string | undefined`, and an internal context resolver. `TenantDatabase` is inferred from Drizzle's transaction callback, not an unsafe cast to a root database with different methods. Preserve the existing root database type for privileged infrastructure.

- [ ] Write tests for blank/whitespace identifiers, same-org nesting, different-org rejection, concurrent scope isolation, callback return values, error propagation, and no active context after completion. Use a transaction adapter fake only for lifecycle unit tests; SQL enforcement belongs to Task 4.

```ts
await withOrg("org-a", async () => {
  expect(currentOrgId()).toBe("org-a");
  await expect(withOrg("org-b", async () => undefined)).rejects.toThrow();
});
expect(currentOrgId()).toBeUndefined();
```

- [ ] Run `pnpm --filter @pinwren/api test -- src/tenant-context.test.ts`. Expected: failure because the context exports do not exist, followed by meaningful behavioral failures as the interface is introduced.
- [ ] Implement AsyncLocalStorage, same-org reuse, cross-org rejection, and transaction-local setting before invoking the callback:

```ts
await tx.execute(sql`select set_config('pinwren.org_id', ${orgId}, true)`);
```

Ensure `getDb()` returns the active scoped database and that Cloud access without context throws. In selfhost mode preserve existing unscoped behavior. Create explicit internal pool access for infrastructure; do not expose an arbitrary bypass flag to callers. Unit-test the missing-context rule in both modes.

- [ ] Run the focused test and `pnpm --filter @pinwren/db typecheck`. Expected: pass, including existing service compatibility with nested transactions/savepoints.
- [ ] Commit: `git commit -m "feat: add transaction scoped organization context"`.

## Task 3: Tenant policies and relationship integrity

**Files:** Modify `packages/db/src/schema/app.ts`; create a generated migration in `packages/db/drizzle/`; extend `packages/api/src/tenant-isolation.test.ts` and the fixture runner.

**Interfaces:** Consume Task 1's direct/parent table inventory and Task 2's `pinwren.org_id` setting. Produce policies for all four CRUD operations and constraints preventing foreign tenant parents. Migration numbering and journal entries follow the current Drizzle journal; do not invent a conflicting sequence.

- [ ] With separate fixture and runtime credentials, create organizations A and B, their projects and feedback, all child records, and a nullable system email delivery. Write tests that deliberately omit organization predicates, insert with foreign `org_id`, change ownership, reference foreign parents, and inspect UPDATE/DELETE RETURNING.

```sql
select set_config('pinwren.org_id', 'org-a', true);
select id from project; -- only A, despite the absent WHERE clause
```

- [ ] Run the integration test against PostgreSQL 16+. Expected: foreign rows are visible or foreign references are accepted before policies/constraints; capture those failures. Use CI if local Postgres is unavailable and retain the failing run evidence before adding the fix.
- [ ] Add policies comparing direct ownership to `nullif(current_setting('pinwren.org_id', true), '')`, with both USING and WITH CHECK. Parent policies check protected parent visibility; join tables validate both ends. Add composite unique keys/foreign keys for tenant parent relations. Preflight existing inconsistent relationships and abort with table/key diagnostics; never repair by deleting data.
- [ ] Keep policy installation separate from activation. Add explicit tests for missing context, null global ownership, each child table, foreign labels, foreign projects, and an existing invalid relationship during migration.
- [ ] Run the integration suite as the non-owner runtime role after temporary fixture activation. Expected: all tenant cases pass, global rows remain invisible, invalid relationships fail, and valid existing data migrates.
- [ ] Commit: `git commit -m "feat: enforce tenant row policies and parent integrity"`.

## Task 4: Cloud provisioning and startup enforcement

**Files:** Create `packages/db/src/cloud-security.ts`, `packages/db/src/provision-cloud.ts`, `scripts/tenant-isolation.mjs`; modify database exports, `packages/api/src/env.ts`, `packages/api/src/startup.ts`, `apps/web/src/instrumentation-node.ts`, `.github/workflows/ci.yml`, `.env.example`, and the operator document.

**Interfaces:** Produce `assertCloudDatabaseSecurity(): Promise<void>` and standalone provisioning CLI. Configuration adds `PINWREN_MODE=selfhost|cloud` and a distinct service database connection; runtime startup never receives provisioning credentials. Export the startup check through the API entry point for the Node startup hook.

- [ ] Write tests for invalid mode, missing policies, absent ENABLE/FORCE, a missing inventory table, unexpected permissive policies, owner/superuser/BYPASSRLS credentials, inherited privileged role membership, and unauthorized schema alteration. Test selfhost defaults without Cloud provisioning.
- [ ] Run focused startup tests and the integration runner. Expected: unsafe role and partial policy fixtures fail the intended assertions before the checker exists.
- [ ] Implement atomic provisioning under an advisory lock. Validate the runtime role name as an identifier and quote identifiers through postgres-js identifier facilities. Apply grants, revoke PUBLIC access to protected data and bootstrap functions, enable and force RLS for the complete inventory, and validate resulting catalogs before committing. Provisioning must be idempotent and require explicit privileged CLI execution.
- [ ] Put the startup security check before background workers and startup fixes, outside catch-and-continue handlers. Validate actual role membership, ownership, table policies and expected security flags; sanitize diagnostic output. Add CI Postgres integration execution using isolated fixture/runtime/service credentials.
- [ ] Test repeated provisioning, rollback on a failed provisioning step, max-one-connection tenant reuse after commit/rollback, and concurrent A/B transactions. Run `pnpm typecheck` and the integration runner. Expected: safe setup passes; every unsafe fixture prevents Cloud startup; selfhost remains usable.
- [ ] Commit: `git commit -m "feat: provision and validate cloud database isolation"`.

## Task 5: Authenticated requests, server reads, and transaction outcomes

**Files:** Create `packages/api/src/tenant-scope.ts`, `packages/api/src/db/identity.ts`; modify `packages/api/src/context.ts`, `packages/api/src/routes/{v1,dashboard,realtime}.ts`, affected service transaction boundaries, `apps/web/src/lib/server/org-data.ts`, and `packages/api/src/tenant-isolation.test.ts`. Read and follow `apps/web/AGENTS.md` before web edits.

**Interfaces:** Consume `withOrg` and Cloud security verification. Identity repository functions expose validated session/membership/token projections. Request middleware carries verified organization identity; finite service database operations enter `withOrg`. No transaction wraps remote I/O merely because a handler called it.

- [ ] Write real application tests with two users/organizations covering session and token list/detail/write/delete/asset routes, revoked membership, foreign active organization, token scopes, and MCP delegation. Include a handler that writes then throws, and one whose error is translated by Hono into a response.
- [ ] Run the focused application integration cases. Expected: missing Cloud context or unscoped access fails before integration, while the current application-only organization filtering is not accepted as proof of RLS.
- [ ] Move identity lookups behind the named repository, then scope finite tenant service operations after validation. For handlers entirely containing finite database work, commit only on successful handler completion and explicitly roll back handled errors. Keep post-commit effects outside that transaction. For mixed handlers, refactor database work into finite callbacks rather than wrapping uploads, remote APIs, or streaming.
- [ ] Wrap server branding reads in verified organization scope and classify organization name/identity reads explicitly. Add a deferred export test that returns its response, then reads two batches under the correct scope. Add an SSE test proving subscription lifetime holds no transaction and reconnect reads use current membership.
- [ ] Run focused API integration tests, `pnpm --filter @pinwren/api test`, and web typecheck. Expected: all pass, no rolled-back writes emit events, and no foreign metadata is leaked.
- [ ] Commit: `git commit -m "feat: scope authenticated tenant database operations"`.

## Task 6: Public capabilities and narrow bootstrap repositories

**Files:** Create `packages/api/src/db/bootstrap.ts`; modify `packages/api/src/routes/{widget,guest,review-links,inbound,unsubscribe}.ts`, their asset/content services, and integration tests.

**Interfaces:** Bootstrap repository returns only the fields needed to verify each existing key/signature/capability and derive its organization. Its service role has grants for those projections, with no general tenant table access. Database functions, if needed, use fixed search paths, qualified identifiers, restricted execution grants, and no caller-controlled SQL.

- [ ] Write cases for foreign widget project IDs, wrong Origin, forged/expired/revoked guest and review capabilities, cross-project assets, foreign webhook relationships, and wrong-organization unsubscribe links. Assert no internal comment, private reporter data, or signing secret appears in a public projection.
- [ ] Run these integration cases. Expected: absent Cloud bootstrap/context paths fail before implementation.
- [ ] Move only capability-resolution queries to bootstrap repositories. Preserve signature/expiry/revocation/Origin validation before entering the derived organization's scope. Run content queries through the runtime transaction. Split uploads, object reads and inbound remote work from finite database transactions. Preserve public/internal audience predicates in addition to RLS.
- [ ] Test capability revocation between lookups and content access, malformed UUID responses, and rejected writes leaving neither rows nor success events. Run the integration cases plus existing guest/widget smoke journeys. Expected: foreign capabilities receive established 404/403 responses and valid capabilities retain current behavior.
- [ ] Commit: `git commit -m "feat: isolate public capability database access"`.

## Task 7: Workers, maintenance, and external effects

**Files:** Create `packages/api/src/db/system.ts`; modify `packages/api/src/jobs/{index,dispatch,digest,maintenance,ai}.ts`, `packages/api/src/webhooks/deliver.ts`, `packages/api/src/services/{project-export,workspace}.ts`, email delivery persistence, and focused worker integration tests.

**Interfaces:** System repositories enumerate minimal work identifiers and perform explicitly authorized global maintenance. Tenant worker operations consume verified `{ orgId, resourceId }` relationships and enter `withOrg` for each finite database unit. Queue/SSE infrastructure connections cannot serve as ordinary tenant database handles.

- [ ] Test forged AI/export/dispatch/webhook jobs pairing A's organization with B's resource, digest grouping across both organizations, retention/trash isolation, and null-organization system email records. Add a delayed external delivery fixture and assert it holds no tenant transaction while waiting.
- [ ] Run focused worker cases. Expected: missing worker context fails before changes; wrong relationships cannot be treated as successful work.
- [ ] Move global scans into system repositories and process tenant units independently. Derive organization from trusted stored job relationships where payloads lack it; verify payload identifiers agree. Separate SQL reads/writes from SMTP, tracker APIs, object storage and archive streaming. Preserve idempotency and queue retry behavior. Validate account/workspace deletion authorization before invoking explicit system deletion.
- [ ] Run worker cases and the integration runner. Expected: B's rows survive every forged A job, legitimate global work reaches both tenants without mixing content, and retries do not duplicate successful side effects.
- [ ] Commit: `git commit -m "feat: isolate tenant jobs and maintenance operations"`.

## Task 8: Complete coverage and protected-branch delivery

**Files:** Complete `packages/api/src/tenant-entrypoints.test.ts`, `packages/api/src/tenant-isolation.test.ts`, `scripts/tenant-isolation.mjs`, CI integration, operator documentation, and the remaining-phases status document.

**Interfaces:** Consume the schema/route inventories and all implemented boundaries. Produce evidence for every acceptance criterion in the approved spec; mark remaining WP-21 deliverables explicitly incomplete.

- [ ] Add the remaining foreign-resource assertions from the inventory. Fail tests on an unclassified route or table. Use the existing smoke/browser fixtures to cover selfhost authentication, guest/widget content, exports, branding and realtime regressions.
- [ ] Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, focused isolation integration checks, and required existing CI builds/journeys. Expected: each exits successfully; retain command/run references. Local database unavailability is a CI dependency, never a passing result.
- [ ] Obtain one independent whole-branch review against the approved spec, policies, roles, bootstrap functions, transaction outcomes, inventory and test evidence. Fix important findings with reproducing tests. Re-run the affected checks; broaden only when changes justify it.
- [ ] Update operator documentation with actual provisioning commands, expected role grants, startup errors, migration/rollback process and test evidence. Confirm a runtime process cannot access migration credentials or generic privileged pool exports.
- [ ] Commit, push the feature branch, create the PR with the final implementation and evidence, wait for required checks, and merge/close through `gh` under the user's existing authorization. Restore the user's preferred active GitHub account after operations. Report the foundation's actual status and all unfinished WP-21 deliverables.

## Plan self-review

The eight tasks cover all specification delivery steps: inventory (1), context (2), policies and
provisioning (3–4), authenticated/public/job integration (5–7), and route-wide evidence/delivery (8).
Review Focus items have explicit tests in their owning tasks. No Cloud signup or Redis work is
implicitly included. Database integration failures must be observed before fixes, using isolated CI
when local Postgres is unavailable. The executing agent must resolve discovered source-level
interface conflicts in its ledger before changing the agreed security contract.
