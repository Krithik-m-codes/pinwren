// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pin } from "./api";
import { DEFAULT_CONFIG, type WidgetConfig } from "./config";
import { Panel, type PanelHost, type PanelRow, pathOf, statsOf } from "./panel";
import { store } from "./store";

const pin = (over: Partial<Pin> = {}): Pin => ({
  id: "a",
  number: 1,
  kind: "comment",
  status: "open",
  title: null,
  body: "Logo too small",
  anchor: null,
  createdAt: "2026-10-21T10:00:00.000Z",
  reporterName: "Sarah Miller",
  replyCount: 0,
  ...over,
});

const PAGE = "https://shop.example/pricing";

function setup(rows: PanelRow[], over: { cfg?: Partial<WidgetConfig>; remote?: Pin[] | Error } = {}) {
  const api = {
    endpoint: "https://feedback.example/deploy///",
    pins: vi.fn(() =>
      over.remote instanceof Error
        ? Promise.reject(over.remote)
        : Promise.resolve({ items: over.remote ?? [] }),
    ),
    setStatus: vi.fn((id: string, status: string) => Promise.resolve({ feedback: { id, status } })),
    remove: vi.fn(() => Promise.resolve({})),
  };
  const host: PanelHost = {
    root: document.body.appendChild(document.createElement("div")),
    cfg: { ...DEFAULT_CONFIG, ...over.cfg },
    projectKey: "pk_test",
    api,
    rows: () => rows,
    canComment: true,
    shortcuts: true,
    openItem: vi.fn(),
    close: vi.fn(),
    pageUrl: () => PAGE,
    toast: vi.fn(),
    refresh: vi.fn(),
  };
  const refresh = vi.fn();
  host.refresh = refresh;
  const panel = new Panel(host);
  const cards = () => Array.from(panel.el.querySelectorAll<HTMLElement>(".fcard"));
  const button = (text: string, inside: ParentNode = panel.el) =>
    Array.from(inside.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent.trim() === text,
    );
  return { panel, host, api, cards, button, refresh };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("helpers", () => {
  it("counts open, resolved and bugs with the resolved share", () => {
    expect(
      statsOf([
        { kind: "bug", status: "open" },
        { kind: "bug", status: "resolved" },
        { kind: "idea", status: "wont_fix" },
        { kind: "comment", status: "in_progress" },
      ]),
    ).toEqual({ open: 2, resolved: 2, bugs: 2, pct: 50 });
    expect(statsOf([])).toEqual({ open: 0, resolved: 0, bugs: 0, pct: 0 });
  });

  it("shows a page as its path and query", () => {
    expect(pathOf("https://shop.example/pricing?plan=pro")).toBe("/pricing?plan=pro");
    expect(pathOf(null)).toBe("");
    expect(pathOf("not a url")).toBe("not a url");
  });
});

describe("sidebar", () => {
  it("opens this project's portal with reporter access only in the fragment, including read-only projects", () => {
    store.addMine("pk_test", { id: "a", token: "reporter_token_0123456789" });
    const { panel } = setup([], { cfg: { readOnly: true } });
    const link = panel.el.querySelector<HTMLAnchorElement>("a.portal");
    expect(link?.textContent).toBe("Open my feedback");
    expect(link?.target).toBe("_blank");
    expect(link?.rel).toBe("noopener noreferrer");
    const url = new URL(link?.href ?? "https://missing.example");
    expect(url.origin + url.pathname).toBe("https://feedback.example/deploy/guest/pk_test");
    expect(url.search).toBe("");
    expect(JSON.parse(decodeURIComponent(url.hash.slice(8)))).toEqual({
      reporterTokens: ["reporter_token_0123456789"],
      pageTokens: [],
    });
  });

  it("has no portal entry without saved reporter access or when storage is blocked", () => {
    expect(setup([]).panel.el.querySelector("a.portal")).toBeNull();
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      expect(setup([]).panel.el.querySelector("a.portal")).toBeNull();
    } finally {
      get.mockRestore();
    }
  });

  it("ignores malformed saved credentials and refreshes the entry when access is removed", () => {
    for (const raw of [
      "not json",
      "null",
      "{}",
      '[null,{}, {"id":"a","token":123}, {"id":"tmp:a","token":"reporter_token_0123456789"}]',
    ]) {
      localStorage.setItem("pinwren:mine:pk_test", raw);
      const { panel } = setup([]);
      expect(panel.el.querySelector("a.portal")).toBeNull();
      panel.destroy();
    }
    store.addMine("pk_test", { id: "a", token: "reporter_token_0123456789" });
    const { panel } = setup([]);
    expect(panel.el.querySelector("a.portal")).not.toBeNull();
    localStorage.removeItem("pinwren:mine:pk_test");
    panel.render();
    expect(panel.el.querySelector("a.portal")).toBeNull();
  });
  const rows: PanelRow[] = [
    { pin: pin({ id: "a", number: 1, kind: "bug" }), onPage: true, moved: false },
    {
      pin: pin({ id: "b", number: 2, kind: "idea", status: "resolved", body: "Use the darker blue" }),
      onPage: true,
      moved: false,
    },
    {
      pin: pin({ id: "c", number: 3, kind: "question", createdAt: "2026-10-21T11:00:00.000Z" }),
      onPage: true,
      moved: false,
    },
  ];

  it("shows the stats row and every item, newest first", () => {
    const { panel, cards } = setup(rows);
    expect(panel.el.querySelector(".stats")?.textContent).toContain("2Open");
    expect(panel.el.querySelector(".stats")?.textContent).toContain("1Resolved");
    expect(panel.el.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow")).toBe("33");
    expect(cards().map((c) => c.querySelector(".num")?.textContent)).toEqual(["#3", "#1", "#2"]);
  });

  it("filters by status, type, search and sorts oldest first", () => {
    const { panel, cards, button } = setup(rows);
    button("Resolved")?.click();
    expect(cards()).toHaveLength(1);
    button("All")?.click();
    // Type menu: pick "Bug".
    panel.el.querySelector<HTMLButtonElement>(".drop")?.click();
    const bug = Array.from(panel.el.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]")).find(
      (b) => b.textContent === "Bug",
    );
    bug?.click();
    expect(cards().map((c) => c.querySelector(".num")?.textContent)).toEqual(["#1"]);
    panel.el.querySelector<HTMLButtonElement>(".drop")?.click();
    Array.from(panel.el.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]"))[0]?.click();
    const search = panel.el.querySelector<HTMLInputElement>("input[type=search]");
    if (!search) throw new Error("no search");
    search.value = "darker";
    search.dispatchEvent(new Event("input"));
    expect(cards()).toHaveLength(1);
    search.value = "";
    search.dispatchEvent(new Event("input"));
    button("Newest first")?.click();
    expect(cards().map((c) => c.querySelector(".num")?.textContent)).toEqual(["#1", "#2", "#3"]);
  });

  it("offers Resolve only when visitors may resolve, and Delete only for the visitor's own items", () => {
    store.addMine("pk_test", { id: "a", token: "tok-a" });
    const locked = setup(rows);
    expect(locked.cards()[0]?.textContent).not.toContain("Resolve"); // #3, someone else's
    expect(locked.cards()[1]?.textContent).toContain("Delete"); // #1, mine
    expect(locked.cards()[0]?.textContent).not.toContain("Delete");
    document.body.innerHTML = "";
    const open = setup(rows, { cfg: { visitorsCanResolve: true } });
    expect(open.cards()[0]?.textContent).toContain("Resolve");
    const ro = setup(rows, { cfg: { readOnly: true } });
    expect(ro.panel.el.querySelector(".facts")).toBeNull();
  });

  it("asks before deleting, then deletes with the reporter token", async () => {
    store.addMine("pk_test", { id: "a", token: "tok-a" });
    const { panel, api, refresh, cards, button } = setup(rows);
    button("Delete", cards()[1])?.click();
    const confirm = panel.el.querySelector<HTMLElement>(".confirm");
    expect(confirm?.hidden).toBe(false);
    expect(api.remove).not.toHaveBeenCalled();
    button("Delete", confirm ?? undefined)?.click();
    await flush();
    expect(api.remove).toHaveBeenCalledWith("a", "tok-a");
    expect(refresh).toHaveBeenCalled();
    expect(cards()).toHaveLength(2);
  });

  it("resolves the selected items in bulk", async () => {
    const { panel, api, button } = setup(rows, { cfg: { visitorsCanResolve: true } });
    panel.el.querySelector<HTMLButtonElement>(".selbar .check")?.click();
    expect(panel.el.querySelector(".selbar")?.textContent).toContain("3 selected");
    button("Resolve", panel.el.querySelector(".selbar") ?? undefined)?.click();
    await flush();
    // #2 is resolved already.
    expect(api.setStatus.mock.calls.map((c) => c[0]).sort()).toEqual(["a", "c"]);
  });

  it("lists every page under All pages, linking items of other pages", async () => {
    const other = pin({ id: "z", number: 9, pageUrl: "https://shop.example/about" });
    const { panel, api, cards, button } = setup(rows, { remote: [rows[0]?.pin ?? pin(), other] });
    button("All pages")?.click();
    await flush();
    expect(api.pins).toHaveBeenCalledWith("", true);
    expect(cards()).toHaveLength(2);
    expect(panel.el.textContent).toContain("/about");
  });

  it("shows a retry when All pages can't load", async () => {
    const { panel, button } = setup(rows, { remote: new Error("offline") });
    button("All pages")?.click();
    await flush();
    expect(panel.el.querySelector("[role=alert]")?.textContent).toContain("Couldn't load feedback");
    expect(button("Retry")).toBeTruthy();
  });

  it("has an empty state", () => {
    const { panel } = setup([]);
    expect(panel.el.querySelector(".empty")?.textContent).toContain("No feedback yet");
  });
});
