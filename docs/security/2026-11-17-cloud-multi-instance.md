# Cloud two-process backend acceptance — 2026-11-17

The next WP-21 acceptance step now has an automated suite:
[`cloud-multi-instance-db.test.ts`](../../packages/api/src/cloud-multi-instance-db.test.ts).
It starts two actual Node processes against one disposable PostgreSQL database provisioned with
restricted runtime/service roles. Each child imports the real Hono API, signs in seeded accounts,
owns real SSE readers and uses PostgreSQL LISTEN/NOTIFY and rate repositories. Application names
identify each process's database connections. No authentication, tenant access, SSE bus or counter
repository is mocked.
Administrative test/migration URLs stay in the parent process; the controller removes them from
child environments, and child startup rejects their presence.

The controller uses validated IPC to invoke `app.request` and collect responses/frames inside each
child. This exercises HTTP handler semantics and Web Streams without opening network ports. It does
**not** exercise TCP/TLS, reverse proxies, buffering/compression, load-balancer routing or browser
EventSource behavior. Production deployment and capacity rehearsals remain separate gates.

## Verified cases

1. Real signed cookies issued by one process work on the other. Both processes alternate workspace
   identities through pools limited to one connection; interleaved reads contain only the caller's
   workspace data. Foreign reports/projects and unauthenticated requests are refused.
2. Published event IDs are identical on both processes and an observer stream. Workspace/project
   filters hold, and bell entries reach only the designated user in the designated workspace.
3. Authenticated presence crosses processes, supports explicit leave and rejects foreign reports.
4. A client reconnecting on the healthy second process receives visible events after `Last-Event-ID`,
   excluding the marker event and intervening foreign-workspace events.
5. Forty concurrent count requests across two processes share one window: exactly twenty are
   accepted at a limit of twenty. Independent keys remain independent, an expired window resets,
   and four three-unit requests at a limit of ten accept exactly three.
6. Terminating the first process's LISTEN backend creates a new listener connection and future live
   delivery resumes. The administrative fault targets only the current fixture database and its
   UUID application name.
7. Killing a process expires its presence on the surviving instance after the real 45-second TTL and
   sweeper interval. A restarted process accepts the existing valid cookie, opens a stream and receives
   new live events.
8. Removing membership rejects new requests and SSE reconnects on both instances. Deleting a session
   likewise rejects new requests and reconnects, without relying on a process restart.

## Recovery contract and limits

The replay ring is process-local and contains at most 500 events. The suite tests replay on a healthy
listener that observed those events. It does not establish durable replay after a process restart,
catch-up for notifications missed while LISTEN was disconnected, or exactly-once delivery. A fresh
process accepts an unknown cursor with no historical backlog; the existing client refetch-on-reopen
contract remains necessary. Established streams retain the existing maximum lifetime of fifteen
minutes; this suite checks revocation on requests/reconnects, not immediate closure of old streams.

The rate cases test the shared counter repositories with explicit independent keys, not every HTTP
intake namespace or production quota. This is two-process functional evidence, not load/capacity,
multi-host networking, migration/rollback or credential-rotation certification.

## Review and reproduction

Independent source review required cleanup to attempt fixture disposal even after an assertion fails,
and required session-revocation SSE reconnect assertions on both processes. Both are addressed.
Stream readers now expose unexpected failure/closure rather than letting negative filter assertions
pass against dead readers; event-ID equality is checked on every relevant process/stream. Startup,
command and process-cleanup waits are bounded. Teardown checks database connections and restricts
fallback termination to the fixture's own named processes before disposing its database and roles.
Cold API imports have a 100-second startup deadline (a cold import takes ~25 s on a quiet machine and several times that under CPU contention); bootstrap diagnostics identify an import stall.

All eight cases passed locally on PostgreSQL 17 after these review changes. The reviewer ran no tests.
The complete local isolation run passed **633 tests across all 28 runner suites**. Workspace unit
tests passed **1,224 cases**; database-dependent cases run separately from that count. Full lint,
formatting, workspace typechecking, production builds and changed-document link checks passed.
The Windows build reported a standalone-link warning after successful tasks; Linux CI remains the
artifact/build gate for the pushed head.
The suite is part of `scripts/tenant-isolation.mjs`, so PostgreSQL 16/17 CI must verify the new head.
The fixture administrator needs role/database creation and permission to terminate its test backends.
Use the disposable isolation environment required by the runner; the harness creates no public test API.

Green digest checkpoint: `f5c8e31` in [PR #86](https://github.com/Krithik-m-codes/pinwren/pull/86),
[CI run 44106834458](https://github.com/Krithik-m-codes/pinwren/actions/runs/44106834458).
This acceptance follow-up requires its own green commit. See [the roadmap checklist](../roadmap-status.md)
for remaining deployment/operator gates and missing implementation.
