# Licence signing keys — owner steps before the first release

Pinwren Enterprise licences (`.lic` files) are verified offline against the public keys in
`packages/api/src/license/keys.ts` (`PRODUCTION_KEYS`). That map is **empty** today, so a production
build can't verify any licence. The dev key (`dev-2026`) is refused whenever `NODE_ENV=production`.

Only the project owner may create the production key: whoever holds the private key can mint
licences. Nobody else (and no CI job, and no agent) should generate it.

The release build enforces this. `docker/Dockerfile` runs `docker/check-release-keys.mjs` when it is built
with `--build-arg PINWREN_RELEASE=1`, and fails if `PRODUCTION_KEYS` has no key. A production server built
some other way logs `PRODUCTION_KEYS is empty` at start.

## 1. Generate the key pair (once, on a trusted machine)

```sh
node tools/sign-license keygen
```

It prints:

- **Public key (base64 SPKI)**, starting `MCow…`. This one gets committed.
- **Private key (PEM)**. Never commit it, paste it into chat or put it in a ticket.

## 2. Store the private key

Put the PEM in your secret manager (1Password, Bitwarden, a hardware-backed vault) as
`pinwren-licence-signing-key-2026`. Keep an offline backup, because a lost key means re-issuing every
licence. Delete any copy left in your terminal scrollback or on disk.

## 3. Commit the public key

Edit `packages/api/src/license/keys.ts`. Pick a key id (`kid`), for example `pinwren-2026`:

```ts
export const PRODUCTION_KEYS: Readonly<Record<string, string>> = {
  "pinwren-2026": "MCowBQYDK2VwAyEA…the public key from step 1…",
};
```

Check it:

```sh
node docker/check-release-keys.mjs   # prints "[release] 1 production licence key(s) present."
```

Commit with `feat(license): add production licence key pinwren-2026`.

## 4. Turn on the release gate in CI

In `.github/workflows/docker-publish.yml`, add to the `docker/build-push-action` step:

```yaml
build-args: |
  PINWREN_RELEASE=1
```

From then on an official image can't be published without a production key.

## 5. Sign a test licence and verify it on a production build

```sh
cat > test.json <<'JSON'
{ "kid": "pinwren-2026", "lid": "lic_selftest", "customer": "Self test",
  "features": ["white_label"], "limits": {}, "graceDays": 0 }
JSON
PINWREN_LICENSE_PRIVATE_KEY_FILE=/path/to/pinwren-2026.pem \
  node tools/sign-license sign test.json --days 7 --out test.lic
node tools/sign-license verify test.lic --public-key "MCowBQYDK2VwAyEA…"
```

Upload `test.lic` in Settings › Licence on an instance running the Docker image (`NODE_ENV=production`).
It should show as valid. Then delete it.

## Rotation

1. Generate a new pair (`pinwren-2027`).
2. Add it to `PRODUCTION_KEYS` next to the old one.
3. Sign new licences with the new key.
4. Remove the old key only after every licence it signed has expired (plus the grace period).

If a private key leaks, remove its public key at once and re-issue all affected licences with a new key.
