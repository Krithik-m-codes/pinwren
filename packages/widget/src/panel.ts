import type { Pin } from "./api";
import { adoptStyle, h, ICONS, icon } from "./dom";
import { download, fileName, toCsv, toJson, toRows } from "./export";
import { addEnglish, t, tn } from "./i18n";
import * as I from "./icons";
import { enPanel } from "./locales/en-panel";
import { PANEL_CSS } from "./panel-styles";
import { threadCard } from "./thread";
import { ago, avatar, isClosed, kindOf, shortName, tag } from "./ui";

// The comment viewer — the lazy widget-panel.js chunk: the side panel (F-011) with export (F-018), and the
// thread card (thread.ts). The panel owns its DOM and filters; the core owns the pins and tells it when to
// re-render.

addEnglish(enPanel);

export type PanelRow = { pin: Pin; onPage: boolean; moved: boolean };
export type Filter = "open" | "resolved" | "mine";

export type PanelHost = {
  root: HTMLElement;
  rows(): PanelRow[];
  mine(): Set<string>;
  canComment: boolean;
  shortcuts: boolean;
  showResolved(): boolean;
  toggleResolved(): void;
  /** The "Resolved" filter needs closed items the core may not have fetched yet. */
  needClosed(): void;
  openItem(row: PanelRow): void;
  comment(): void;
  close(): void;
  pageUrl(): string;
  toast(text: string): void;
};

export class Panel {
  readonly el: HTMLElement;
  filter: Filter = "open";
  private q = "";
  private readonly list = h("div", { class: "plist" });
  private readonly count = h("span", { class: "chip" });
  private readonly filters: HTMLButtonElement[];
  private readonly toggle: HTMLButtonElement;
  private readonly xbtn: HTMLButtonElement;
  private xmenu: HTMLElement | null = null;
  private readonly away = (e: Event) => {
    if (this.xmenu && !e.composedPath().includes(this.xmenu.parentElement as EventTarget)) this.closeExport();
  };

  constructor(private readonly host: PanelHost) {
    adoptStyle(host.root, "panel", PANEL_CSS);
    const names = { open: t("filterOpen"), resolved: t("filterResolved"), mine: t("filterMine") };
    this.filters = (["open", "resolved", "mine"] as const).map((f) =>
      h("button", { "aria-pressed": String(f === "open"), onclick: () => this.setFilter(f) }, names[f]),
    );
    const search = h("input", {
      type: "search",
      placeholder: t("search"),
      "aria-label": t("searchComments"),
    });
    search.addEventListener("input", () => {
      this.q = search.value;
      this.render();
    });
    this.toggle = h(
      "button",
      {
        class: "switch",
        role: "switch",
        "aria-checked": String(host.showResolved()),
        onclick: () => host.toggleResolved(),
      },
      h("span", { class: "knob" }),
      t("showResolved"),
    );
    this.xbtn = h(
      "button",
      {
        class: "ib",
        "aria-label": t("exportComments"),
        title: t("exportComments"),
        "aria-haspopup": "menu",
        "aria-expanded": "false",
        onclick: () => (this.xmenu ? this.closeExport() : this.openExport()),
      },
      icon(I.download),
    );
    this.el = h(
      "aside",
      { class: "panel", role: "complementary", "aria-label": t("commentsOnPage") },
      h(
        "div",
        { class: "phead" },
        h("b", {}, t("comments")),
        this.count,
        h("span", { class: "grow" }),
        h("span", { class: "xwrap" }, this.xbtn),
        host.canComment &&
          h(
            "button",
            { class: "ib", "aria-label": t("addComment"), onclick: () => host.comment() },
            icon(ICONS.plus),
          ),
        h(
          "button",
          { class: "ib", "aria-label": t("closeComments"), onclick: () => host.close() },
          icon(I.close),
        ),
      ),
      h(
        "div",
        { class: "ptools" },
        h("div", { class: "seg", role: "group", "aria-label": t("filter") }, ...this.filters),
        h("label", { class: "search" }, icon(I.search), search),
        this.toggle,
      ),
      this.list,
    );
    host.root.append(this.el);
    this.render();
  }

  destroy() {
    this.closeExport();
    this.el.remove();
  }

  setCount(n: number) {
    this.count.textContent = String(n);
  }

  syncResolved() {
    this.toggle.setAttribute("aria-checked", String(this.host.showResolved()));
  }

  private setFilter(f: Filter) {
    this.filter = f;
    for (const [i, b] of this.filters.entries())
      b.setAttribute("aria-pressed", String(["open", "resolved", "mine"][i] === f));
    if (f === "resolved") this.host.needClosed();
    this.render();
  }

