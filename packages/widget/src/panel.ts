import type { Pin, WidgetApi } from "./api";
import type { WidgetConfig } from "./config";
import { adoptStyle, focused, h, icon } from "./dom";
import { errText } from "./env";
import { cleanPageUrl, deepLink, download, fileName, toCsv, toJson, toRows } from "./export";
import { addEnglish, t, tn } from "./i18n";
import * as I from "./icons";
import { enPanel } from "./locales/en-panel";
import { PANEL_CSS } from "./panel-styles";
import { store } from "./store";
import { threadCard } from "./thread";
import { ago, isClosed, KIND_LIST, type Kind, kindOf, tag } from "./ui";

// The sidebar — the lazy widget-panel.js chunk (F-011, SitePing-style): stats, search, type / status /
// page / "mine" filters, sort and grouping, bulk resolve and delete, export (F-018); plus the thread card
// (thread.ts). The panel owns its DOM and filters; the core owns the page's pins and tells it when to
// re-render. "All pages" lists the whole project from `GET /w/feedback` without a page URL.

addEnglish(enPanel);

export type PanelRow = { pin: Pin; onPage: boolean; moved: boolean };

export type PanelHost = {
  root: HTMLElement;
  cfg: WidgetConfig;
  projectKey: string;
  api: Pick<WidgetApi, "pins" | "setStatus" | "remove">;
  /** This page's items: placed markers plus page-level and unplaced ones. */
  rows(): PanelRow[];
  canComment: boolean;
  shortcuts: boolean;
  /** Scroll to the item's marker, flash it and open its thread. */
  openItem(row: PanelRow): void;
  close(): void;
  pageUrl(): string;
  toast(text: string): void;
  /** Statuses changed or items were deleted: the core re-lists the page's markers (and re-renders us). */
  refresh(): void;
};

type Status = "all" | "open" | "resolved";
type Scope = "page" | "all";
type Remote = { state: "idle" | "loading" | "error" | "ready"; items: Pin[] };

/** A segmented control: `aria-pressed` buttons, exactly one of them on. */
function seg<T extends string>(label: string, opts: [T, string][], value: T, pick: (v: T) => void) {
  const buttons = opts.map(([v, text]) =>
    h("button", { type: "button", "aria-pressed": String(v === value), onclick: () => pick(v) }, text),
  );
  return {
    el: h("div", { class: "seg", role: "group", "aria-label": label }, ...buttons),
    set: (v: T) => {
      for (const [i, b] of buttons.entries()) b.setAttribute("aria-pressed", String(opts[i]?.[0] === v));
    },
  };
}

/** "/pricing?plan=pro" for display and grouping. */
export function pathOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

/** Open / resolved / bug counts and the resolved share, as the stats row shows them. */
export function statsOf(pins: readonly { kind: string; status: string }[]) {
  const open = pins.filter((p) => !isClosed(p.status)).length;
  const resolved = pins.length - open;
  return {
    open,
    resolved,
    bugs: pins.filter((p) => p.kind === "bug").length,
    pct: pins.length ? Math.round((resolved / pins.length) * 100) : 0,
  };
}

export class Panel {
  readonly el: HTMLElement;
  private q = "";
  private type: Kind | "all" = "all";
  private status: Status = "all";
  private scope: Scope = "page";
  private mineOnly = false;
  private oldest = false;
  private group = false;
  private readonly selected = new Set<string>();
  /** Deleted from here: hidden at once, before the core's re-list comes back. */
  private readonly gone = new Set<string>();
  private remote: Remote = { state: "idle", items: [] };
  private busy = false;

  private readonly list = h("div", { class: "plist", role: "list" });
  private readonly stats = h("div", { class: "stats" });
  private readonly selbar = h("div", { class: "selbar" });
  private readonly confirmBox = h("div", {
    class: "confirm",
    role: "alertdialog",
    "aria-labelledby": "pw-confirm",
    hidden: true,
  });
  private readonly delAll: HTMLButtonElement;
  private readonly typeBtn: HTMLButtonElement;
  private readonly sortBtn: HTMLButtonElement;
  private readonly groupBtn: HTMLButtonElement;
  private readonly mineBtn: HTMLButtonElement;
  private readonly statusSeg: ReturnType<typeof seg<Status>>;
  private readonly scopeSeg: ReturnType<typeof seg<Scope>>;
  private readonly xbtn: HTMLButtonElement;
  private pop: { menu: HTMLElement; anchor: HTMLButtonElement } | null = null;
  private readonly away = (e: Event) => {
    const p = this.pop;
    const path = e.composedPath();
    if (p && !path.includes(p.menu) && !path.includes(p.anchor)) this.closePop();
  };

