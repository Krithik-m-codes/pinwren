import type { AnchorBundle, FeedbackKind, WidgetFeedbackCreate } from "@annota/core";
import { captureAnchor, resolveAnchor } from "./anchor";
import { type Pin, WidgetApi } from "./api";
import { installDiagnostics, snapshotDiagnostics } from "./diagnostics";
import { h, ICONS, icon } from "./dom";
import { COLORS, Editor } from "./editor";
import { STYLES } from "./styles";

export type WidgetOptions = { projectKey: string; endpoint: string; accent?: string };

type Placed = { pin: Pin; el: Element; marker: HTMLButtonElement; moved: boolean };

const REPORTER_KEY = "annota:reporter";

function uuid(): string {
  return (
    crypto.randomUUID?.() ??
    "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0]! & (15 >> (Number(c) / 4)))).toString(16),
    )
  );
}

function environment(): WidgetFeedbackCreate["environment"] {
  const ua = navigator.userAgent;
  const browser =
    /Edg\/(\d+)/.exec(ua)?.[0]?.replace("Edg/", "Edge ") ??
    /Chrome\/(\d+)/.exec(ua)?.[0]?.replace("/", " ") ??
    /Firefox\/(\d+)/.exec(ua)?.[0]?.replace("/", " ") ??
    (/Version\/(\d+).*Safari/.test(ua) ? `Safari ${/Version\/(\d+)/.exec(ua)?.[1]}` : undefined);
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : undefined;
  return {
    userAgent: ua.slice(0, 500),
    browser,
    os,
    viewport: { w: innerWidth, h: innerHeight },
    dpr: Math.min(8, Math.max(0.5, devicePixelRatio || 1)),
    locale: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    referrer: document.referrer || undefined,
  };
}

export class AnnotaWidget {
  private readonly api: WidgetApi;
  private readonly host = document.createElement("annota-root");
  private readonly shadow: ShadowRoot;
  private readonly root: HTMLDivElement;
  private readonly fab: HTMLButtonElement;
  private menu: HTMLElement | null = null;
  private card: HTMLElement | null = null;
  private hint: HTMLElement | null = null;
  private outline: HTMLElement | null = null;
  private placed: Placed[] = [];
  private orphans: Pin[] = [];
  private showPins = true;
  private publicRead = true;
  private picking = false;
  private raf = 0;
  private cleanup: (() => void)[] = [];

  constructor(private readonly opts: WidgetOptions) {
    this.api = new WidgetApi(opts.endpoint, opts.projectKey);
    this.shadow = this.host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = STYLES;
    this.root = h("div", { class: "root" });
    if (opts.accent) this.root.style.setProperty("--annota-accent", opts.accent);
    this.fab = h(
      "button",
      { class: "fab", "aria-label": "Give feedback", onclick: () => this.toggleMenu() },
      icon(ICONS.logo),
    );
    this.root.append(this.fab);
    this.shadow.append(style, this.root);
    // On <html>, not <body>: survives frameworks that replace the body.
    document.documentElement.append(this.host);
  }

  async start() {
    installDiagnostics();
    const reposition = () => {
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(() => this.positionPins());
    };
    addEventListener("scroll", reposition, { passive: true, capture: true });
    addEventListener("resize", reposition, { passive: true });
    this.cleanup.push(() => {
      removeEventListener("scroll", reposition, { capture: true });
      removeEventListener("resize", reposition);
    });

    try {
      const cfg = await this.api.config();
      this.publicRead = cfg.project.publicRead;
    } catch (err) {
      console.warn("[annota] widget disabled:", err instanceof Error ? err.message : err);
      this.destroy();
      return;
    }
    await this.loadPins();

    // Re-place pins when the page changes underneath (SPA navigation, lazy content).
    let lastUrl = location.href;
    const observer = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        void this.loadPins();
      } else reposition();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    this.cleanup.push(() => observer.disconnect());

