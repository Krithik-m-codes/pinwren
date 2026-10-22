// Pinwren Enterprise licence signing (blueprint 07 §4). A `.lic` file is
//   base64url(payload JSON) "." base64url(Ed25519 signature over the first segment's ASCII bytes)
// and the server verifies it offline against the public key named by `payload.kid`.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";

const REQUIRED = ["kid", "lid", "customer", "issuedAt", "expiresAt"];

/** A new Ed25519 key pair: the public half as base64 SPKI DER (for `license/keys.ts`), the private as PEM. */
export function generateKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

/** Accepts a PEM, or base64 PKCS#8 DER (handy in a single-line secret). */
export function loadPrivateKey(text) {
  const t = String(text ?? "").trim();
  if (!t) throw new Error("no private key given");
  if (t.includes("BEGIN")) return createPrivateKey(t);
  return createPrivateKey({ key: Buffer.from(t, "base64"), format: "der", type: "pkcs8" });
}

/** Fill defaults and check the fields the server requires, so a bad file fails here, not at a customer. */
export function normalizePayload(input) {
  const p = {
    v: 1,
    edition: "enterprise",
    features: [],
    limits: {},
    instance: null,
    graceDays: 30,
    ...input,
  };
  for (const k of REQUIRED) {
    if (typeof p[k] !== "string" || !p[k]) throw new Error(`payload.${k} is required`);
  }
  for (const k of ["issuedAt", "expiresAt"]) {
    if (Number.isNaN(Date.parse(p[k]))) throw new Error(`payload.${k} must be an ISO 8601 date`);
  }
  if (Date.parse(p.expiresAt) <= Date.parse(p.issuedAt)) throw new Error("expiresAt must be after issuedAt");
  if (!Array.isArray(p.features) || p.features.some((f) => typeof f !== "string")) {
    throw new Error("payload.features must be a list of feature names");
  }
  if (p.v !== 1 || p.edition !== "enterprise") throw new Error("only v: 1, edition: enterprise is supported");
  return p;
}

export function signLicense(payload, privateKey) {
  const key = typeof privateKey === "string" ? loadPrivateKey(privateKey) : privateKey;
  const body = Buffer.from(JSON.stringify(normalizePayload(payload))).toString("base64url");
  const sig = sign(null, Buffer.from(body, "utf8"), key).toString("base64url");
  return `${body}.${sig}`;
}

/** Verify with a base64 SPKI public key; returns the payload or throws. */
export function verifyLicense(text, publicKeyBase64) {
  const [body, sig, extra] = String(text).trim().split(".");
  if (!body || !sig || extra !== undefined) throw new Error("not a licence file");
  const key = createPublicKey({ key: Buffer.from(publicKeyBase64, "base64"), format: "der", type: "spki" });
  if (!verify(null, Buffer.from(body, "utf8"), key, Buffer.from(sig, "base64url"))) {
    throw new Error("signature does not verify");
  }
  return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
}
