# Cloud sign-up and onboarding

Date: 2026-10-31

Status: stacked on the billing branch (PR #28); builds on the tenant isolation foundation (PR #27).

## Scope

The isolation spec held back Cloud sign-up until its own design existed. This is that design. It covers
public email+password sign-up in `PINWREN_MODE=cloud`, the personal workspace created with each account,
the first-run onboarding, and the abuse controls around both. Self-host sign-up and the
first-account-administrator flow do not change.

## Decisions

1. **Sign-up is closed unless an operator opens it.** `PINWREN_CLOUD_SIGNUPS=open|closed`, default `closed`,
   so deploying never opens sign-ups by accident. It is the kill switch: set it to `closed` and restart to
   pause new public accounts. Invitations to existing workspaces still work while closed (a paying
   customer's teammates must not be locked out by an abuse pause). The flag is read from the environment,
   not a database setting, so a compromised tenant cannot flip it and a rollback is one variable.
2. **Email + password only.** In Cloud a new account is created only through `POST /api/auth/sign-up/email`.
   A first sign-in with Google, GitHub or an email link for an address with no account is refused, because
   those paths cannot carry the consent checkbox. Existing accounts keep every method.
3. **Email verification is required before any workspace use.** Better Auth's `requireEmailVerification` is
   on in Cloud: sign-up returns no session, the verification mail goes through the existing mailer queue,
   following the link signs the user in and lands on `/onboarding`. `requireSession` also refuses an
   unverified user (`EMAIL_NOT_VERIFIED`) as defence in depth.
4. **Consent.** Sign-up needs `termsAccepted: true` (Terms and Privacy checkbox linking to the www legal
   pages; `PINWREN_TERMS_URL` / `PINWREN_PRIVACY_URL` override the defaults). The acceptance time and
   the URLs shown are stored as a system `setting` row `consent.<userId>` so there is evidence without a
   schema change on the identity tables.
5. **Abuse controls**, all checked before an account exists and reusing the Postgres fixed-window counter
   (no new table, no Redis): a per-IP hourly cap (`PINWREN_CLOUD_SIGNUPS_PER_IP_HOUR`, default 5, keyed by
   the trusted-proxy address), an instance-wide hourly cap (`PINWREN_CLOUD_SIGNUPS_PER_HOUR`, default 100)
   that doubles as an automatic brake on a flood, a built-in disposable-mailbox domain list, and the
   existing Better Auth endpoint limit. Refusals use stable codes and never say which check fired for
   the IP and global caps.
6. **A personal workspace on the Free plan, created with the account.** `provisionPersonalWorkspace` in the
   identity/bootstrap repository inserts the organisation and the owner membership in one transaction on
   the service connection; it is idempotent (an account that already has a membership is left alone).
   Free is the absence of a `billing_subscription` row (`effectivePlan`), so no billing write is needed.
   It runs in the user-created hook; if it fails the user row is removed and the sign-up fails, and the
   session-created hook repairs and activates the workspace for any account that slipped through. The
   same hook sets the active organisation so the first session is usable.
7. **No new tables, no new routes.** Everything reuses `rate_limit` and `setting` (both already in
   `tenant-inventory.ts` as system tables) and Better Auth's `/api/auth/*`. `GET /api/setup` (public,
   already inventoried) gains the Cloud sign-up state. The route-wide cloud suite is extended with a case
   proving the public answer carries nothing of any workspace and reflects the flag.
8. **Onboarding** reuses the existing dashboard pieces in four steps: name the workspace (`PATCH
/api/workspace`), create the first project (existing preset flow), copy the widget snippet
   (`installSnippets`), invite teammates (Better Auth invitation, which already enforces the billing seat
   limit and shows the remaining seats). Every string is an English key resolved with `t()`.

## Not in this change

Social or magic-link sign-up in Cloud, CAPTCHA / proof-of-work, per-domain allow lists, an operator UI for
the kill switch (it is an environment variable), automated cleanup of never-verified accounts, deleting the
consent record with the account, and a Playwright journey (the e2e harness runs in self-host mode and
has no mail sink for the verification link).