    const deepLink = new URLSearchParams(location.search).get("annota");
    if (deepLink) setTimeout(() => this.focusPin(deepLink), 400);
  }

  destroy() {
    this.stopPicking();
    for (const fn of this.cleanup) fn();
    cancelAnimationFrame(this.raf);
    this.host.remove();
  }

  // --- Pins ---------------------------------------------------------------------------------------

  private async loadPins() {
    for (const p of this.placed) p.marker.remove();
    this.placed = [];
    this.orphans = [];
    if (!this.publicRead) return this.updateCount();
    try {
      const { items } = await this.api.pins(location.href);
      for (const pin of items) {
        const resolved = pin.anchor ? resolveAnchor(pin.anchor) : null;
        if (!resolved) {
          this.orphans.push(pin);
          continue;
        }
        const marker = h(
          "button",
          {
            class: `pin${pin.status === "resolved" ? " resolved" : ""}${resolved.confidence < 0.8 ? " moved" : ""}`,
            "aria-label": `Feedback #${pin.number}: ${pin.body.slice(0, 80)}`,
            onclick: (e: Event) => {
              e.stopPropagation();
              void this.openThread(pin, marker);
            },
          },
          String(pin.number),
        );
        this.root.append(marker);
        this.placed.push({ pin, el: resolved.element, marker, moved: resolved.confidence < 0.8 });
      }
    } catch {
      // Pins are a nicety; failing to load them must never break the page.
    }
    this.positionPins();
    this.updateCount();
  }

  private positionPins() {
    for (const p of this.placed) {
      const r = p.el.getBoundingClientRect();
      const anchor = p.pin.anchor as AnchorBundle;
      const visible = this.showPins && r.width + r.height > 0 && p.el.isConnected;
      p.marker.style.display = visible ? "" : "none";
      p.marker.style.left = `${r.left + (anchor.pin.xPct / 100) * r.width}px`;
      p.marker.style.top = `${r.top + (anchor.pin.yPct / 100) * r.height}px`;
    }
  }

  private updateCount() {
    this.fab.querySelector(".count")?.remove();
    const open = this.placed.filter((p) => p.pin.status !== "resolved").length;
    if (open) this.fab.append(h("span", { class: "count" }, String(open)));
  }

  private focusPin(id: string) {
    const p = this.placed.find((x) => x.pin.id === id);
    if (!p) return;
    p.el.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => {
      p.marker.classList.add("pulse");
      void this.openThread(p.pin, p.marker);
    }, 500);
  }

  // --- Menu ---------------------------------------------------------------------------------------

  private toggleMenu() {
    if (this.menu) return this.closeMenu();
    this.closeCard();
    const item = (svg: string, title: string, sub: string, onclick: () => void) =>
      h(
        "button",
        { onclick },
        h("span", { class: "ico" }, icon(svg)),
        h("span", {}, title, h("small", {}, sub)),
      );
    this.menu = h(
      "div",
      { class: "menu", role: "menu" },
      item(ICONS.comment, "Comment on the page", "Click any element to pin a note", () => {
        this.closeMenu();
        this.startPicking();
      }),
      item(ICONS.bug, "Report a bug", "Screenshot, annotate, send", () => {
        this.closeMenu();
        void this.startBugReport();
      }),
      this.publicRead &&
        item(
          ICONS.eye,
          this.showPins ? "Hide pins" : "Show pins",
          `${this.placed.length} on this page`,
          () => {
            this.showPins = !this.showPins;
            this.positionPins();
            this.closeMenu();
          },
        ),
      this.orphans.length > 0 &&
        h(
          "div",
          { class: "foot" },
          `${this.orphans.length} earlier note(s) couldn't be placed on this version of the page.`,
        ),
      h("div", { class: "sep" }),
      h("div", { class: "foot" }, "Powered by Annota"),
    );
    this.root.append(this.menu);
    const away = (e: Event) => {
      if (!e.composedPath().includes(this.host)) this.closeMenu();
    };
    setTimeout(() => document.addEventListener("pointerdown", away, { once: true }));
  }

  private closeMenu() {
    this.menu?.remove();
    this.menu = null;
  }

  private closeCard() {
    this.card?.remove();
    this.card = null;
    for (const p of this.placed) p.marker.classList.remove("active");
  }

  private placeCard(card: HTMLElement, x: number, y: number) {
    const w = Math.min(320, innerWidth - 24);
    card.style.left = `${Math.max(12, Math.min(x + 12, innerWidth - w - 12))}px`;
    card.style.top = `${Math.max(12, Math.min(y + 12, innerHeight - 360))}px`;
  }

  private toast(text: string) {
    const t = h("div", { class: "toast", role: "status" }, text);
    this.root.append(t);
    setTimeout(() => t.remove(), 3200);
  }

  // --- Comment mode -------------------------------------------------------------------------------

  private onMove = (e: PointerEvent) => {
    const target = this.targetAt(e.clientX, e.clientY);
    if (!target || !this.outline) return;
    const r = target.getBoundingClientRect();
    Object.assign(this.outline.style, {
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    const label = this.outline.firstElementChild as HTMLElement;
    label.textContent = `${target.tagName.toLowerCase()}${target.id ? `#${target.id}` : ""}`;
  };

  private onPick = (e: MouseEvent) => {
    if (e.composedPath().includes(this.host)) return;
    e.preventDefault();
    e.stopPropagation();
    let target = this.targetAt(e.clientX, e.clientY);
    if (target && e.shiftKey && target.parentElement && target.parentElement !== document.body)
      target = target.parentElement;
    if (!target) return;
    const anchor = captureAnchor(target, e.clientX, e.clientY);
    this.stopPicking();
    this.openComposer(anchor, e.clientX, e.clientY);
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") this.stopPicking();
  };

  private targetAt(x: number, y: number): Element | null {
    const el = document.elementFromPoint(x, y);
    if (!el || el === this.host || el === document.documentElement || el === document.body) return null;
    return el;
  }

  private startPicking() {
    this.picking = true;
    this.outline = h("div", { class: "outline" }, h("span", {}));
    this.hint = h(
      "div",
      { class: "hint", role: "status" },
      "Click an element to comment",
      h("kbd", {}, "Shift"),
      "parent",
      h("kbd", {}, "Esc"),
      "cancel",
    );
    this.root.append(this.outline, this.hint);
    document.addEventListener("pointermove", this.onMove, true);
    document.addEventListener("click", this.onPick, true);
    document.addEventListener("keydown", this.onKey, true);
  }

  private stopPicking() {
    if (!this.picking) return;
    this.picking = false;
    this.outline?.remove();
    this.hint?.remove();
    this.outline = this.hint = null;
    document.removeEventListener("pointermove", this.onMove, true);
    document.removeEventListener("click", this.onPick, true);
    document.removeEventListener("keydown", this.onKey, true);
  }

  private reporterFields() {
    let saved: { name?: string; email?: string } = {};
    try {
      saved = JSON.parse(localStorage.getItem(REPORTER_KEY) ?? "{}");
    } catch {}
    const name = h("input", {
      placeholder: "Your name (optional)",
      value: saved.name ?? "",
      autocomplete: "name",
    });
    const email = h("input", {
      placeholder: "Email (optional)",
      type: "email",
      value: saved.email ?? "",
      autocomplete: "email",
    });
    const read = () => {
      const r = { name: name.value.trim() || undefined, email: email.value.trim() || undefined };
      try {
        localStorage.setItem(REPORTER_KEY, JSON.stringify(r));
      } catch {}
      return r.name || r.email ? r : undefined;
    };
    return { el: h("div", { class: "row" }, name, email), read };
  }

  private openComposer(anchor: AnchorBundle, x: number, y: number) {
    this.closeCard();
    let kind: FeedbackKind = "comment";
    const kinds = (["comment", "bug", "idea", "question"] as const).map((k) =>
      h(
        "button",
        {
          "aria-pressed": String(k === kind),
          onclick: (e: Event) => {
            kind = k;
            for (const b of kinds) b.setAttribute("aria-pressed", String(b === e.currentTarget));
          },
        },
        k[0]!.toUpperCase() + k.slice(1),
      ),
    );
    const text = h("textarea", { placeholder: "What should change here?", "aria-label": "Your comment" });
    const reporter = this.reporterFields();
    const error = h("p", { class: "err", role: "alert" });
    const send = h("button", { class: "btn primary" }, "Send");
    const submit = async () => {
      if (!text.value.trim()) return text.focus();
      send.disabled = true;
      send.textContent = "Sending…";
      try {
        const { feedback } = await this.api.submit({
          clientId: uuid(),
          kind,
          body: text.value.trim(),
          page: { url: location.href, title: document.title.slice(0, 300) },
          anchor,
          environment: environment(),
          reporter: reporter.read(),
          diagnostics: kind === "bug" ? snapshotDiagnostics() : undefined,
        });
        this.closeCard();
        this.toast(`Thanks! Sent as #${feedback.number}`);
        await this.loadPins();
      } catch (err) {
        error.textContent = err instanceof Error ? err.message : "Couldn't send — try again";
        send.disabled = false;
        send.textContent = "Send";
      }
    };
    send.addEventListener("click", submit);
    text.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
      if (e.key === "Escape") this.closeCard();
    });
    this.card = h(
      "div",
      { class: "card", role: "dialog", "aria-label": "New comment" },
      h(
        "header",
        {},
        "New comment",
        h("button", { class: "x", "aria-label": "Close", onclick: () => this.closeCard() }, "✕"),
      ),
      h("div", { class: "body" }, h("div", { class: "kinds" }, ...kinds), text, reporter.el, error),
      h(
        "div",
        { class: "actions" },
        h("button", { class: "btn ghost", onclick: () => this.closeCard() }, "Cancel"),
        send,
      ),
    );
    this.placeCard(this.card, x, y);
    this.root.append(this.card);
    text.focus();
  }

  private async openThread(pin: Pin, marker: HTMLElement) {
    this.closeCard();
    marker.classList.add("active");
    const list = h(
      "div",
      { class: "body" },
      h("div", { class: "msg" }, h("div", { class: "who" }, pin.reporterName ?? "Visitor"), pin.body),
    );
    const reply = h("textarea", { placeholder: "Reply…", "aria-label": "Reply", style: "min-height:60px" });
    const send = h("button", { class: "btn primary" }, "Reply");
    this.card = h(
      "div",
      { class: "card", role: "dialog", "aria-label": `Feedback #${pin.number}` },
      h(
        "header",
        {},
        `#${pin.number} · ${pin.status.replace("_", " ")}`,
        h("button", { class: "x", "aria-label": "Close", onclick: () => this.closeCard() }, "✕"),
      ),
      list,
      h(
        "div",
        { class: "actions", style: "display:grid;grid-template-columns:1fr auto;align-items:end" },
        reply,
        send,
      ),
    );
    const r = marker.getBoundingClientRect();
    this.placeCard(this.card, r.left, r.top);
    this.root.append(this.card);
    try {
      const { items } = await this.api.replies(pin.id);
      for (const m of items) {
        list.append(
          h(
            "div",
            { class: `msg${m.team ? " team" : ""}` },
            h("div", { class: "who" }, m.authorName ?? "Visitor", m.team ? " · team" : ""),
            m.body,
          ),
        );
      }
    } catch {}
    send.addEventListener("click", async () => {
      if (!reply.value.trim()) return;
      send.disabled = true;
      try {
        let name: string | undefined;
        try {
          name = JSON.parse(localStorage.getItem(REPORTER_KEY) ?? "{}").name;
        } catch {}
        await this.api.reply(pin.id, reply.value.trim(), name);
        list.append(
          h("div", { class: "msg" }, h("div", { class: "who" }, name ?? "You"), reply.value.trim()),
        );
        reply.value = "";
      } catch (err) {
        this.toast(err instanceof Error ? err.message : "Couldn't send");
      }
      send.disabled = false;
    });
  }

  // --- Bug report mode ----------------------------------------------------------------------------

  private async loadCapture(): Promise<() => Promise<HTMLCanvasElement>> {
    const w = window as unknown as { __annotaCapture?: () => Promise<HTMLCanvasElement> };
    if (w.__annotaCapture) return w.__annotaCapture;
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `${this.opts.endpoint}/widget-capture.js`;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Couldn't load the screenshot tool"));
      document.head.append(s);
    });
    if (!w.__annotaCapture) throw new Error("Screenshot tool unavailable");
    return w.__annotaCapture;
  }

  private async startBugReport() {
    this.fab.style.visibility = "hidden";
    for (const p of this.placed) p.marker.style.visibility = "hidden";
    let base: HTMLCanvasElement | null = null;
    try {
      const capture = await this.loadCapture();
      base = await Promise.race([
        capture(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Screenshot timed out")), 8000)),
      ]);
    } catch (err) {
      console.warn("[annota] screenshot failed:", err);
    } finally {
      this.fab.style.visibility = "";
      for (const p of this.placed) p.marker.style.visibility = "";
    }
    this.openReportModal(base);
  }

  private openReportModal(base: HTMLCanvasElement | null) {
    const editor = base ? new Editor(base) : null;
    const text = h("textarea", {
      placeholder: "What went wrong? What did you expect?",
      "aria-label": "Describe the bug",
      style: "min-height:120px",
    });
    const title = h("input", { placeholder: "Short title (optional)", "aria-label": "Title" });
    const reporter = this.reporterFields();
    const error = h("p", { class: "err", role: "alert" });
    const send = h("button", { class: "btn primary" }, "Send report");
    const close = () => {
      editor?.destroy();
      modal.remove();
      document.removeEventListener("keydown", onEsc, true);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onEsc, true);

    const toolButtons: HTMLButtonElement[] = [];
    const toolBtn = (tool: "rect" | "arrow" | "pen" | "blur", svg: string, label: string) => {
      const b = h(
        "button",
        {
          "aria-pressed": String(editor?.tool === tool),
          title: label,
          onclick: () => {
            if (!editor) return;
            editor.tool = tool;
            for (const x of toolButtons) x.setAttribute("aria-pressed", String(x === b));
          },
        },
        icon(svg),
        label,
      );
      toolButtons.push(b);
      return b;
    };
    const swatches: HTMLButtonElement[] = COLORS.map((c) => {
      const b = h("button", {
        class: "swatch",
        style: `background:${c}`,
        "aria-label": `Colour ${c}`,
        "aria-pressed": String(editor?.color === c),
        onclick: () => {
          if (!editor) return;
          editor.color = c;
          for (const x of swatches) x.setAttribute("aria-pressed", String(x === b));
        },
      });
      return b;
    });

    const toolbar = h(
      "div",
      { class: "toolbar" },
      ...(editor
        ? [
            toolBtn("rect", ICONS.rect, "Box"),
            toolBtn("arrow", ICONS.arrow, "Arrow"),
            toolBtn("pen", ICONS.pen, "Draw"),
            toolBtn("blur", ICONS.blur, "Hide"),
            ...swatches,
            h("button", { onclick: () => editor.undo(), title: "Undo" }, icon(ICONS.undo), "Undo"),
          ]
        : [
            h(
              "span",
              { class: "muted", style: "padding:6px 8px" },
              "Screenshot unavailable on this page — you can still send a report.",
            ),
          ]),
      h("span", { class: "grow" }),
      h("button", { onclick: close, "aria-label": "Close" }, icon(ICONS.close)),
    );

    send.addEventListener("click", async () => {
      if (!text.value.trim()) return text.focus();
      send.disabled = true;
      send.textContent = "Sending…";
      try {
        const { feedback } = await this.api.submit({
          clientId: uuid(),
          kind: "bug",
          title: title.value.trim() || undefined,
          body: text.value.trim(),
          page: { url: location.href, title: document.title.slice(0, 300) },
          environment: environment(),
          reporter: reporter.read(),
          diagnostics: snapshotDiagnostics(),
          screenshot: editor?.export(),
        });
        close();
        this.toast(`Bug report sent as #${feedback.number} — thank you!`);
      } catch (err) {
        error.textContent = err instanceof Error ? err.message : "Couldn't send — try again";
        send.disabled = false;
        send.textContent = "Send report";
      }
    });

    const modal = h(
      "div",
      { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": "Report a bug" },
      h(
        "div",
        { class: "editor" },
        toolbar,
        h(
          "div",
          { class: "stage" },
          h(
            "div",
            { class: "canvas-wrap" },
            editor ? editor.canvas : h("span", { class: "muted" }, "No screenshot"),
          ),
          h(
            "div",
            { class: "side" },
            h("strong", {}, "Report a bug"),
            h(
              "p",
              { class: "muted" },
              "Mark the problem on the screenshot. Browser details and recent errors are attached automatically.",
            ),
            title,
            text,
            reporter.el,
            error,
            send,
          ),
        ),
      ),
    );
    this.root.append(modal);
    text.focus();
  }
}
