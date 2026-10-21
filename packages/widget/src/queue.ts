import type { KV } from "./idb";

// Offline outbox (F-010). A report whose submit failed for a transient reason (offline, 5xx, 429, timeout)
// is stored with its clientId and retried with exponential backoff, on every `online` event and on the
// next page load. The server dedupes on clientId, so a retry that races a slow success is harmless.

export type Queued<P = unknown> = {
  clientId: string;
  project: string;
  payload: P;
  attempts: number;
  nextAt: number;
  createdAt: number;
};

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Worth retrying later: no response at all, a server error, rate limiting or a timeout. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError)
    return err.status === 0 || err.status >= 500 || err.status === 408 || err.status === 429;
  return err instanceof TypeError; // fetch() rejects with TypeError when the network is down
}

const BASE = 2_000;
const CAP = 5 * 60_000;
export const MAX_AGE = 7 * 24 * 3600_000;

/** 2 s, 4 s, 8 s … capped at 5 min, with ±20 % jitter so many tabs don't retry in lockstep. */
export function backoff(attempts: number, random = Math.random): number {
  const d = Math.min(CAP, BASE * 2 ** Math.max(0, attempts - 1));
  return Math.round(d * (0.8 + random() * 0.4));
}

type Opts<P, R> = {
  kv: KV<Queued<P>>;
  project: string;
  send: (payload: P) => Promise<R>;
  onSent?: (item: Queued<P>, result: R) => void;
  onDropped?: (item: Queued<P>, err: unknown) => void;
  onChange?: (pending: number) => void;
  now?: () => number;
  random?: () => number;
};

export class Outbox<P, R> {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushing: Promise<void> | null = null;
  private stopped = false;

  constructor(private readonly o: Opts<P, R>) {}

  private now() {
    return this.o.now?.() ?? Date.now();
  }

  async pending(): Promise<Queued<P>[]> {
    return (await this.o.kv.all()).filter((q) => q.project === this.o.project);
  }

  async add(clientId: string, payload: P): Promise<void> {
    const now = this.now();
    const item: Queued<P> = {
      clientId,
      project: this.o.project,
      payload,
      attempts: 1,
      nextAt: now + backoff(1, this.o.random),
      createdAt: now,
    };
    await this.o.kv.set(clientId, item);
    await this.changed();
    this.arm();
  }

  /** Send every due item (all of them when `force`, e.g. on `online`). Concurrent calls share one run. */
  flush(force = false): Promise<void> {
    this.flushing ??= this.run(force).finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async run(force: boolean) {
    for (const item of await this.pending()) {
      if (this.stopped) return;
      const now = this.now();
      if (now - item.createdAt > MAX_AGE) {
        await this.o.kv.del(item.clientId);
        this.o.onDropped?.(item, new Error("expired"));
        continue;
      }
      if (!force && item.nextAt > now) continue;
      try {
        const res = await this.o.send(item.payload);
        await this.o.kv.del(item.clientId);
        this.o.onSent?.(item, res);
      } catch (err) {
        if (isRetryable(err)) {
          item.attempts++;
          item.nextAt = this.now() + backoff(item.attempts, this.o.random);
          await this.o.kv.set(item.clientId, item);
        } else {
          // The server refused it for good (validation, origin) — retrying would never succeed.
          await this.o.kv.del(item.clientId);
          this.o.onDropped?.(item, err);
        }
      }
    }
    await this.changed();
    this.arm();
  }

  private async changed() {
    this.o.onChange?.((await this.pending()).length);
  }

  /** One timer for the earliest due item. */
  private async arm() {
    clearTimeout(this.timer);
    if (this.stopped) return;
    const next = Math.min(...(await this.pending()).map((q) => q.nextAt));
    if (!Number.isFinite(next) || this.stopped) return;
    this.timer = setTimeout(() => void this.flush(), Math.max(0, next - this.now()));
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }
}
