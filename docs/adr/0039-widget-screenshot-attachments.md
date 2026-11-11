# ADR 0039 — "Add screenshot" for attachments lives in its own lazy chunk

**Status:** accepted

Reporters had to take a screenshot themselves and upload it. The bug report's attachment area now has an
"Add screenshot" menu: visible area, full page, a dragged area, one element, or the browser's own tab
capture (`getDisplayMedia` with `preferCurrentTab`, reachable from a page only this way), then the annotation
editor, then a thumbnail with annotate / retake / remove and a zoom/pan lightbox.

The core (`widget.js`) is at its 35 KiB gzip budget, so none of this goes there. The menu, drag-to-select,
thumbnails, lightbox and annotate dialog are a new content-hashed chunk, `widget-shots.<hash>.js`, downloaded
together with the report form (like the editor and capture chunks) and never on a normal page view. The
capture itself reuses `widget-capture.js` (SnapDOM and `screenShare`); no new capture engine is added.

- Core: unchanged budget (35 KiB = 35 840 bytes gzip). Registering the chunk replaced a per-chunk lookup
  table with a computed global name, so the core grew by one byte (35 697 → 35 698).
- New chunk budget: **12 KiB gzip** (about 9.6 KiB today), enforced by `build.mjs` and `wave4.e2e.ts`.
- Report chunk stays under its 15 KiB limit (13.5 KiB): the old thumbnail list moved out, a plain name list
  remains as the fallback if the shots chunk fails to load.
- A tab capture shows the viewport only; "full page" and "element" use the DOM capture, as before. A
  "selected area" is cropped from a viewport capture, so it uses the DOM path too.
