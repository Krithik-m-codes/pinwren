// Loading a session-replay asset (gzip of a JSON array of rrweb 2.x events, wave-4 contract §3).

export type RrwebEvent = { type: number; timestamp: number; data?: { width?: number; height?: number } };

/**
 * Most decompressed bytes read from one replay. Uploads are ≤ 10 MB of gzip, but gzip can expand
 * a thousandfold: a crafted asset must not exhaust the viewer's memory (ADR 0021).
 */
export const MAX_REPLAY_DECOMPRESSED = 64 * 1024 * 1024;

export class ReplayTooLargeError extends Error {
  constructor() {
    super("This replay is too large to play.");
  }
}

/** Read a stream to text, stopping (and cancelling it) once `max` bytes have arrived. */
async function readCapped(stream: ReadableStream<Uint8Array>, max: number): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new ReplayTooLargeError();
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

export async function loadReplayEvents(res: Response, max = MAX_REPLAY_DECOMPRESSED): Promise<RrwebEvent[]> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!gzipped && bytes.byteLength > max) throw new ReplayTooLargeError();
  const text = gzipped
    ? await readCapped(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")), max)
    : new TextDecoder().decode(bytes);
  const events: unknown = JSON.parse(text);
  if (!Array.isArray(events)) throw new Error("Not a replay");
  return (events as RrwebEvent[])
    .filter((e) => typeof e.timestamp === "number")
    .sort((a, b) => a.timestamp - b.timestamp);
}
