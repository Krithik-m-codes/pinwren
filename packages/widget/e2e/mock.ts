import type { Page, Route } from "@playwright/test";

// In-memory implementation of the widget API (docs/contracts/wave-1.md), installed with page.route so the
// suite needs no server, database or Docker.

export type Item = {
  id: string;
  number: number;
  kind: string;
  status: string;
  title: string | null;
  body: string;
  anchor: Record<string, unknown> | null;
  createdAt: string;
  reporterName: string | null;
  replyCount: number;
  token?: string;
  replies: { id: string; body: string; createdAt: string; authorName: string | null; team: boolean }[];
  url?: string | undefined;
  clientId?: string | undefined;
  /** The full POST body, for assertions on screenshots, attachments and diagnostics. */
  payload?: Record<string, unknown>;
};

export type Mock = {
  items: Item[];
  /** How POST /w/feedback answers: normally 201; a number forces that status (e.g. 503). */
  postStatus: number | null;
  /** When true, POST /w/feedback fails like a dead network (page.route ignores context.setOffline). */
  offline: boolean;
  requests: { method: string; path: string; headers: Record<string, string>; body: unknown }[];
};

/** What the widget POSTs/PATCHes; only the fields the mock reads. */
type Body = {
  clientId?: string;
  kind?: string;
  body?: string;
  title?: string;
  anchor?: Record<string, unknown>;
  reporter?: { name?: string };
  author?: { name?: string };
  page?: { url?: string };
  status?: string;
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type WidgetCfg = DeepPartial<{
  launcher: Record<string, unknown>;
  modes: { comment: boolean; bug: boolean };
  shortcuts: boolean;
  rightClickComment: boolean;
  readOnly: boolean;
  visitorsCanResolve: boolean;
  consent: { enabled: boolean; text: string | null; privacyUrl: string | null };
  panelActions: Record<string, unknown>[];
  privacyMode: boolean;
  visibility: { environments: "all" | "non-production"; minViewportWidth: number };
}>;

const CLOSED = ["resolved", "wont_fix", "duplicate"];

/** An anchor bundle pointing at `[data-testid=testId]` with the given pin/region. */
export function anchorFor(testId: string, tag: string, text: string, pin: Record<string, number>) {
  return {
    v: 1,
    attrs: { testId },
    css: `[data-testid="${testId}"]`,
    xpath: "/html/body",
    text: { content: text, prefix: "", suffix: "" },
    tag,
    structure: { depth: 3, siblingIndex: 0, childTagsHash: "x" },
    rect: { x: 0, y: 0, w: 100, h: 100, vw: 1280, vh: 800, scrollY: 0 },
    pin,
  };
}

export function seed(partial: Partial<Item> & { number: number }): Item {
  return {
    id: `fb_${partial.number}`,
    kind: "comment",
    status: "open",
    title: null,
    body: "Seeded comment",
    anchor: null,
    createdAt: new Date(Date.now() - 3600_000).toISOString(),
    reporterName: "Sarah Miller",
    replyCount: 0,
    replies: [],
    ...partial,
  };
}

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

export async function mockApi(
  page: Page,
  opts: {
    widget?: WidgetCfg;
    items?: Item[];
    publicRead?: boolean;
    capture?: Record<string, unknown>;
    /** `branding` block of /w/config (wave-3 §2); omitted like an older server when not given. */
    branding?: Record<string, unknown>;
  } = {},
): Promise<Mock> {
  const mock: Mock = { items: opts.items ?? [], requests: [], postStatus: null, offline: false };
  const widget = opts.widget ?? {};
  // Tests need to look inside the widget; Playwright cannot pierce a closed shadow root, so force it open.
  await page.addInitScript(() => {
    // Re-invoked below with the element as `this`.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init: ShadowRootInit) {
      return attach.call(this, { ...init, mode: "open" });
    };
  });

  await page.route("**/w/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/w/, "");
    const raw = req.postData();
    const parsed: unknown = raw ? JSON.parse(raw) : undefined;
    const body = (parsed ?? {}) as Body;
    const headers = req.headers();
    mock.requests.push({ method: req.method(), path: `${path}${url.search}`, headers, body: parsed });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204 });

    if (path === "/config")
      return json(route, 200, {
        project: { name: "Lumen", slug: "lumen", publicRead: opts.publicRead ?? true },
        widget,
        ...(opts.branding ? { branding: opts.branding } : {}),
        capture: {
          console: "warnings",
          network: "failures",
          screenshotOnComment: false,
          maskSelectors: [],
          ...opts.capture,
        },
      });

    if (path === "/feedback" && req.method() === "GET") {
      const closed = url.searchParams.get("include") === "closed";
      const items = mock.items
        .filter((i) => closed || !CLOSED.includes(i.status))
        .map(({ replies: _r, token: _t, url: _u, clientId: _c, payload: _p, ...rest }) => rest);
      return json(route, 200, { items });
    }

    if (path === "/feedback" && req.method() === "POST") {
      if (mock.offline) return route.abort("internetdisconnected");
      if (mock.postStatus) return json(route, mock.postStatus, { title: "Service unavailable" });
      // Server-side dedupe on clientId (contract §2): a replay returns the original, without the token.
      const dupe = mock.items.find((i) => i.clientId === body.clientId);
      if (dupe) return json(route, 200, { feedback: { id: dupe.id, number: dupe.number } });
      const number = mock.items.reduce((n, i) => Math.max(n, i.number), 0) + 1;
      const item: Item = seed({
        number,
        kind: body.kind ?? "comment",
        body: body.body ?? "",
        title: body.title ?? null,
        anchor: body.anchor ?? null,
        reporterName: body.reporter?.name ?? null,
        createdAt: new Date().toISOString(),
        token: `tok_${number}`,
        url: body.page?.url,
        clientId: body.clientId,
        payload: parsed as Record<string, unknown>,
      });
      mock.items.push(item);
      return json(route, 201, { feedback: { id: item.id, number, reporterToken: item.token } });
    }

    const m = /^\/feedback\/([^/]+)(\/comments)?$/.exec(path);
    const id = m?.[1];
    const item = id === undefined ? undefined : mock.items.find((i) => i.id === decodeURIComponent(id));
    if (!item) return json(route, 404, { title: "Not found" });

    const comments = m?.[2] !== undefined;
    if (comments && req.method() === "GET") return json(route, 200, { items: item.replies });
    if (comments && req.method() === "POST") {
      const comment = {
        id: `c_${item.replies.length + 1}`,
        body: body.body ?? "",
        createdAt: new Date().toISOString(),
        authorName: body.author?.name ?? null,
        team: false,
      };
      item.replies.push(comment);
      item.replyCount++;
      return json(route, 201, { comment });
    }
    if (req.method() === "PATCH") {
      const allowed =
        widget.visitorsCanResolve !== false || headers["x-pinwren-reporter-token"] === item.token;
      if (!allowed) return json(route, 403, { title: "You can't resolve this", code: "RESOLVE_NOT_ALLOWED" });
      item.status = body.status ?? item.status;
      return json(route, 200, { feedback: { id: item.id, status: item.status } });
    }
    return json(route, 405, { title: "Method not allowed" });
  });
  return mock;
}
