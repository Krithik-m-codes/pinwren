# sign-license

Internal maintainer tool: signs Pinwren Enterprise licence files (blueprint 07 §4, ADR 0018). Not published.

A `.lic` file is `base64url(payload JSON).base64url(Ed25519 signature of the first part)`. The server verifies
it offline with the public key whose id is the payload's `kid` (`packages/api/src/license/keys.ts`).

```sh
# 1. Once per signing key: make a key pair. Commit only the public key (PRODUCTION_KEYS, new kid);
#    keep the private key in your secret manager.
node tools/sign-license keygen

# 2. Sign. The private key comes from the environment, never from an argument or a committed file.
cat > acme.json <<'JSON'
{ "kid": "pinwren-2026", "lid": "lic_acme_2026", "customer": "Acme GmbH", "email": "it@acme.example",
  "features": ["white_label", "sso"], "limits": { "seats": 250 }, "graceDays": 30 }
JSON
PINWREN_LICENSE_PRIVATE_KEY="$(cat pinwren-2026.pem)" node tools/sign-license sign acme.json --days 365 --out acme.lic

# 3. Check a file.
node tools/sign-license verify acme.lic --public-key MCowBQYDK2VwAyEA…
```

`PINWREN_LICENSE_PRIVATE_KEY_FILE` may point at the PEM instead. `--days n` sets `issuedAt` to now and
`expiresAt` to now + n days; otherwise both come from the payload.

## The dev key

`dev-private-key.pem` is a **throwaway** key for tests, the smoke run and local development. The server trusts
its public half (`kid: "dev-2026"`) only when `NODE_ENV` is not `production` — `next start`, the standalone
server and the Docker image never accept it. Never use it for a customer.
