"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Kbd } from "@/app/(app)/inbox/kbd";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/lib/i18n/provider";
import { goTarget, SHORTCUT_GROUPS } from "@/lib/shortcuts";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { shortcutsToggled } from "@/lib/store/slices/ui";

const CHORD_MS = 1000;

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  !!t.closest(
    "input, textarea, select, [contenteditable=true], [role=listbox], [role=menu], [role=alertdialog], [data-slot=dialog-content]",
  );

/**
 * Shortcuts that work on every app screen: `g` then `i`/`d`/`p`/`n`/`s`/`m` to go somewhere, and `?` for the
 * help overlay. It listens in the capture phase and swallows both keys of a chord, so a screen's own
 * single-key shortcuts (the inbox's `m` = move a card, `p` = priority) never see them.
 */
export function GlobalShortcuts() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  useEffect(() => {
    let chord = 0;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.key === "g") {
        chord = Date.now();
        e.stopImmediatePropagation();
        return;
      }
      const to = chord && Date.now() - chord < CHORD_MS ? goTarget(e.key) : null;
      chord = 0;
      if (to) {
        e.preventDefault();
        e.stopImmediatePropagation();
        router.push(to);
      } else if (e.key === "?") {
        e.preventDefault();
        dispatch(shortcutsToggled(true));
      }
    }
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [router, dispatch]);
  return <ShortcutsHelp />;
}

/** The overlay `?` opens (also from the palette and the inbox's help button). */
function ShortcutsHelp() {
  const t = useT();
  const open = useAppSelector((s) => s.ui.shortcutsOpen);
  const dispatch = useAppDispatch();
  return (
    <Dialog open={open} onOpenChange={(o) => dispatch(shortcutsToggled(o))}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("inbox2.keyboardShortcuts")}</DialogTitle>
          <DialogDescription>{t("shortcuts.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[60svh] gap-4 overflow-y-auto">
          {SHORTCUT_GROUPS.map((g) => (
            <section key={g.title} aria-label={t(g.title)}>
              <h3 className="mb-2 text-xs font-medium text-muted-foreground uppercase">{t(g.title)}</h3>
              <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-2 text-sm">
                {g.rows.map(([k, label]) => (
                  <div key={k} className="contents">
                    <dt>
                      {k.split(" / ").map((part, i) => (
                        <span key={part}>
                          {i > 0 && <span className="text-muted-foreground"> / </span>}
                          {part.split(" ").map((p, j) => (
                            <span key={p}>
                              {j > 0 && " "}
                              <Kbd>{p}</Kbd>
                            </span>
                          ))}
                        </span>
                      ))}
                    </dt>
                    <dd className="text-muted-foreground">{t(label)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
