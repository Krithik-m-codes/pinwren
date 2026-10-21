import { AnnotaWidget, type WidgetOptions } from "./widget";

// Script-tag entry:
//   <script src="https://feedback.example.com/widget.js" data-project="pk_…" async></script>
// Optional: data-accent="#5b5bd6", data-endpoint="https://…" (defaults to the script's origin).

type Api = { init(o: WidgetOptions): void; destroy(): void };

const g = window as unknown as { Annota?: Api; __annotaInstance?: AnnotaWidget };

function init(opts: WidgetOptions) {
  if (g.__annotaInstance) return; // one widget per page
  try {
    const w = new AnnotaWidget(opts);
    g.__annotaInstance = w;
    void w.start().catch((err) => console.warn("[annota]", err));
  } catch (err) {
    // Never let the widget break the host page.
    console.warn("[annota] failed to start", err);
  }
}

g.Annota = {
  init,
  destroy() {
    g.__annotaInstance?.destroy();
    g.__annotaInstance = undefined;
  },
};

const script = document.currentScript as HTMLScriptElement | null;
const key = script?.dataset.project;
if (script && key) {
  const start = () =>
    init({
      projectKey: key,
      endpoint: (script.dataset.endpoint ?? new URL(script.src).origin).replace(/\/$/, ""),
      accent: script.dataset.accent,
    });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
