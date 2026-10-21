import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { env } from "./env";

const scrypt = promisify(scryptCb) as (
  pw: string,
  salt: Buffer,
  len: number,
  opts: object,
) => Promise<Buffer>;

// --- Secrets at rest (SMTP password, webhook signing secrets) ----------------------------------------
// AES-256-GCM with a key derived from ANNOTA_SECRET by HKDF. Format: `v1.<iv>.<tag>.<ciphertext>`
// (base64url). Rotating ANNOTA_SECRET makes stored secrets unreadable; they must be re-entered.

let key: Buffer | undefined;
function secretsKey(): Buffer {
  key ??= Buffer.from(hkdfSync("sha256", env().ANNOTA_SECRET, "annota", "secrets-at-rest v1", 32));
  return key;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretsKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), ct]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

export function decryptSecret(stored: string): string {
  const [v, iv, tag, ct] = stored.split(".");
  if (v !== "v1" || !iv || !tag || ct === undefined) throw new Error("unknown secret format");
  const decipher = createDecipheriv("aes-256-gcm", secretsKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

// --- Hashes ------------------------------------------------------------------------------------------

export const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb);
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export const hmacSha256Hex = (secret: string, data: string) =>
  createHmac("sha256", secret).update(data).digest("hex");

// --- API tokens: scrypt (memory-hard), params stored with the hash ----------------------------------

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashToken(token: string): Promise<string> {
  const salt = randomBytes(16);
  const dk = await scrypt(token, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${dk.toString("base64url")}`;
}

export async function verifyToken(token: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const dk = await scrypt(token, Buffer.from(salt, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return timingSafeEqual(dk, expected);
}
