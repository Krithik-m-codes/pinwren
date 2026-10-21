import { type Key, t } from "./i18n";

// Report attachments (wave-1 contract §2): at most 3 files, ≤ 5 MB each, images or PDF.

export const MAX_FILES = 3;
export const MAX_BYTES = 5 * 1024 * 1024;
export const FILE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"];

export type Attachment = { name: string; contentType: string; dataUrl: string; size: number };

type FileLike = { name: string; type: string; size: number };

/** Split incoming files into those that fit and human-readable reasons for the rest. */
export function validateFiles<F extends FileLike>(
  current: number,
  files: readonly F[],
): { accepted: F[]; errors: string[] } {
  const accepted: F[] = [];
  const errors: string[] = [];
  for (const f of files) {
    const name = f.name || "file";
    let err: [Key, Record<string, string | number>] | null = null;
    if (!FILE_TYPES.includes(f.type)) err = ["badFileType", { name }];
    else if (f.size > MAX_BYTES) err = ["fileTooBig", { name }];
    else if (current + accepted.length >= MAX_FILES) err = ["tooManyFiles", { n: MAX_FILES }];
    if (err) {
      const msg = t(err[0], err[1]);
      if (!errors.includes(msg)) errors.push(msg);
    } else accepted.push(f);
  }
  return { accepted, errors };
}

/** Pasted images arrive as "image.png" — give them a readable, unique-ish name. */
export function fileName(f: FileLike, now = new Date()): string {
  if (f.name && f.name !== "image.png") return f.name.slice(0, 200);
  const ext = f.type.split("/")[1] ?? "png";
  return `pasted-${now.toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${ext}`;
}

export function readFile(f: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () =>
      resolve({ name: fileName(f), contentType: f.type, dataUrl: String(r.result), size: f.size });
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(f);
  });
}

/** Restored attachments come from IndexedDB, which the page can write — re-check every field. */
export function sanitizeAttachments(raw: unknown): Attachment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (a): a is Attachment =>
        !!a &&
        typeof a.name === "string" &&
        FILE_TYPES.includes(a.contentType) &&
        typeof a.dataUrl === "string" &&
        a.dataUrl.startsWith(`data:${a.contentType};base64,`) &&
        typeof a.size === "number" &&
        a.size <= MAX_BYTES,
    )
    .slice(0, MAX_FILES);
}
