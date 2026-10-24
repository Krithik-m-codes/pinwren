import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { AwsClient } from "aws4fetch";
import { env } from "./env";

// Storage drivers (blueprint F-096): local disk (default) or any S3-compatible store. Both are
// reached only by the API — assets are always streamed through `/api/assets/:id`, so the bucket can
// stay private and access control stays in one place.
export type StorageDriver = {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: ReadableStream; bytes: number } | null>;
  remove(key: string): Promise<void>;
};

// `<projectId>/<uuid>.<ext>` — random, generated server-side; never derived from user input.
// `.zip`: project data exports (services/project-export.ts).
const KEY_PATTERN = /^[a-z0-9-]+\/[a-z0-9-]+\.(png|jpe?g|webp|gif|pdf|gz|zip)$/;
function assertKey(key: string) {
  if (!KEY_PATTERN.test(key)) throw new Error(`refusing storage key ${key}`);
}

function fsDriver(root: string): StorageDriver {
  const base = resolve(root, "assets");
  const pathOf = (key: string) => {
    assertKey(key);
    const full = resolve(base, key);
    if (!full.startsWith(base + sep)) throw new Error("path escapes storage root");
    return full;
  };
  return {
    async put(key, bytes) {
      const full = pathOf(key);
      await mkdir(join(full, ".."), { recursive: true });
      await writeFile(full, bytes, { flag: "wx" });
    },
    async get(key) {
      const full = pathOf(key);
      const info = await stat(full).catch(() => null);
      if (!info) return null;
      return { body: Readable.toWeb(createReadStream(full)) as ReadableStream, bytes: info.size };
    },
    async remove(key) {
      await rm(pathOf(key), { force: true });
    },
  };
}

export type S3Options = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

/** S3-compatible driver (AWS, R2, MinIO, RustFS…) signed with SigV4 by aws4fetch. */
export function s3Driver(o: S3Options, fetchImpl: typeof fetch = fetch): StorageDriver {
  const client = new AwsClient({
    accessKeyId: o.accessKeyId,
    secretAccessKey: o.secretAccessKey,
    region: o.region,
    service: "s3",
  });
  const endpoint = new URL(o.endpoint);
  const urlOf = (key: string) => {
    assertKey(key);
    const u = new URL(endpoint);
    const basePath = u.pathname.replace(/\/$/, "");
    if (o.forcePathStyle) {
      u.pathname = `${basePath}/${encodeURIComponent(o.bucket)}/${key}`;
    } else {
      u.hostname = `${o.bucket}.${u.hostname}`;
      u.pathname = `${basePath}/${key}`;
    }
    return u.toString();
  };
  const send = async (url: string, init: RequestInit) => {
    const req = await client.sign(url, init);
    return fetchImpl(req);
  };
  return {
    async put(key, bytes, contentType) {
      const res = await send(urlOf(key), {
        method: "PUT",
        body: bytes as Uint8Array<ArrayBuffer>,
        headers: { "content-type": contentType, "content-length": String(bytes.length) },
      });
      if (!res.ok) throw new Error(`S3 put failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    },
    async get(key) {
      const res = await send(urlOf(key), { method: "GET" });
      if (res.status === 404) return null;
      if (!res.ok || !res.body) throw new Error(`S3 get failed: ${res.status}`);
      return { body: res.body, bytes: Number(res.headers.get("content-length") ?? 0) };
    },
    async remove(key) {
      const res = await send(urlOf(key), { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`S3 delete failed: ${res.status}`);
    },
  };
}

/** env() already refuses STORAGE_DRIVER=s3 without these; this keeps the types honest. */
function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required when STORAGE_DRIVER=s3`);
  return value;
}

let driver: StorageDriver | undefined;
export function storage(): StorageDriver {
  if (driver) return driver;
  const e = env();
  driver =
    e.STORAGE_DRIVER === "s3"
      ? s3Driver({
          endpoint: required("S3_ENDPOINT", e.S3_ENDPOINT),
          bucket: required("S3_BUCKET", e.S3_BUCKET),
          region: e.S3_REGION,
          accessKeyId: required("S3_ACCESS_KEY_ID", e.S3_ACCESS_KEY_ID),
          secretAccessKey: required("S3_SECRET_ACCESS_KEY", e.S3_SECRET_ACCESS_KEY),
          forcePathStyle: e.S3_FORCE_PATH_STYLE,
        })
      : fsDriver(e.PINWREN_DATA_DIR);
  return driver;
}

const MAGIC: Record<string, (b: Uint8Array) => boolean> = {
  "image/png": (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": (b) =>
    b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  "image/gif": (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  "application/pdf": (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d,
  // Session replays (F-007): gzip (RFC 1952) magic plus the deflate method byte.
  "application/gzip": (b) => b[0] === 0x1f && b[1] === 0x8b && b[2] === 0x08,
};

export const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "application/gzip": "gz",
};

/**
 * Decode a base64 data URL and verify the bytes really are the declared type (magic bytes), so a
 * file can never be served as something it is not.
 */
export function decodeDataUrl(
  dataUrl: string,
  allowed: readonly string[],
  maxBytes: number,
): { bytes: Uint8Array; contentType: string } {
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error("unsupported data URL");
  const [, contentType = "", base64 = ""] = match;
  if (!allowed.includes(contentType)) throw new Error(`type ${contentType} is not allowed`);
  const bytes = new Uint8Array(Buffer.from(base64, "base64"));
  if (bytes.length === 0) throw new Error("file is empty");
  if (bytes.length > maxBytes) throw new Error("file too large");
  if (!MAGIC[contentType]?.(bytes)) throw new Error("file bytes do not match their type");
  return { bytes, contentType };
}

/** Decode a `data:image/...;base64,` screenshot and verify it really is that image type. */
export function decodeImageDataUrl(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  return decodeDataUrl(dataUrl, ["image/png", "image/jpeg", "image/webp"], 8 * 1024 * 1024);
}
