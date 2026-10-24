"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const CHORD_MS = 1000;

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  !!t.closest(
    "input, textarea, select, [contenteditable=true], [role=listbox], [role=menu], [role=alertdialog], [data-slot=dialog-content]",
  );

/**
 * Shortcuts that work on every app screen. `g m` opens My work (items assigned to you, every project).
 * It listens in the capture phase and swallows both keys of the chord, so a screen's own single-key
 * shortcuts (the inbox's `m` = move a card) never see them.
 */
export function GlobalShortcuts() {
  const router = useRouter();
  useEffect(() => {
    let chord = 0;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.key === "g") {
        chord = Date.now();
        e.stopImmediatePropagation();
        return;
      }
      if (chord && Date.now() - chord < CHORD_MS && e.key === "m") {
        chord = 0;
        e.preventDefault();
        e.stopImmediatePropagation();
        router.push("/inbox?assignee=me");
        return;
      }
      chord = 0;
    }
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [router]);
  return null;
}
