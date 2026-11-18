# Cloud multi-instance acceptance plan

Execution status (2026-11-18): implementation, independent review fixes and local verification are
complete. Pushed-head CI remains pending. This is an execution record; current scope and remaining
gates are tracked in [the roadmap](../../roadmap-status.md) and
[acceptance evidence](../../security/2026-11-17-cloud-multi-instance.md).

Purpose: add repeatable backend acceptance for the next roadmap item, using separate Node processes
sharing one disposable PostgreSQL Cloud fixture. Run real authentication, API/SSE handlers,
LISTEN/NOTIFY and rate repositories. Do not substitute in-memory transports or mock tenant access.
This provides local/CI evidence; production load-balancer, proxy, capacity and operator rehearsals
remain separate release gates.

## 1. Process harness and fixture

- Add a typed, validated IPC protocol under `packages/api/src/test-helpers/`.
- Add a child entry point that imports the real Hono app, owns SSE readers and invokes the real bus
  publisher and shared rate repositories. Use IPC rather than opening external listening ports.
- Add a parent controller that forks Node with the installed tsx loader, passes ephemeral role URLs
  through process environment, bounds request/startup waits, captures bounded diagnostics and closes
  every child on test failure. Never print credentials or use a customer database.
- Add `cloud-multi-instance-db.test.ts` using `createCloudFixture()`, two runtime/service instances,
  distinct application names, seeded accounts/members/projects/reports and real sign-in cookies.

## 2. Acceptance cases

- Cookies issued by one instance work on the other; interleaved reads preserve workspace isolation
  and foreign resources/projects are refused.
- Events cross process boundaries with identical IDs while tenant, project and bell-user filters hold.
- Authenticated presence reaches another instance, supports leave/expiry and refuses foreign reports.
- Reconnecting on a healthy second process replays visible events after Last-Event-ID. A restarted
  process has no durable replay ring; verify live delivery/authentication after restart and preserve
  the client-refetch contract.
- Concurrent count/amount limits use one PostgreSQL window across both processes and independent
  keys remain independent; an expired window can be reused.
- Terminating a LISTEN backend reestablishes delivery after PostgreSQL reconnect; record any missed
  event/recovery limitation without calling it durable delivery.
- Revoked membership/session is rejected on new requests and stream reconnects on either instance.

Write and run these acceptance cases before any production change. If a real issue appears, retain
its failing case, trace the cause, fix it and verify recovery. Do not weaken an assertion to hide a bug.

## 3. Review and integration

- Add the suite to `scripts/tenant-isolation.mjs` so PostgreSQL 16/17 CI exercises it.
- Run the focused real-role suite, relevant existing realtime/client tests, types, source lint,
  formatting and appropriate broader repository verification. Verify child/process cleanup.
- Request independent source review of the harness, assertions, any fixes and claimed evidence.
- Record exact supported behavior and remaining production checks in `docs/security/` and the
  canonical roadmap; record green PR #86 head `f5c8e31`, CI run `44106834458` separately.
- Commit, push a PR stacked on `fix/multi-workspace-digests`, link it, inspect initial feedback and
  watch CI. Do not merge the stack without authorization.
