import { createPublicKey, verify as edVerify } from "node:crypto";
import { type LicensePayload, licensePayload } from "@pinwren/core";

// Offline verification of `.lic` files (blueprint 07 §4). Pure: keys, clock and instance id come in as
// arguments, so every branch is unit-tested without a server.

export type VerifyResult = { ok: true; payload: LicensePayload } | { ok: false; error: string };

const DAY = 86_400_000;
/** Clock skew tolerated for `issuedAt` in the future. */
const SKEW_MS = DAY;

export function verifyLicense(
  raw: string,
  keys: Record<string, string>,
  opts: { now?: Date; instanceId?: string | undefined } = {},
): VerifyResult {
  const text = raw.trim().replace(/\s+/g, "");
  const parts = text.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, error: "Not a licence file" };
  const [body, sig] = parts as [string, string];
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(sig)) {
    return { ok: false, error: "Not a licence file" };
  }

  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "The licence payload is not JSON" };
  }
  const kid = (json as { kid?: unknown } | null)?.kid;
  if (typeof kid !== "string") return { ok: false, error: "The licence has no key id" };
  const key = keys[kid];
  if (!key) return { ok: false, error: `Unknown signing key "${kid.slice(0, 64)}"` };

  let valid = false;
  try {
    const publicKey = createPublicKey({ key: Buffer.from(key, "base64"), format: "der", type: "spki" });
    valid = edVerify(null, Buffer.from(body, "utf8"), publicKey, Buffer.from(sig, "base64url"));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, error: "The licence signature does not verify (tampered or not ours)" };

  const parsed = licensePayload.safeParse(json);
  if (!parsed.success) return { ok: false, error: "The licence payload is malformed" };
  const p = parsed.data;
  const now = (opts.now ?? new Date()).getTime();
  if (new Date(p.issuedAt).getTime() > now + SKEW_MS)
    return { ok: false, error: "The licence is not valid yet" };
  if (new Date(p.expiresAt).getTime() <= new Date(p.issuedAt).getTime()) {
    return { ok: false, error: "The licence expires before it was issued" };
  }
  if (p.instance !== null && p.instance !== opts.instanceId) {
    return { ok: false, error: "The licence is bound to another instance (PINWREN_INSTANCE_ID)" };
  }
  return { ok: true, payload: p };
}

export type LicenseTimeState = {
  status: "valid" | "grace" | "expired";
  graceEndsAt: Date;
  /** Days until expiry (valid), until the end of grace (grace), or since then (negative). */
  daysLeft: number;
};

/** valid → (expiresAt) → grace for graceDays → expired (read-only). */
export function licenseTimeState(p: LicensePayload, now = new Date()): LicenseTimeState {
  const expires = new Date(p.expiresAt).getTime();
  const graceEnds = expires + p.graceDays * DAY;
  const t = now.getTime();
  if (t < expires)
    return { status: "valid", graceEndsAt: new Date(graceEnds), daysLeft: Math.ceil((expires - t) / DAY) };
  if (t < graceEnds) {
    return { status: "grace", graceEndsAt: new Date(graceEnds), daysLeft: Math.ceil((graceEnds - t) / DAY) };
  }
  return {
    status: "expired",
    graceEndsAt: new Date(graceEnds),
    daysLeft: -Math.floor((t - graceEnds) / DAY),
  };
}
