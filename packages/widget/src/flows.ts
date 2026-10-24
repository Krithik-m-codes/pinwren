import type { AnchorBundle, CaptureGeometry } from "@pinwren/core";
import { type Attachment, FILE_TYPES, readFile, validateFiles } from "./attachments";
import type { CaptureModule } from "./capture";
import { loadChunk } from "./chunks";
import { adoptStyle, h, icon } from "./dom";
import { FLOWS_CSS as CSS } from "./flows-styles";
import { t } from "./i18n";
import * as I from "./icons";
import { type Pick, Picker } from "./picker";

// The lazy widget-flows.js chunk: the less common flows, kept out of widget.js (wave-5 §3.3).
//   - attachments in the comment composer (the bug report has its own, in widget-report.js)
//   - re-pin mode, opened from a team member's "Re-pin on page" link (F-031)
// It shares the core's modules through window.__pinwrenLib (build.mjs), so only this glue is in the file.

export type AttachBox = {
  el: HTMLElement;
  /** Validate and read files; refusals go to `error` (one message per reason). */
  add(files: File[]): Promise<void>;
  list(): Attachment[];
};

/** The composer's attachment chips. `initial` restores what a failed send had. */
export function attachBox(
  root: HTMLElement,
  error: (msg: string) => void,
  initial: Attachment[] = [],
): AttachBox {
  adoptStyle(root, "flows", CSS);
  let files = initial.slice();
  const el = h("div", { class: "cfiles", role: "list", "aria-label": t("attachments") });
  const render = () => {
    el.replaceChildren(
      ...files.map((f, i) =>
        h(
          "span",
          { class: "cfile", role: "listitem" },
          icon(f.contentType === "application/pdf" ? I.file : I.clip),
          h("span", { title: f.name }, f.name),
          h(
            "button",
            {
              type: "button",
              "aria-label": t("removeFile", { name: f.name }),
              onclick: () => {
                files = files.filter((_, j) => j !== i);
                render();
              },
            },
            icon(I.close),
          ),
        ),
      ),
    );
  };
  render();
  return {
    el,
    async add(list) {
      const { accepted, errors } = validateFiles(files.length, list);
      if (errors.length) error(errors.join(" "));
      for (const f of accepted) {
        try {
          files.push(await readFile(f));
        } catch {
          error(t("genericError"));
        }
      }
      render();
    },
    list: () => files.slice(),
  };
}

/** What the comment composer's file picker accepts. */
export const ACCEPT = FILE_TYPES.join(",");

export type RepinCtx = {
  host: HTMLElement;
  root: HTMLElement;
  /** `#12`, shown in the banner. */
  number: number;
  /** Anchor bundle for what was picked (the core's anchor capture). */
  anchorOf(pick: Pick): AnchorBundle;
  save(anchor: AnchorBundle): Promise<void>;
  toast(text: string): void;
  /** The flow ended; `moved` when the new pin was saved. */
  done(moved: boolean): void;
};

/**
 * Re-pin mode: a banner and the comment picker; the team member clicks (or drags) where the item belongs and
 * the new anchor is saved through the re-pin link. Esc or Cancel leaves it as it was. Returns a cancel function.
 */
export function startRepin(ctx: RepinCtx): () => void {
  adoptStyle(ctx.root, "flows", CSS);
  let over = false;
  let picker: Picker | null = null;
  const finish = (moved: boolean) => {
    if (over) return;
    over = true;
    picker?.stop();
    picker = null;
    banner.remove();
    ctx.done(moved);
  };
  const banner = h(
    "div",
    { class: "repin", role: "status", "aria-live": "polite" },
    h("span", {}, t("repinHint", { n: ctx.number })),
    h("button", { type: "button", onclick: () => finish(false) }, t("cancel")),
  );
  ctx.root.append(banner);
  picker = new Picker(ctx.host, ctx.root, (pick) => {
    picker?.stop();
    picker = null;
    if (!pick) {
      finish(false);
      return;
    }
    banner.firstElementChild?.replaceChildren(t("repinSaving"));
    ctx.save(ctx.anchorOf(pick)).then(
      () => {
        ctx.toast(t("repinDone", { n: ctx.number }));
        finish(true);
      },
      () => {
        ctx.toast(t("repinFailed"));
        finish(false);
      },
    );
  });
  return () => finish(false);
}

/** How long a new comment waits for its screenshot before it is sent without one. */
const SHOT_MS = 8000;

/**
 * "Screenshot with every comment" (wave-5 §3.3): a masked capture of the visible area and the viewport it shows
 * (Page Review places the item on it). Null when it fails or takes longer than SHOT_MS — the comment then goes
 * without it.
 */
export async function commentShot(
  assets: string,
  masks: string[],
): Promise<{ screenshot: string; capture: CaptureGeometry } | null> {
  const capture: CaptureGeometry = {
    vw: Math.max(1, Math.min(20_000, Math.round(innerWidth))),
    vh: Math.max(1, Math.min(20_000, Math.round(innerHeight))),
    scrollY: Math.max(0, Math.round(scrollY)),
    mode: "visible",
  };
  let timer = 0;
  try {
    const canvas = await Promise.race([
      loadChunk<CaptureModule>(assets, "capture").then((m) => m.capture("visible", masks)),
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error("Screenshot timed out")), SHOT_MS);
      }),
    ]);
    // WebP, or JPEG where the browser can't encode it; the API takes at most 11 MB of data URL.
    for (const q of [0.8, 0.5]) {
      const webp = canvas.toDataURL("image/webp", q);
      const screenshot = webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", q);
      if (screenshot.length <= 10_500_000) return { screenshot, capture };
    }
    return null;
  } catch (err) {
    console.warn("[pinwren] comment sent without a screenshot:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type FlowsModule = {
  attachBox: typeof attachBox;
  startRepin: typeof startRepin;
  commentShot: typeof commentShot;
  ACCEPT: string;
};
(window as unknown as { __pinwrenFlows: FlowsModule }).__pinwrenFlows = {
  attachBox,
  startRepin,
  commentShot,
  ACCEPT,
};
