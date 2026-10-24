import type { WidgetConfig } from "./config";
import { focused, h, ICONS, icon } from "./dom";
import { t, tn } from "./i18n";
import { UI_ICONS } from "./ui";

// The launcher as a speed dial (SitePing-style): a round button with the open count; pressing it fans out
// labelled actions — show/hide markers, create an annotation, report a bug, show the sidebar. It is a menu
// button (blueprint 05 §9): Enter/Space opens it with focus on the first action, arrows move, Esc closes and
// focus goes back to the button. With `launcher.hidden` there is no button; `open()` still shows the actions
// in the launcher's corner (Pinwren.open() from the host page).

/** What the dial offers; read again every time it opens, so it always matches the widget's state. */
export type FabActions = {
  markers: { shown: boolean; toggle: () => void } | null;
  annotate: (() => void) | null;
  /** A comment on the whole page, without a pin (wave-5 §3.3). */
  page?: (() => void) | null;
  bug: { draft: boolean; run: () => void } | null;
  sidebar: { open: number; run: () => void } | null;
  queued: { n: number; run: () => void } | null;
};

export type FabHost = {
  root: HTMLElement;
  /** The widget's host element: presses inside it are never "outside". */
  host: HTMLElement;
  cfg: WidgetConfig;
  poweredBy: boolean;
  actions: () => FabActions;
  /** Launcher pressed: the widget decides (it may start a pending action instead). */
  press: () => void;
  prefetch: () => void;
  opened: () => void;
  closed: () => void;
};

const BUTTON = 52;

export class Fab {
  readonly button: HTMLButtonElement | null = null;
  readonly badge = h("span", { class: "count", hidden: true });
  menu: HTMLElement | null = null;
  private readonly away = (e: Event) => {
    if (!e.composedPath().includes(this.o.host)) this.close();
  };

  constructor(private readonly o: FabHost) {
    const l = o.cfg.launcher;
    if (l.hidden) return;
    const [v, hz] = this.side();
    // The server's English defaults follow the visitor's language; a custom text is shown as written.
    const label = l.label === "Feedback" ? t("feedback") : l.label;
    const tooltip = l.tooltip === "Give feedback" ? t("giveFeedback") : l.tooltip;
    const name = tooltip ?? (l.shape === "pill" && label ? label : t("feedback"));
    const b = h(
      "button",
      {
        class: `launcher ${l.shape} ${v} ${hz}`,
        "aria-label": name,
        "aria-haspopup": "menu",
        "aria-expanded": "false",
        "data-tip": l.shape === "round" ? (tooltip ?? undefined) : undefined,
        onclick: () => o.press(),
        // Intent to open: fetch the small chunks now so the panel / report form appear without a wait.
        onpointerenter: () => o.prefetch(),
        onfocus: () => o.prefetch(),
        onkeydown: (e: Event) => {
          const k = (e as KeyboardEvent).key;
          if ((k === "ArrowUp" || k === "ArrowDown") && !this.menu) {
            e.preventDefault();
            o.press();
          }
        },
      },
      h("span", { class: "li" }, icon(ICONS[l.icon === "pin" ? "logo" : l.icon])),
      h("span", { class: "lx" }, icon(UI_ICONS.x)),
      l.shape === "pill" && label ? h("span", { class: "ll" }, label) : null,
      this.badge,
    );
    b.style.setProperty(v, `${l.offset.y}px`);
    b.style.setProperty(hz, `${l.offset.x}px`);
    this.button = b;
    o.root.append(b);
  }

  private side(): ["top" | "bottom", "left" | "right"] {
    return this.o.cfg.launcher.position.split("-") as ["top" | "bottom", "left" | "right"];
  }

  setCount(n: number) {
    this.badge.hidden = !n;
    this.badge.textContent = n > 99 ? "99+" : String(n);
  }

