import type { ReporterPayload, WidgetConfig } from "./config";
import { h } from "./dom";
import { t } from "./i18n";
import { type Identity, store } from "./store";
import { avatar } from "./ui";

// Form pieces shared by the comment composer and the bug report: the remembered reporter identity and the
// one-time consent notice (F-009, F-019).

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function identityFields(identity: Identity) {
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
    /**
     * Remember and return the reporter; undefined when there is nothing to send. A host-app identity
     * (wave-4 §4) rides along as `externalId` + `signature`, whatever the visitor typed into the fields.
     */
    read(): ReporterPayload | undefined {
      const r = { name: name.value.trim() || undefined, email: email.value.trim() || undefined };
      store.setReporter(r);
      const out: ReporterPayload = { ...r };
      if (identity.id) {
        out.externalId = identity.id;
        if (identity.signature) out.signature = identity.signature;
      }
      return out.name || out.email || out.externalId ? out : undefined;
    },
  };
}

/** Identifies the notice a visitor agreed to: changes whenever its text or privacy link does. */
export function consentVersion(c: WidgetConfig["consent"]): string {
  // FNV-1a over the text (null = the built-in default text) and the link.
  const src = [c.text ?? "(built-in text)", c.privacyUrl ?? ""].join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) h = Math.imul(h ^ src.charCodeAt(i), 0x01000193);
  return `1-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * The consent notice (F-019). `record()` is what goes out with feedback (wave-4 §6): the accepted version and
 * when, or undefined when the project has no notice or it hasn't been accepted.
 */
export function consentBlock(c: WidgetConfig["consent"], project: string) {
  const version = consentVersion(c);
  const need = c.enabled && !store.consent(project, version);
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
    accept: () => {
      if (need) store.setConsent(project, { version, acceptedAt: new Date().toISOString() });
    },
    record: () => (c.enabled ? (store.consent(project, version) ?? undefined) : undefined),
  };
}
