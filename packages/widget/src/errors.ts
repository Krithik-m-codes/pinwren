import { addEnglish, t } from "./i18n";
import { adoptStyle, h } from "./dom";
import { enErrors } from "./locales/en-errors";

// Error-triggered prompt (widget-errors.js, lazy): when an uncaught error or unhandled rejection happens on
// the host page and the project turned `errorPrompt` on, a small non-blocking toast offers to send a bug
// report. Nothing is sent or captured until the visitor clicks. The core loads this chunk only for projects
// that enabled it, so everyone else pays nothing.

addEnglish(enErrors);

/** What the report form is given: enough to pre-fill the title and attach the stack as diagnostics. */
export type ErrorInfo = { message: string; stack?: string | undefined; source?: string | undefined };

/** At most this many prompts per browser session, and no two closer than this many ms. */
export const MAX_PER_SESSION = 3;
export const MIN_GAP_MS = 30_000;
const SHOWN_MS = 12_000;
const OWN = /\/widget(-[\w.-]+)?\.js/;
const KEY = "pinwren:errprompt";
const CSS = /* css */ `
.errprompt { position: fixed; z-index: 2147483605; right: 16px; bottom: 16px; display: flex; align-items: center; gap: 8px;
  max-width: min(380px, calc(100vw - 32px)); padding: 10px 10px 10px 14px; border-radius: 12px; background: var(--fg); color: var(--bg);
  box-shadow: var(--shadow); font-size: 13px; font-weight: 500; animation: pop .14s ease-out; }
.errprompt .go { height: 28px; padding: 0 12px; border-radius: 8px; background: var(--accent); color: #fff; font-weight: 600; font-size: 12px; cursor: pointer; }
.errprompt .x { width: 24px; height: 24px; border-radius: 6px; color: inherit; opacity: .7; cursor: pointer; font-size: 16px; line-height: 1; }
`;

const session = {
  count(): number {
    try {
      return Number(sessionStorage.getItem(KEY)) || 0;
    } catch {
      return 0;
    }
  },
  bump(n: number) {
    try {
      sessionStorage.setItem(KEY, String(n));
    } catch {
      // private mode: the in-memory counter below still applies for this page view
    }
  },
};

/** A stable key for "the same error": message plus the first stack frame, with numbers (lines, ids) dropped. */
export function fingerprint(e: ErrorInfo): string {
  const frame = e.stack?.split("\n").find((l) => /^\s*at\s|@/.test(l)) ?? "";
  return `${e.message}|${frame}`.replace(/\d+/g, "#").slice(0, 300);
}

/** The error behind an `error` event or an unhandled rejection, or null for noise nobody can act on. */
export function describeError(reason: unknown, fallback?: string, source?: string): ErrorInfo | null {
  let message = "";
  let stack: string | undefined;
  if (reason instanceof Error) {
    message = `${reason.name}: ${reason.message}`;
    stack = reason.stack;
  } else if (typeof reason === "string") message = reason;
  else if (fallback) message = fallback;
  else if (reason && typeof reason === "object" && "message" in reason) message = String(reason.message);
  message = message.trim().slice(0, 300);
  // Cross-origin scripts report only "Script error." — there is nothing to attach, so don't bother the visitor.
  if (!message || /^script error\.?$/i.test(message)) return null;
  return { message, ...(stack ? { stack: stack.slice(0, 2000) } : {}), ...(source ? { source } : {}) };
}

/** Start listening; returns the function that stops it (and removes any prompt on screen). */
export function watch(
  root: HTMLElement,
  /** True while the widget is hidden/disabled for this page or a report is already open. */
  blocked: () => boolean,
  onSend: (e: ErrorInfo) => void,
): () => void {
  const seen = new Set<string>();
  let last = 0;
  let shown = session.count();
  let toast: HTMLElement | null = null;
  let timer = 0;
  adoptStyle(root, "errors", CSS);

  const hide = () => {
    clearTimeout(timer);
    toast?.remove();
    toast = null;
  };

  const offer = (e: ErrorInfo) => {
    // Our own files failing is the widget's problem, not the host's (and must not loop back into the prompt).
    if (OWN.test(e.stack ?? "") || OWN.test(e.source ?? "")) return;
    const key = fingerprint(e);
    if (seen.has(key)) return;
    seen.add(key);
    const now = Date.now();
    if (shown >= MAX_PER_SESSION || now - last < MIN_GAP_MS || toast || blocked()) return;
    last = now;
    session.bump(++shown);
    const go = h("button", { class: "go", type: "button" }, t("errPromptSend"));
    const x = h("button", { class: "x", type: "button", "aria-label": t("errPromptDismiss") }, "×");
    toast = h(
      "div",
      { class: "errprompt", role: "status", "aria-live": "polite" },
      t("errPromptText"),
      go,
      x,
    );
    go.addEventListener("click", () => {
      hide();
      onSend(e);
    });
    x.addEventListener("click", hide);
    root.append(toast);
    timer = window.setTimeout(hide, SHOWN_MS);
  };

  const onError = (ev: ErrorEvent) => {
    const info = describeError(ev.error, ev.message, ev.filename);
    if (info) offer(info);
  };
  const onRejection = (ev: PromiseRejectionEvent) => {
    const info = describeError(ev.reason);
    if (info) offer({ ...info, message: `Unhandled rejection: ${info.message}` });
  };
  addEventListener("error", onError);
  addEventListener("unhandledrejection", onRejection);
  return () => {
    removeEventListener("error", onError);
    removeEventListener("unhandledrejection", onRejection);
    hide();
  };
}

export type ErrorsModule = { watch: typeof watch };
(window as unknown as { __pinwrenErrors: ErrorsModule }).__pinwrenErrors = { watch };
