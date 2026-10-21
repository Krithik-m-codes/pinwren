import type { WidgetConfig } from "./config";
import { h } from "./dom";
import { t } from "./i18n";
import { type Reporter, store } from "./store";
import { avatar } from "./ui";

// Form pieces shared by the comment composer and the bug report: the remembered reporter identity and the
// one-time consent notice (F-009, F-019).

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function identityFields(identity: Reporter) {
  const saved = store.reporter();
  const id = { name: identity.name ?? saved.name, email: identity.email ?? saved.email };
  const name = h("input", {
    placeholder: t("nameOptional"),
    "aria-label": t("yourName"),
    autocomplete: "name",
    maxlength: 120,
    value: id.name ?? "",
  });
  const email = h("input", {
    placeholder: t("emailOptional"),
    "aria-label": t("yourEmail"),
    type: "email",
    autocomplete: "email",
    maxlength: 254,
    value: id.email ?? "",
  });
  const fields = h("div", { class: "row" }, name, email);
  let who: HTMLElement | null = null;
  if (id.name) {
    // Known person: one quiet line instead of two inputs, with a way to change it.
    fields.hidden = true;
    who = h(
      "div",
      { class: "who" },
      avatar(id.name),
      h("span", { class: "grow" }, `${t("postingAs")} `, h("b", {}, id.name)),
      h(
        "button",
        {
          class: "linkish",
          type: "button",
          onclick: () => {
            fields.hidden = false;
            if (who) who.hidden = true;
            name.focus();
          },
        },
        t("change"),
      ),
    );
  }
  return {
    els: [who, fields] as const,
    /** The email field when its value is invalid (revealed so it can be fixed), else null. */
    invalid(): HTMLInputElement | null {
      const em = email.value.trim();
      if (!em || EMAIL.test(em)) return null;
      fields.hidden = false;
      if (who) who.hidden = true;
      return email;
    },
    /** Remember and return the reporter; undefined when both fields are empty. */
    read(): Reporter | undefined {
      const r = { name: name.value.trim() || undefined, email: email.value.trim() || undefined };
      store.setReporter(r);
      return r.name || r.email ? r : undefined;
    },
  };
}

export function consentBlock(c: WidgetConfig["consent"], project: string) {
  const need = c.enabled && !store.consented(project);
  const privacy = c.privacyUrl && /^https?:\/\//i.test(c.privacyUrl) ? c.privacyUrl : null;
  return {
    need,
    el: need
      ? h(
          "div",
          { class: "consent" },
          h("p", {}, c.text ?? t("consentDefault")),
          privacy &&
            h("a", { href: privacy, target: "_blank", rel: "noopener noreferrer" }, t("privacyPolicy")),
        )
      : null,
    accept: () => need && store.setConsented(project),
  };
}