  open() {
    if (this.menu) return;
    const l = this.o.cfg.launcher;
    const [v, hz] = this.side();
    const a = this.o.actions();
    const item = (
      svg: string,
      label: string,
      run: () => void,
      extra: { key?: string; count?: number; checked?: boolean; note?: string } = {},
    ) =>
      h(
        "button",
        {
          role: extra.checked === undefined ? "menuitem" : "menuitemcheckbox",
          "aria-checked": extra.checked === undefined ? undefined : String(extra.checked),
          "aria-keyshortcuts": extra.key && this.o.cfg.shortcuts ? extra.key : undefined,
          class: "act",
          onclick: run,
        },
        h(
          "span",
          { class: "lbl" },
          label,
          extra.key && this.o.cfg.shortcuts ? h("kbd", {}, extra.key) : null,
          extra.note ? h("span", { class: "note" }, extra.note) : null,
        ),
        h(
          "span",
          { class: "ic" },
          icon(svg),
          extra.count ? h("span", { class: "ac" }, extra.count > 99 ? "99+" : String(extra.count)) : null,
        ),
      );
    const menu = h(
      "div",
      { class: `dial ${v} ${hz}`, role: "menu", "aria-label": t("feedback") },
      a.markers &&
        item(
          a.markers.shown ? ICONS.eye : UI_ICONS.eyeOff,
          a.markers.shown ? t("hideMarkers") : t("showMarkers"),
          a.markers.toggle,
          { checked: a.markers.shown },
        ),
      a.annotate && item(UI_ICONS.pencil, t("createAnnotation"), a.annotate, { key: "C" }),
      a.page && item(ICONS.comment, t("commentOnPage"), a.page),
      a.bug &&
        item(ICONS.bug, t("reportBug"), a.bug.run, {
          key: "B",
          ...(a.bug.draft ? { note: t("draftSub") } : {}),
        }),
      a.sidebar && item(ICONS.list, t("showSidebar"), a.sidebar.run, { count: a.sidebar.open }),
      a.queued && item(ICONS.clock, tn("queued", a.queued.n), a.queued.run),
      this.o.poweredBy && h("div", { class: "pw" }, t("poweredBy")),
    );
    // Stacked over the launcher (under it for top corners), centred on the round button.
    const height = this.button ? this.button.offsetHeight : 0;
    const lift = l.hidden ? 0 : (height > 0 ? height : BUTTON) + 12;
    const inset = l.hidden || l.shape === "pill" ? 0 : (BUTTON - 44) / 2;
    menu.style.setProperty(v, `${lift + l.offset.y}px`);
    menu.style.setProperty(hz, `${inset + l.offset.x}px`);
    menu.addEventListener("keydown", (e) => {
      const items = Array.from(menu.querySelectorAll<HTMLElement>(".act"));
      const i = items.indexOf(e.composedPath()[0] as HTMLElement);
      const d =
        e.key === "ArrowDown"
          ? 1
          : e.key === "ArrowUp"
            ? -1
            : e.key === "Home"
              ? -i
              : e.key === "End"
                ? items.length - 1 - i
                : 0;
      if (!d) return;
      e.preventDefault();
      items[(i + d + items.length) % items.length]?.focus();
    });
    this.menu = menu;
    this.o.root.append(menu);
    this.button?.setAttribute("aria-expanded", "true");
    menu.querySelector<HTMLElement>(".act")?.focus();
    document.addEventListener("pointerdown", this.away, true);
    this.o.opened();
  }

  close() {
    if (!this.menu) return;
    // Keyboard users go back to the launcher (Esc, or an action that opens nothing focusable).
    if (this.menu.contains(focused(this.o.root))) this.button?.focus({ preventScroll: true });
    this.menu.remove();
    this.menu = null;
    document.removeEventListener("pointerdown", this.away, true);
    this.button?.setAttribute("aria-expanded", "false");
    this.o.closed();
  }

  destroy() {
    this.close();
    this.button?.remove();
  }
}
