import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { env } from "./env";

// Local-disk storage driver (blueprint F-096). The S3 driver implements the same three calls.
export interface StorageDriver {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: ReadableStream; bytes: number } | null>;
  remove(key: string): Promise<void>;
}

const KEY_PATTERN = /^[a-z0-9-]+\/[a-z0-9-]+\.(png|jpe?g|webp)$/;

function fsDriver(root: string): StorageDriver {
  const base = resolve(root, "assets");
  const pathOf = (key: string) => {
    if (!KEY_PATTERN.test(key)) throw new Error(`refusing storage key ${key}`);
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

let driver: StorageDriver | undefined;
export function storage(): StorageDriver {
  driver ??= fsDriver(env().ANNOTA_DATA_DIR);
  return driver;
}

const MAGIC: Record<string, (b: Uint8Array) => boolean> = {
  "image/png": (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": (b) => b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
};

/** Decode a `data:image/...;base64,` URL and verify the bytes really are that image type. */
export function decodeImageDataUrl(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("unsupported data URL");
  const contentType = match[1] as string;
  const bytes = new Uint8Array(Buffer.from(match[2] as string, "base64"));
  if (bytes.length > 8 * 1024 * 1024) throw new Error("image too large");
  if (!MAGIC[contentType]?.(bytes)) throw new Error("image bytes do not match their type");
  return { bytes, contentType };
}