  constructor(private readonly host: PanelHost) {
    adoptStyle(host.root, "panel", PANEL_CSS);
    const search = h("input", {
      type: "search",
      placeholder: t("search"),
      "aria-label": t("searchFeedback"),
    });
    search.addEventListener("input", () => {
      this.q = search.value;
      this.render();
    });
    this.xbtn = h(
      "button",
      {
        class: "btn sm",
        "aria-haspopup": "menu",
        "aria-expanded": "false",
        onclick: () => this.toggleExport(),
      },
      icon(I.download),
      t("exportComments"),
    );
    this.delAll = h(
      "button",
      {
        class: "btn sm",
        onclick: () => this.deleteRows(this.visible().filter((r) => this.canDelete(r.pin))),
      },
      icon(I.trash),
      t("deleteAll"),
    );
    this.typeBtn = h("button", {
      class: "btn sm drop",
      "aria-haspopup": "menu",
      "aria-expanded": "false",
      onclick: () => this.toggleType(),
    });
    this.statusSeg = seg<Status>(
      t("filter"),
      [
        ["all", t("filterAll")],
        ["open", t("filterOpen")],
        ["resolved", t("filterResolved")],
      ],
      this.status,
      (v) => {
        this.status = v;
        this.statusSeg.set(v);
        this.render();
      },
    );
    this.scopeSeg = seg<Scope>(
      t("pagesFilter"),
      [
        ["page", t("thisPage")],
        ["all", t("allPages")],
      ],
      this.scope,
      (v) => this.setScope(v),
    );
    this.mineBtn = h(
      "button",
      {
        class: "btn sm",
        "aria-pressed": "false",
        onclick: () => {
          this.mineOnly = !this.mineOnly;
          this.mineBtn.setAttribute("aria-pressed", String(this.mineOnly));
          this.render();
        },
      },
      icon(I.user),
      t("filterMine"),
    );
    this.sortBtn = h("button", {
      class: "btn sm",
      onclick: () => {
        this.oldest = !this.oldest;
        this.render();
      },
    });
    this.groupBtn = h(
      "button",
      {
        class: "btn sm",
        "aria-pressed": "false",
        onclick: () => {
          this.group = !this.group;
          this.groupBtn.setAttribute("aria-pressed", String(this.group));
          this.render();
        },
      },
      icon(I.page),
      t("byPage"),
    );
    this.el = h(
      "aside",
      { class: "panel", role: "complementary", "aria-label": t("sidebarLabel") },
      h(
        "div",
        { class: "phead" },
        h("b", { class: "ptitle" }, t("feedbackTitle")),
        h("span", { class: "grow" }),
        h("span", { class: "xwrap" }, this.xbtn),
        this.delAll,
        h(
          "button",
          { class: "ib", "aria-label": t("closeSidebar"), onclick: () => host.close() },
          icon(I.close),
        ),
      ),
      this.stats,
      h(
        "div",
        { class: "ptools" },
        h("label", { class: "search" }, icon(I.search), search),
        h("div", { class: "prow" }, h("span", { class: "xwrap" }, this.typeBtn), this.statusSeg.el),
        h("div", { class: "prow" }, this.scopeSeg.el, this.mineBtn),
        h("div", { class: "prow" }, this.sortBtn, this.groupBtn),
      ),
      this.selbar,
      this.list,
      this.confirmBox,
    );
    this.el.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      // Esc closes the innermost thing first: a menu, then the confirmation; the core closes the panel.
      if (this.pop) {
        e.stopPropagation();
        this.closePop(true);
      } else if (!this.confirmBox.hidden) {
        e.stopPropagation();
        this.cancelConfirm();
      }
    });
    host.root.append(this.el);
    this.render();
  }

  destroy() {
    this.closePop();
    this.el.remove();
  }

  // --- Data -------------------------------------------------------------------------------------------

  /** Items this browser sent, with the reporter token that lets it resolve and delete them. */
  private mine(): Map<string, string | undefined> {
    return new Map(store.mine(this.host.projectKey).map((m) => [m.id, m.token]));
  }

  private canResolve(pin: Pin): boolean {
    const { cfg } = this.host;
    if (cfg.readOnly || pin.id.startsWith("tmp:")) return false;
    return cfg.visitorsCanResolve || !!this.mine().get(pin.id);
  }

  private canDelete(pin: Pin): boolean {
    return !this.host.cfg.readOnly && !pin.id.startsWith("tmp:") && !!this.mine().get(pin.id);
  }

  private setScope(v: Scope) {
    this.scope = v;
    this.scopeSeg.set(v);
    this.selected.clear();
    if (v === "all") void this.loadAll();
    this.render();
  }

  private async loadAll() {
    this.remote = { state: "loading", items: this.remote.items };
    this.render();
    try {
      const { items } = await this.host.api.pins("", true);
      this.remote = { state: "ready", items };
    } catch {
      this.remote = { state: "error", items: [] };
    }
    if (this.el.isConnected) this.render();
  }

  /** Everything in the current scope (this page or the whole project), before the other filters. */
  private scoped(): PanelRow[] {
    const page = this.host.rows();
    const rows =
      this.scope === "page"
        ? page
        : this.remote.items.map(
            (pin) => page.find((r) => r.pin.id === pin.id) ?? { pin, onPage: false, moved: false },
          );
    return rows.filter((r) => !this.gone.has(r.pin.id));
  }

  /** What the list shows right now — and what Export and Delete all act on. */
  private visible(): PanelRow[] {
    const mine = this.mine();
    const q = this.q.trim().toLowerCase();
    const dir = this.oldest ? 1 : -1;
    return this.scoped()
      .filter(({ pin }) => this.type === "all" || kindOf(pin.kind).label === kindOf(this.type).label)
      .filter(({ pin }) =>
        this.status === "all" ? true : this.status === "open" ? !isClosed(pin.status) : isClosed(pin.status),
      )
      .filter(({ pin }) => !this.mineOnly || mine.has(pin.id) || pin.id.startsWith("tmp:"))
      .filter(
        ({ pin }) =>
          !q ||
          `${pin.title ?? ""} ${pin.body} ${pin.reporterName ?? ""} #${pin.number}`.toLowerCase().includes(q),
      )
      .sort((a, b) => dir * (Date.parse(a.pin.createdAt) - Date.parse(b.pin.createdAt)));
  }

  // --- Render -----------------------------------------------------------------------------------------

  render() {
    const all = this.scoped();
    const rows = this.visible();
    for (const id of this.selected) if (!rows.some((r) => r.pin.id === id)) this.selected.delete(id);
    this.renderStats(all);
    this.typeBtn.replaceChildren(
      icon(I.layers),
      h("span", { class: "up" }, t("type")),
      h("b", {}, this.type === "all" ? t("filterAll") : kindOf(this.type).label),
      icon(I.chevron),
    );
    this.sortBtn.replaceChildren(icon(I.sort), this.oldest ? t("oldestFirst") : t("newestFirst"));
    this.delAll.hidden = !rows.some((r) => this.canDelete(r.pin));
    this.renderSelection(rows);

    if (this.scope === "all" && this.remote.state === "loading" && !this.remote.items.length) {
      this.list.replaceChildren(
        h("div", { class: "empty", role: "status" }, h("span", { class: "spin" }), t("loadingFeedback")),
      );
      return;
    }
    if (this.scope === "all" && this.remote.state === "error") {
      this.list.replaceChildren(
        h(
          "div",
          { class: "empty", role: "alert" },
          h("b", {}, t("feedbackFailed")),
          h("button", { class: "btn sm", onclick: () => void this.loadAll() }, t("retry")),
        ),
      );
      return;
    }
    if (!rows.length) {
      const { canComment, shortcuts } = this.host;
      const filtered = all.length > 0;
      this.list.replaceChildren(
        h(
          "div",
          { class: "empty" },
          h("b", {}, filtered ? (this.mineOnly ? t("nothingFromYou") : t("noMatches")) : t("noFeedback")),
          h(
            "span",
            { class: "muted" },
            filtered
              ? t("tryFilters")
              : canComment
                ? shortcuts
                  ? t("pressC")
                  : t("usePlus")
                : t("willShowHere"),
          ),
        ),
      );
      return;
    }
    if (!this.group) {
      this.list.replaceChildren(...rows.map((r) => this.card(r)));
      return;
    }
    const groups = new Map<string, PanelRow[]>();
    for (const r of rows) {
      const key = pathOf(r.pin.pageUrl ?? (r.onPage ? this.host.pageUrl() : null)) || t("unknownPage");
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    this.list.replaceChildren(
      ...[...groups].flatMap(([path, items]) => [
        h(
          "div",
          { class: "group" },
          icon(I.page),
          h("span", { class: "grow" }, path),
          h("span", { class: "chip" }, String(items.length)),
        ),
        ...items.map((r) => this.card(r)),
      ]),
    );
  }

  private renderStats(all: PanelRow[]) {
    const s = statsOf(all.map((r) => r.pin));
    const stat = (cls: string, n: number, label: string) =>
      h("span", { class: `stat ${cls}` }, h("i", { "aria-hidden": "true" }), h("b", {}, String(n)), label);
    this.stats.replaceChildren(
      h(
        "div",
        { class: "srow" },
        stat("open", s.open, t("filterOpen")),
        stat("done", s.resolved, t("filterResolved")),
        stat("bugs", s.bugs, t("statBugs")),
      ),
      h(
        "div",
        { class: "srow" },
        h(
          "span",
          {
            class: "bar",
            role: "progressbar",
            "aria-valuemin": "0",
            "aria-valuemax": "100",
            "aria-valuenow": String(s.pct),
            "aria-label": t("pctResolved", { n: s.pct }),
          },
          h("span", { style: `width:${s.pct}%` }),
        ),
        h("span", { class: "muted" }, t("pctResolved", { n: s.pct })),
      ),
    );
  }

  private renderSelection(rows: PanelRow[]) {
    const actionable = rows.filter((r) => this.canResolve(r.pin) || this.canDelete(r.pin));
    this.selbar.hidden = !actionable.length;
    if (!actionable.length) {
      this.selbar.replaceChildren();
      return;
    }
    const n = this.selected.size;
    const state = n === 0 ? "false" : n === actionable.length ? "true" : "mixed";
    const chosen = rows.filter((r) => this.selected.has(r.pin.id));
    const resolvable = chosen.filter((r) => this.canResolve(r.pin) && !isClosed(r.pin.status));
    const deletable = chosen.filter((r) => this.canDelete(r.pin));
    this.selbar.replaceChildren(
      h(
        "button",
        {
          class: "check",
          role: "checkbox",
          "aria-checked": state,
          onclick: () => {
            if (state === "true") this.selected.clear();
            else for (const r of actionable) this.selected.add(r.pin.id);
            this.render();
          },
        },
        h("span", { class: "box", "aria-hidden": "true" }, icon(state === "mixed" ? I.minus : I.check)),
        n ? tn("selectedN", n) : t("selectAll"),
      ),
      h(
        "span",
        { class: "grow row" },
        h("span", { class: "grow" }),
        resolvable.length > 0 &&
          h(
            "button",
            { class: "btn sm", disabled: this.busy, onclick: () => this.resolveRows(resolvable, "resolved") },
            icon(I.check),
            t("resolve"),
          ),
        deletable.length > 0 &&
          h(
            "button",
            { class: "btn sm danger", disabled: this.busy, onclick: () => this.deleteRows(deletable) },
            icon(I.trash),
            t("delete"),
          ),
      ),
    );
  }

  private card(row: PanelRow): HTMLElement {
    const { pin } = row;
    const k = kindOf(pin.kind);
    const closed = isClosed(pin.status);
    const here = this.host.pageUrl();
    // An item of another page opens that page (the deep link scrolls to it and opens its thread there).
    const elsewhere = !row.onPage && !!pin.pageUrl && cleanPageUrl(pin.pageUrl) !== cleanPageUrl(here);
    const resolvable = this.canResolve(pin);
    const deletable = this.canDelete(pin);
    const label = `${k.label} #${pin.number}: ${pin.body.slice(0, 80)}`;
    const sel = this.selected.has(pin.id);
    return h(
      "div",
      { class: `fcard${sel ? " sel" : ""}`, role: "listitem", style: `--k:${k.color}` },
      (resolvable || deletable) &&
        h(
          "button",
          {
            class: "check solo",
            role: "checkbox",
            "aria-checked": String(sel),
            "aria-label": t("selectItem", { n: pin.number }),
            onclick: () => {
              if (sel) this.selected.delete(pin.id);
              else this.selected.add(pin.id);
              this.render();
            },
          },
          h("span", { class: "box", "aria-hidden": "true" }, icon(I.check)),
        ),
      h(
        "button",
        {
          class: "fmain",
          "aria-label": elsewhere ? `${label} (${t("opensPage")})` : label,
          onclick: () => {
            if (elsewhere && pin.pageUrl) location.assign(deepLink(pin.pageUrl, pin.id));
            else this.host.openItem(row);
          },
        },
        h(
          "span",
          { class: "meta" },
          pin.number ? h("b", { class: "num" }, `#${pin.number}`) : null,
          tag(pin.kind),
          h("span", { class: `chip${closed ? "" : " ok"}` }, closed ? t("filterResolved") : t("filterOpen")),
          row.moved && h("span", { class: "chip warn" }, t("moved")),
          // No anchor: a whole-page comment or a bug report, not a pin that went missing (like the thread card).
          !pin.anchor
            ? h("span", { class: "chip" }, t("wholePage"))
            : !row.onPage && this.scope === "page" && h("span", { class: "chip warn" }, t("notOnVersion")),
          h("span", { class: "grow" }),
          h("span", { class: "muted" }, ago(pin.createdAt)),
        ),
        pin.title && h("b", { class: "title" }, pin.title),
        h("span", { class: "text clamp" }, pin.body),
        h(
          "span",
          { class: "meta" },
          (this.scope === "all" || this.group) &&
            pin.pageUrl &&
            h("span", { class: "muted where" }, icon(elsewhere ? I.external : I.page), pathOf(pin.pageUrl)),
          pin.replyCount > 0 && h("span", { class: "muted" }, tn("reply", pin.replyCount)),
        ),
      ),
      (resolvable || deletable) &&
        h(
          "div",
          { class: "facts" },
          resolvable &&
            h(
              "button",
              {
                class: "btn sm",
                disabled: this.busy,
                onclick: () => this.resolveRows([row], closed ? "open" : "resolved"),
              },
              icon(closed ? I.reopen : I.check),
              closed ? t("reopen") : t("resolve"),
            ),
          deletable &&
            h(
              "button",
              { class: "btn sm", disabled: this.busy, onclick: () => this.deleteRows([row]) },
              icon(I.trash),
              t("delete"),
            ),
        ),
    );
  }

  // --- Actions ----------------------------------------------------------------------------------------

  private async resolveRows(rows: PanelRow[], status: "resolved" | "open") {
    if (this.busy || !rows.length) return;
    this.busy = true;
    this.render();
    const mine = this.mine();
    const results = await Promise.allSettled(
      rows.map(async ({ pin }) => {
        await this.host.api.setStatus(pin.id, status, mine.get(pin.id));
        pin.status = status;
        for (const r of this.remote.items) if (r.id === pin.id) r.status = status;
      }),
    );
    this.finish(results, () => {
      const first = rows[0];
      if (rows.length === 1 && first)
        return t(status === "resolved" ? "resolvedN" : "reopenedN", { n: first.pin.number });
      return tn("resolvedMany", rows.length);
    });
  }

  /** Ask first (inline, inside the panel), then delete each item with its reporter token. */
  private deleteRows(rows: PanelRow[]) {
    if (this.busy || !rows.length) return;
    this.confirm(tn("confirmDelete", rows.length), async () => {
      this.busy = true;
      this.render();
      const mine = this.mine();
      const results = await Promise.allSettled(
        rows.map(async ({ pin }) => {
          const token = mine.get(pin.id);
          if (!token) throw new Error(t("genericError"));
          await this.host.api.remove(pin.id, token);
          this.gone.add(pin.id);
        }),
      );
      this.finish(results, () => tn("deletedN", rows.length));
    });
  }

  private finish(results: PromiseSettledResult<void>[], done: () => string) {
    this.busy = false;
    this.selected.clear();
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (!failed) this.host.toast(done());
    else this.host.toast(ok ? t("someFailed") : errText(failed.reason, t("genericError")));
    this.host.refresh();
    this.render();
  }

  private confirm(text: string, run: () => Promise<void>) {
    const opener = focused(this.el);
    const cancel = h("button", { class: "btn sm", onclick: () => this.cancelConfirm(opener) }, t("cancel"));
    this.confirmBox.replaceChildren(
      h("b", { id: "pw-confirm" }, text),
      h(
        "div",
        { class: "row" },
        h("span", { class: "grow" }),
        cancel,
        h(
          "button",
          {
            class: "btn sm danger solid",
            onclick: async () => {
              this.cancelConfirm();
              await run();
            },
          },
          icon(I.trash),
          t("delete"),
        ),
      ),
    );
    this.confirmBox.hidden = false;
    cancel.focus();
  }

  private cancelConfirm(back?: Element | null) {
    this.confirmBox.hidden = true;
    this.confirmBox.replaceChildren();
    if (back instanceof HTMLElement && back.isConnected) back.focus();
  }

  // --- Menus: type filter and export ------------------------------------------------------------------

  private openPop(anchor: HTMLButtonElement, label: string, items: HTMLElement[]) {
    this.closePop();
    const menu = h("div", { class: "xmenu", role: "menu", "aria-label": label }, ...items);
    menu.addEventListener("keydown", (e) => {
      const all = Array.from(menu.querySelectorAll<HTMLElement>("button"));
      const i = all.indexOf(e.composedPath()[0] as HTMLElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        all[(i + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus();
      } else if (e.key === "Tab") this.closePop();
    });
    this.pop = { menu, anchor };
    anchor.after(menu);
    anchor.setAttribute("aria-expanded", "true");
    (menu.querySelector<HTMLElement>("[aria-checked=true]") ?? items[0])?.focus();
    document.addEventListener("pointerdown", this.away, true);
  }

  private closePop(refocus = false) {
    const p = this.pop;
    if (!p) return;
    p.menu.remove();
    this.pop = null;
    p.anchor.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", this.away, true);
    if (refocus) p.anchor.focus();
  }

  private toggleType() {
    if (this.pop?.anchor === this.typeBtn) {
      this.closePop();
      return;
    }
    const item = (v: Kind | "all", label: string, color: string | null) =>
      h(
        "button",
        {
          role: "menuitemradio",
          "aria-checked": String(this.type === v),
          onclick: () => {
            this.type = v;
            this.closePop(true);
            this.render();
          },
        },
        h("span", { class: "sw", style: color ? `--k:${color}` : undefined }),
        label,
      );
    this.openPop(this.typeBtn, t("type"), [
      item("all", t("filterAll"), null),
      ...KIND_LIST.map((k) => item(k, kindOf(k).label, kindOf(k).color)),
    ]);
  }

  private toggleExport() {
    if (this.pop?.anchor === this.xbtn) {
      this.closePop();
      return;
    }
    const pick = (fmt: "csv" | "json") => {
      this.closePop(true);
      this.export(fmt);
    };
    this.openPop(this.xbtn, t("exportComments"), [
      h("button", { role: "menuitem", onclick: () => pick("csv") }, icon(I.file), t("exportCsv")),
      h("button", { role: "menuitem", onclick: () => pick("json") }, icon(I.file), t("exportJson")),
    ]);
  }

  private export(fmt: "csv" | "json") {
    const rows = this.visible().filter((r) => !r.pin.id.startsWith("tmp:"));
    if (!rows.length) {
      this.host.toast(t("exportEmpty"));
      return;
    }
    const page = this.host.pageUrl();
    // Each row links to its own page ("All pages" mixes them).
    const data = rows.flatMap((r) => toRows([r.pin], r.pin.pageUrl ?? page));
    if (fmt === "csv") download(this.el, fileName(page, "csv"), "text/csv;charset=utf-8", toCsv(data));
    else download(this.el, fileName(page, "json"), "application/json", toJson(data));
  }
}

export type PanelModule = { Panel: typeof Panel; threadCard: typeof threadCard };
(window as unknown as { __pinwrenPanel: PanelModule }).__pinwrenPanel = { Panel, threadCard };
