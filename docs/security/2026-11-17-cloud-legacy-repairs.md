# Cloud legacy startup repairs — 2026-11-17

The startup URL-encryption and page-grouping helpers used unscoped `getDb()`. In Cloud mode they
failed closed and startup logged the errors while leaving old data unrepaired. New restricted-role
PostgreSQL cases reproduced both failures before the change.

The service repository now enumerates organisation identifiers only. Content repair uses the runtime
role inside `withOrg`, with explicit organisation/project predicates as well as RLS. No role grants,
policy exceptions or privileged application credentials were added.

- Legacy Slack/Discord URLs are encrypted in independently committed batches of 500 endpoints, with
  transaction-local statement/lock timeouts inherited from the maintenance batch helper. Updates
  compare the old URL, so an administrator's concurrent edit is preserved. The startup helper drains
  its backlog; it does not use scheduled maintenance's ten-batch cap. Existing ciphertext and generic
  webhook URLs are unchanged. Encryption still requires the installation's existing `PINWREN_SECRET`.
- Page merging enumerates scoped projects and commits each project's repair independently. The
  on-demand helper requires a tenant scope. A project row lock encloses configuration reads, candidate
  selection, merge planning and writes in the same transaction, serializing competing repairs. Moves,
  deletes and renames explicitly match the project and organisation. A failed delete rolls back the
  associated feedback moves. The optional caller-supplied candidate list was internal and is removed.
- Startup retains its existing error logging and continues after a failed repair. Reruns are safe.
  The existing 50,000-candidate page cap remains, now per project. Very large project/backlog timing,
  concurrent intake, process interruption and production migration rehearsals remain release-readiness
  work; this source fix is not a production upgrade certification.

Independent source review found that an initial ten-batch encryption cap could leave plaintext after
startup. A 5,001-endpoint regression failed with 5,000 updates before the fix. The cap is removed while
preserving independent batch commits. The reviewer found no other actionable correctness issues and
ran no tests. Implementation verification is recorded separately below and in the PR checks.

`packages/api/src/cloud-legacy-repairs-db.test.ts` covers real restricted runtime/service roles across
two workspaces: encryption roundtrip and rerun, page/reference ownership and rerun, foreign-project
refusal with RLS disabled, write failure/rollback/recovery, competing repairs, nested global invocation
refusal and draining a backlog above 5,000 endpoints. See [the roadmap checklist](../roadmap-status.md)
for the remaining worker and operator work.

Initial local PostgreSQL 17 verification passed all six new cases and all 209 Cloud route cases. The four
startup-security, seven wave-5 notification/permission and ten widget/page-grouping cases also passed
(236 focused checks in total). Workspace unit tests passed 1,224 cases; database-dependent suites run separately from
that unit count. Workspace typechecking and a final API typecheck passed. CI must verify the pushed
follow-up head independently of the green maintenance checkpoint `6312d62`. Full lint, formatting,
documentation links and production builds also passed locally.

## Selfhost route regression found by CI

CI run [44029610337](https://github.com/Krithik-m-codes/pinwren/actions/runs/44029610337) on `75f7e5a`
passed both PostgreSQL isolation jobs but failed dashboard URL grouping and two API smoke assertions
(628 passed, two failed). The on-demand regroup route relied on Cloud's outer transaction middleware;
selfhost skips that middleware, so the newly scoped merge helper threw before regrouping pages.

The route now establishes `withOrg` from the authenticated workspace before both project lookup and
merging. Cloud reuses its existing scope. A seventh database regression uses selfhost mode, disables
RLS on the relevant fixture tables, and mounts the real regroup router with authenticated context
variables and no outer tenant middleware. It reproduced the exact organisation-transaction error
before the route fix. After the fix, all seven repair cases, 209 Cloud route cases and 21 related
unit cases passed locally (237 focused checks), as did API typechecking, source lint and formatting.
All required checks passed on `9e44d4d` in
[CI run 44040406671](https://github.com/Krithik-m-codes/pinwren/actions/runs/44040406671), including
dashboard regrouping and full API smoke. Later follow-ups need their own green head.
