// Public keys that verify Enterprise licence files, by key id (`kid` in the payload). Rotation: add the
// new key here, sign new licences with it, keep the old key until its licences have expired.
//
// Production keys are generated with `node tools/sign-license keygen` by the maintainers; only the
// public half (base64 SPKI DER) is committed. The private key lives in a secret store and is passed to
// the signing tool through PINWREN_LICENSE_PRIVATE_KEY — never committed.
export const PRODUCTION_KEYS: Readonly<Record<string, string>> = {
  // "pinwren-2026": "MCowBQYDK2VwAyEA…",  ← added when the first production key is issued
};

/**
 * A throwaway key for tests, the smoke run and local development. Its private half is committed in
 * `tools/sign-license/dev-private-key.pem`, so it is trusted **only** when NODE_ENV is not
 * "production" — `next start`, the standalone server and the Docker image always run in production.
 */
export const DEV_KEYS: Readonly<Record<string, string>> = {
  "dev-2026": "MCowBQYDK2VwAyEAp58Bb137QOjLlhnEIPodrlt0lU9D/0DdMKRw0HL2Was=",
};

export function trustedKeys(nodeEnv = process.env.NODE_ENV): Record<string, string> {
  return nodeEnv === "production" ? { ...PRODUCTION_KEYS } : { ...PRODUCTION_KEYS, ...DEV_KEYS };
}
