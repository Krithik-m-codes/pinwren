import { vi } from "vitest";
import type { EventSourceLike } from "./api/base";
import { makeStore } from "./store";

export const API = "http://pinwren.test/api";

type Handler = (req: Request, url: URL) => Response | Promise<Response> | undefined;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const problem = (status: number, code: string, title: string) =>
  new Response(JSON.stringify({ status, code, title }), {
    status,
    headers: { "content-type": "application/problem+json" },
  });

/** `fetch` stubbed with route handlers; every request is recorded as `METHOD /path?query`. */
export function mockFetch(handler: Handler) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    const text = req.method === "GET" ? "" : await req.clone().text();
    calls.push({
      method: req.method,
      path: url.pathname.replace(/^\/api/, "") + url.search,
      body: text ? JSON.parse(text) : undefined,
    });
    const res = await handler(req, url);
    return res ?? problem(404, "NOT_FOUND", `No mock for ${req.method} ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fn };
}

/** A controllable EventSource: tests open, emit and close it. */
export class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  readyState = 0;
  onopen: ((ev: Event) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  closed = false;
  private listeners = new Map<string, ((ev: MessageEvent<string>) => void)[]>();
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (ev: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  emit(event: string, data: unknown, id = "") {
    const ev = new MessageEvent<string>(event, { data: JSON.stringify(data), lastEventId: id });
    for (const l of this.listeners.get(event) ?? []) l(ev);
  }
  /** The server ended the stream for good (HTTP error): the browser won't retry on its own. */
  fail() {
    this.readyState = 2;
    this.onerror?.(new Event("error"));
  }
}

export function testStore() {
  FakeEventSource.instances = [];
  return makeStore({ apiBase: API, eventSource: (url) => new FakeEventSource(url) });
}

/** Let pending promises (fetches, listener effects) settle. */
export const flush = async (times = 5) => {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
};