  /** What the list shows right now — and what Export downloads. */
  private visibleRows(): PanelRow[] {
    const mine = this.host.mine();
    const q = this.q.trim().toLowerCase();
    return this.host
      .rows()
      .filter(({ pin }) =>
        this.filter === "open"
          ? !isClosed(pin.status)
          : this.filter === "resolved"
            ? isClosed(pin.status)
            : mine.has(pin.id) || pin.id.startsWith("tmp:"),
      )
      .filter(
        ({ pin }) =>
          !q ||
          `${pin.title ?? ""} ${pin.body} ${pin.reporterName ?? ""} #${pin.number}`.toLowerCase().includes(q),
      )
      .sort((a, b) => Date.parse(b.pin.createdAt) - Date.parse(a.pin.createdAt));
  }

  render() {
    const rows = this.visibleRows();
    const item = (row: PanelRow) => {
      const { pin } = row;
      return h(
        "button",
        {
          class: "item",
          "aria-label": `${kindOf(pin.kind).label} #${pin.number}: ${pin.body.slice(0, 80)}`,
          onclick: () => this.host.openItem(row),
        },
        avatar(pin.reporterName),
        h(
          "span",
          { class: "ib-body" },
          h(
            "span",
            { class: "meta" },
            h("b", {}, shortName(pin.reporterName)),
            h("span", { class: "muted" }, `${pin.number ? `#${pin.number} · ` : ""}${ago(pin.createdAt)}`),
            h("span", { class: "grow" }),
            tag(pin.kind),
          ),
          h("span", { class: "text clamp2" }, pin.body),
          h(
            "span",
            { class: "meta" },
            pin.replyCount > 0 && h("span", { class: "muted" }, tn("reply", pin.replyCount)),
            isClosed(pin.status) && h("span", { class: "chip ok" }, t("resolved")),
            row.moved && h("span", { class: "chip warn" }, t("moved")),
            !row.onPage && h("span", { class: "chip warn" }, t("notOnVersion")),
          ),
        ),
      );
    };
    const { canComment, shortcuts } = this.host;
    const empty = h(
      "div",
      { class: "empty" },
      h("b", {}, this.q ? t("noMatches") : this.filter === "mine" ? t("nothingFromYou") : t("noComments")),
      h(
        "span",
        { class: "muted" },
        this.q
          ? t("tryDifferent")
          : canComment
            ? shortcuts
              ? t("pressC")
              : t("usePlus")
            : t("willShowHere"),
      ),
    );
    this.list.replaceChildren(...(rows.length ? rows.map(item) : [empty]));
  }

  // --- Export (F-018) ---------------------------------------------------------------------------------

  private openExport() {
    const pick = (fmt: "csv" | "json") => {
      this.closeExport(true);
      this.export(fmt);
    };
    const menu = h(
      "div",
      { class: "xmenu", role: "menu", "aria-label": t("exportComments") },
      h("button", { role: "menuitem", onclick: () => pick("csv") }, icon(I.file), t("exportCsv")),
      h("button", { role: "menuitem", onclick: () => pick("json") }, icon(I.file), t("exportJson")),
    );
    menu.addEventListener("keydown", (e) => {
      const items = Array.from(menu.querySelectorAll<HTMLElement>("[role=menuitem]"));
      const i = items.indexOf(e.composedPath()[0] as HTMLElement);
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.closeExport(true);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      } else if (e.key === "Tab") this.closeExport();
    });
    this.xmenu = menu;
    this.xbtn.after(menu);
    this.xbtn.setAttribute("aria-expanded", "true");
    (menu.firstElementChild as HTMLElement).focus();
    document.addEventListener("pointerdown", this.away, true);
  }

  private closeExport(refocus = false) {
    if (!this.xmenu) return;
    this.xmenu.remove();
    this.xmenu = null;
    this.xbtn.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", this.away, true);
    if (refocus) this.xbtn.focus();
  }

  private export(fmt: "csv" | "json") {
    const rows = this.visibleRows().filter((r) => !r.pin.id.startsWith("tmp:"));
    if (!rows.length) {
      this.host.toast(t("exportEmpty"));
      return;
    }
    const page = this.host.pageUrl();
    const data = toRows(
      rows.map((r) => r.pin),
      page,
    );
    if (fmt === "csv") download(this.el, fileName(page, "csv"), "text/csv;charset=utf-8", toCsv(data));
    else download(this.el, fileName(page, "json"), "application/json", toJson(data));
  }
}

export type PanelModule = { Panel: typeof Panel; threadCard: typeof threadCard };
(window as unknown as { __pinwrenPanel: PanelModule }).__pinwrenPanel = { Panel, threadCard };
