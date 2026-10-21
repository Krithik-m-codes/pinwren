import { actionHref, visitorActions } from "./actions";
import type { Pin, Reply } from "./api";
import type { WidgetConfig } from "./config";
import { adoptStyle, h, icon } from "./dom";
import { errText } from "./env";
import { cleanPageUrl, deepLink } from "./export";
import { t } from "./i18n";
import * as I from "./icons";
import { PANEL_CSS } from "./panel-styles";
import { type Reporter, store } from "./store";
import { ago, avatar, isClosed, kindOf, tag } from "./ui";

// Thread card (F-011): a pin's comment, its public replies, resolve/reopen, copy link and the project's
// panel actions (F-016). Part of the lazy widget-panel.js chunk; the core places and positions the card.

export type ThreadHost = {
  /** The widget's root element; the card's stylesheet is added to its shadow root. */
  root: HTMLElement;
  cfg: WidgetConfig;
  projectKey: string;
  projectSlug: string;
  identity: () => Reporter;
  api: {
    replies(id: string): Promise<{ items: Reply[] }>;
    reply(id: string, body: string, author?: { name?: string; email?: string }): Promise<{ comment: Reply }>;
    setStatus(id: string, status: "resolved" | "open", token?: string): Promise<unknown>;
  };
  toast(text: string): void;
  error(message: string): void;
  close(): void;
  /** The status changed on the server (the card is closed by then). */
  statusChanged(): void;
  /** A reply was added (counts in the panel change). */
  replied(): void;
  /** Whether this card is still the one on screen (replies may arrive after it closed). */
  isOpen(el: HTMLElement): boolean;
  relayout(): void;
};

const ACTION_ICONS = { link: I.link, ticket: I.ticket, bot: I.bot, external: I.external };

const message = (name: string | null, at: string, body: string, team: boolean, title?: string | null) =>
  h(
    "div",
    { class: `msg${team ? " team" : ""}` },
    avatar(name),
    h(
      "div",
      { class: "mb" },
      h(
        "div",
        { class: "meta" },
        h("b", {}, name ?? t("visitor")),
        team && h("span", { class: "chip team" }, t("team")),
        h("span", { class: "muted" }, ago(at)),
      ),
      title && h("b", { class: "title" }, title),
      h("p", { class: "text" }, body),
    ),
  );

function stripEmpty(r: Reporter): { name?: string; email?: string } {
  const out: { name?: string; email?: string } = {};
  if (r.name) out.name = r.name;
  if (r.email) out.email = r.email;
  return out;
}

/** Panel actions a visitor sees, as links with their placeholders filled in and URL-encoded. */
export function actionLinks(cfg: WidgetConfig, pin: Pin, projectSlug: string, pageUrl: string) {
  return visitorActions(cfg.panelActions).flatMap((a) => {
    const href = actionHref(a.url, {
      id: pin.id,
      number: pin.number,
      url: cleanPageUrl(pageUrl),
      projectSlug,
    });
    if (!href) return [];
    return [
      h(
        "a",
        {
          class: "btn sm",
          href,
          target: "_blank",
          rel: "noopener noreferrer",
          "aria-label": t("newTab", { label: a.label }),
          "data-action": a.id,
        },
        icon(ACTION_ICONS[a.icon ?? "external"]),
        a.label,
      ),
    ];
  });
}

