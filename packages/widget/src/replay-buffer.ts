// Rolling session-replay buffer (F-007, blueprint 05 §7, wave-4 §3). Pure, so it is unit-tested without
// rrweb or a browser.
//
// rrweb starts a fresh full snapshot every `checkoutEveryNms` (a Meta event followed by a FullSnapshot).
// Each snapshot opens a *segment*; a segment plays on its own, so old ones can be dropped whole. Events are
// kept serialised: one string per event is both the smallest thing to hold in memory and an exact size.

/** rrweb's EventType.Meta: the first event of every full snapshot. */
export const META = 4;

type Segment = { start: number; events: string[]; chars: number };

/** A copy of the buffer at one moment (the bug report keeps what led up to opening it). */
export type Frozen = { events: string[]; first: number; last: number };

export class ReplayBuffer {
  private segs: Segment[] = [];
  private total = 0;
  private lastAt = 0;

  /**
   * @param windowMs keep at least this much history (the oldest kept segment may start a little earlier)
   * @param maxChars memory cap, in characters of serialised JSON
   */
  constructor(
    private readonly windowMs: number,
    private readonly maxChars: number,
  ) {}

  get chars() {
    return this.total;
  }
  get segments() {
    return this.segs.length;
  }
  get events() {
    let n = 0;
    for (const s of this.segs) n += s.events.length;
    return n;
  }

  /**
   * Add one serialised event. Returns false when the current segment alone is over the memory cap: the
   * recorder should then take a new full snapshot (or stop, if that snapshot is itself too big).
   */
  push(json: string, type: number, timestamp: number): boolean {
    let seg = this.segs.at(-1);
    if (type === META || !seg) {
      seg = { start: timestamp, events: [], chars: 0 };
      this.segs.push(seg);
    }
    // Events before the first full snapshot can't be played; rrweb always starts with one anyway.
    seg.events.push(json);
    seg.chars += json.length;
    this.total += json.length;
    this.lastAt = Math.max(this.lastAt, timestamp);
    this.trim(timestamp);
    while (this.total > this.maxChars && this.segs.length > 1) this.drop();
    return this.total <= this.maxChars;
  }

  /** Drop segments that ended before the window: the second-oldest already covers it. */
  trim(now: number) {
    while (this.segs.length > 1 && (this.segs[1]?.start ?? Infinity) <= now - this.windowMs) this.drop();
  }

  private drop() {
    const s = this.segs.shift();
    if (s) this.total -= s.chars;
  }

  /** The events of the last `windowMs` (from the full snapshot before it), or null when there's nothing to play. */
  freeze(now = Date.now()): Frozen | null {
    this.trim(now);
    const first = this.segs[0];
    if (!first || first.events.length < 2) return null;
    return { events: this.segs.flatMap((s) => s.events), first: first.start, last: this.lastAt };
  }

  clear() {
    this.segs = [];
    this.total = 0;
  }
}

/** Gzip the events as one JSON array, without ever building the whole string. */
export async function gzipEvents(events: readonly string[]): Promise<Blob> {
  const parts: string[] = ["["];
  for (const [i, e] of events.entries()) parts.push(i ? "," : "", e);
  parts.push("]");
  const stream = new Blob(parts).stream().pipeThrough(new CompressionStream("gzip"));
  const gz = await new Response(stream).arrayBuffer();
  return new Blob([gz], { type: "application/gzip" });
}

export function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      resolve(typeof r.result === "string" ? r.result : "");
    };
    r.onerror = () => {
      reject(r.error ?? new Error("Couldn't read the replay"));
    };
    r.readAsDataURL(blob);
  });
}
