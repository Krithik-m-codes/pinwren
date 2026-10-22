import type { Identity } from "./store";

// Input checks for the public API (wave-4 §4). Plain-JS hosts can pass anything; only well-typed fields are kept.

const str = (v: unknown, max: number) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

/** A page scope as the API takes it (`page.urlPattern`, ≤ 500 chars); anything else means "no scope". */
export const urlPatternOf = (v: unknown) => str(v, 500);

/**
 * The identity as the API takes it (`reporter.externalId`, ≤ 200 chars). A signature is kept only next to an
 * id and only when it looks like a hex HMAC-SHA256 — anything else would just fail verification on the server.
 */
export function identityOf(user: unknown, opts: unknown): Identity {
  const u = (typeof user === "object" && user !== null ? user : {}) as Record<string, unknown>;
  const id = typeof u.id === "number" && Number.isFinite(u.id) ? String(u.id) : str(u.id, 200);
  const sig =
    typeof opts === "object" && opts !== null ? (opts as { signature?: unknown }).signature : undefined;
  let signature: string | undefined;
  if (id && sig !== undefined) {
    if (typeof sig === "string" && /^[0-9a-f]{64}$/i.test(sig.trim())) signature = sig.trim().toLowerCase();
    else console.warn("[pinwren] identify: the signature must be a hex HMAC-SHA256 of the user id; ignored");
  }
  return { id, name: str(u.name, 120), email: str(u.email, 254), signature };
}