export function threadCard(
  host: ThreadHost,
  pin: Pin,
  where: { onPage: boolean; moved: boolean },
): HTMLElement {
  adoptStyle(host.root, "panel", PANEL_CSS);
  const { cfg } = host;
  const token = store.mine(host.projectKey).find((m) => m.id === pin.id)?.token;
  const canResolve = !cfg.readOnly && (cfg.visitorsCanResolve || !!token);
  const closed = isClosed(pin.status);
  const resolve =
    canResolve &&
    h("button", { class: "btn sm" }, icon(closed ? I.reopen : I.check), closed ? t("reopen") : t("resolve"));
  const copy = h("button", { class: "ib", "aria-label": t("copyLink"), title: t("copyLink") }, icon(I.link));
  const quoted = pin.anchor?.textRange?.quote;
  const first = message(pin.reporterName, pin.createdAt, pin.body, false, pin.title);
  const list = h(
    "div",
    { class: "scroll" },
    quoted && h("blockquote", { class: "quote", "aria-label": t("selectedText") }, quoted),
    first,
  );
  const loading = pin.replyCount > 0 ? h("p", { class: "muted pad" }, t("loadingReplies")) : null;
  if (loading) list.append(loading);

  let reply: HTMLElement | null = null;
  if (!cfg.readOnly) {
    const box = h("textarea", {
      placeholder: t("replyPlaceholder"),
      "aria-label": t("reply"),
      rows: 1,
      maxlength: 5000,
    });
    const send = h("button", { class: "send", "aria-label": t("sendReply") }, icon(I.send));
    const go = async () => {
      const body = box.value.trim();
      if (!body || send.disabled) return;
      send.disabled = true;
      const me = { ...store.reporter(), ...stripEmpty(host.identity()) };
      try {
        const author = me.name || me.email ? stripEmpty(me) : undefined;
        const { comment } = await host.api.reply(pin.id, body, author);
        list.append(
          message(
            comment?.authorName ?? me.name ?? t("you"),
            comment?.createdAt ?? new Date().toISOString(),
            body,
            false,
          ),
        );
        list.scrollTop = list.scrollHeight;
        pin.replyCount++;
        box.value = "";
        host.replied();
      } catch (err) {
        host.toast(errText(err, t("genericError")));
        host.error(errText(err, t("genericError")));
      }
      send.disabled = false;
    };
    send.addEventListener("click", go);
    box.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void go();
      }
    });
    reply = h("div", { class: "reply" }, box, send);
  }

  const links = actionLinks(cfg, pin, host.projectSlug, location.href);
  const el = h(
    "div",
    {
      class: "card thread",
      role: "dialog",
      "aria-label": `${kindOf(pin.kind).label} #${pin.number}`,
      tabindex: -1,
    },
    h(
      "div",
      { class: "head" },
      tag(pin.kind),
      h("span", { class: "muted" }, `#${pin.number}`),
      closed && h("span", { class: "chip ok" }, t("resolved")),
      where.moved && h("span", { class: "chip warn", title: t("movedTip") }, t("moved")),
      !where.onPage && h("span", { class: "chip warn" }, t("notOnPage")),
      h("span", { class: "grow" }),
      resolve,
      copy,
      h("button", { class: "ib", "aria-label": t("close"), onclick: () => host.close() }, icon(I.close)),
    ),
    list,
    links.length > 0 && h("div", { class: "acts", role: "group", "aria-label": t("actions") }, ...links),
    reply,
  );

  copy.addEventListener("click", () => {
    const link = deepLink(location.href, pin.id);
    navigator.clipboard?.writeText(link).then(
      () => host.toast(t("linkCopied")),
      () => host.toast(link),
    ) ?? host.toast(link);
  });
  if (resolve)
    resolve.addEventListener("click", async () => {
      resolve.disabled = true;
      const next = isClosed(pin.status) ? "open" : "resolved";
      try {
        await host.api.setStatus(pin.id, next, token);
        pin.status = next;
        host.toast(t(next === "resolved" ? "resolvedN" : "reopenedN", { n: pin.number }));
        host.close();
        host.statusChanged();
      } catch (err) {
        resolve.disabled = false;
        host.toast(errText(err, t("genericError")));
        host.error(errText(err, t("genericError")));
      }
    });

  host.api.replies(pin.id).then(
    ({ items }) => {
      loading?.remove();
      if (!host.isOpen(el) || !items.length) return;
      pin.replyCount = Math.max(pin.replyCount, items.length);
      const replies = items.map((m) => message(m.authorName, m.createdAt, m.body, m.team));
      first.after(h("div", { class: "replies" }, ...replies));
      host.relayout();
    },
    () => {
      if (loading) loading.textContent = t("repliesFailed");
    },
  );
  return el;
}
