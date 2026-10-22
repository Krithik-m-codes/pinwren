# ADR 0019 — Enterprise licence files, entitlements and white-label gating

**Status:** accepted (details blueprint 07 §4 left open)

## Context

F-098 needs Ed25519-signed licence files verified offline, with grace and read-only behaviour, and wave 4 gates one
thing behind them: white-label (hiding "Powered by Pinwren" and custom email branding). Wave 3 had already shipped
`widgetBranding.hidePoweredBy` and org email branding without any licence.

## Decision

1. **Format.** `base64url(payload JSON) "." base64url(Ed25519 signature over the first segment's ASCII bytes)`.
   Signing the encoded segment avoids any JSON canonicalisation question. The payload is blueprint 07 §4 plus `kid`,
   the id of the public key that verifies it. Unknown feature names are kept and grant nothing (newer issuers stay
   compatible).
2. **Keys.** Public keys are compiled in (`packages/api/src/license/keys.ts`, base64 SPKI by `kid`). Production keys
   are generated with `node tools/sign-license keygen`; only the public half is committed, and the signer reads the
   private key from `PINWREN_LICENSE_PRIVATE_KEY(_FILE)`. A throwaway dev key (private half committed in
   `tools/sign-license/dev-private-key.pem`) is trusted **only when `NODE_ENV !== "production"`**, so tests and the
   smoke run can sign licences while `next start`, the standalone server and the Docker image reject it.
3. **Where verification lives.** In `packages/api/src/license` rather than `ee/`: verifying a file and resolving
   entitlements is not an Enterprise feature, and Community code must be able to ask "is white-label on?" without
   importing `ee/`. Enterprise features themselves still belong in `ee/`.
4. **Source and caching.** `PINWREN_LICENSE_FILE` (read on resolve, locks uploads) or the newest uploaded row in
   `license`. Entitlements are cached per process for 60 s; an upload clears the local cache (other workers follow
   within a minute). Optional `instance` binding compares with `PINWREN_INSTANCE_ID`.
5. **Time states.** `valid` until `expiresAt`; `grace` for `graceDays` (everything works, admins see the deadline);
   `expired` afterwards = **read-only**: configured Enterprise settings keep their effect (no customer suddenly
   un-branded mid-renewal) but can't be changed (`403 LICENSE_READ_ONLY`). Data is never deleted or hidden. Seat
   limits are reported (`seats.used` = users on the instance), never enforced.
6. **White-label gating without breaking existing projects.** `hidePoweredBy` is still accepted and stored without a
   licence; `/w/config` applies it only with `white_label`. Projects that set it in wave 3 therefore keep working (no
   error, no lost setting) but show "Powered by" until a licence is installed. For email, org branding (name, logo,
   accent) stays Community as shipped in wave 3; what white-label adds is dropping the "· Powered by Pinwren" footer
   credit that a custom product name now gets.

## Consequences

- Until the maintainers issue a production key, no production instance can verify an Enterprise licence (by design;
  the mechanism is ready).
- A self-hoster can patch the check out (AGPL); licences protect the commercial relationship, not the code.
- A changed hidePoweredBy behaviour for wave-3 users is documented in `docs/contracts/wave-4.md` §9.
