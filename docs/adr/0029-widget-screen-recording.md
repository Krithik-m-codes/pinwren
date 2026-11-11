# ADR 0029 — Screen recording with optional voice narration, in a lazy widget chunk

**Status:** accepted. **Supersedes** the v1 non-goal "video recording of the screen (use replay instead)" in
[blueprint 01 §G](../../blueprint/01-feature-spec.md).

## Why the non-goal goes

The v1 position was that session replay (rrweb, masked, tiny) covers "show us what happened", so a video would be
cost and risk for nothing. In practice reporters do not think in replays. Jam, Bird Eats Bug, Gleap and Feedbucket
all let someone press record, talk through the problem and send a clip; the team watches ninety seconds instead of
reading a paragraph. Replay stays the right tool for what led up to the report (it needs no action from the
reporter, it is masked, it is data rather than pixels); a recording is the right tool for what the reporter wants to
show and say. They coexist: both are optional, both are attached to the same report.

The cost the old note was guarding against is real, so this ADR keeps it small: a chunk of its own, off the page
until a report opens, a hard size and length ceiling, no new dependency, no new storage service, no migration.

## Decision

**Reporter-initiated, in the bug report only.** **Record screen** sits next to **Add screenshot**. A comment
(pin) cannot carry a recording. The reporter sees a notice (what is captured, that nothing leaves the browser until
Send, the maximum length, an **Add voice narration** switch), then the browser's own share prompt
(`getDisplayMedia`, `preferCurrentTab`, so the current tab is offered first), then a 3-2-1 countdown, a recording with
pause and a live timer, and a review step (play, **Record again**, **Discard**, **Attach**). Narration is a separate
`getUserMedia` call with its own permission prompt, made after the screen is granted; refusing the microphone records
without sound and says so rather than failing.

**Format.** `MediaRecorder` with WebM (VP9, then VP8, then the browser's WebM default) or MP4 on Safari, chosen by
`isTypeSupported`. The video bitrate is derived from the size budget and the project's maximum length (2.5 Mbps at
most, 250 kbps at least), so a recording that runs its whole length still fits the 16 MB cap; the recorder is also
stopped just short of the cap. Defaults: 120 s, project-configurable 10 to 300 s, **300 s is a hard cap** no setting
exceeds (the schema and the widget both enforce it).

**The controls must not be in the picture.** A tab capture records what the page paints. The widget is hidden
before the first frame (the report, launcher and countdown are gone), and the controls live where the capture does not
reach:

1. a **Document Picture-in-Picture** window (Chrome and Edge 116+), a separate window a tab capture does not include;
2. otherwise a corner of the page that is **fully transparent until the pointer or keyboard focus is in it**, plus
   **Alt+Shift+S** (stop) and **Alt+Shift+P** (pause) from anywhere on the page. The countdown tells the reporter
   this. Moving the pointer away before stopping keeps the controls out of the clip; the shortcut never shows them.

The browser's own "Stop sharing" ends a recording too and is treated as a normal stop. Escape is left to the page.
Element Capture (`RestrictionTarget`, Chrome 132+) would exclude the widget natively, but it crops to the element's
box and its behaviour with a scrolling body is not something we can verify without real browsers; it is a follow-up,
not a dependency of this design.

Opening the PiP window needs a user gesture, and `getDisplayMedia` may consume the click's activation first, so
the PiP path may be refused on some browser versions; the corner is the path that always works.

**Cleanup is a requirement, not a nicety.** Every track of both streams is stopped, the recorder's handlers are
detached, timers and the key listeners removed, the PiP window closed and every object URL revoked on stop, retake,
discard, failure, and when the report closes or the widget is destroyed mid-recording. The state machine
(`record-logic.ts`) has no phase from which "the capture keeps running" is reachable.

**Consent and privacy.**

- The notice is the consent step: it names what is recorded, and that masking does not apply
  (`data-pinwren-mask` and the project's mask selectors blur pixels in our own screenshot capture; they cannot
  touch a video of the tab). That is why this is off by default in privacy mode.
- `capture.recording.enabled` is tri-state in the project's capture configuration: `null` (the default) follows the
  project, which is **on, but off in privacy mode**; an explicit `true`/`false` always wins, so an admin can allow
  recordings in a privacy-mode project deliberately. `GET /w/config` resolves it (`recordingEnabled()` in
  `@pinwren/core`) so the widget only ever sees a boolean, and the server re-checks it on `POST /w/feedback`: a
  report from an old or modified widget has its recording dropped when recordings are off (the same rule as replay).
  A read-only project takes none.
- Nothing is uploaded until the report is sent; the clip is held in memory and in an object URL, and is **not**
  persisted in the draft (a video would not fit IndexedDB sensibly and a draft restoring a clip nobody remembers is a
  privacy surprise). Closing the dialog discards an attached recording.
- Project settings: enable recording, maximum length (10 to 300 s), offer voice narration. The microphone setting only
  decides whether the switch is offered; the browser always asks.

**Wire and storage, without a migration.** Pinwren has no separate upload path: screenshots, attachments and replays
all travel inside `POST /w/feedback` as data URLs, checked by `decodeDataUrl` (declared type, size and the file's real
signature) before anything is stored (the "direct-to-storage parts upload" of other projects does not exist here).
A recording follows that existing path as a `recording` field (`{ dataUrl, durationMs, audio, width?, height? }`):

- allowed types are `video/webm` (EBML header `1A 45 DF A3`) and `video/mp4` (an `ftyp` box at byte 4), with storage
  keys ending `.webm` / `.mp4`; no audio-only type, because narration always rides on the screen recording;
- at most 16 MiB decoded and at most the project's maximum length plus 5 s of slack, else `400 INVALID_RECORDING`;
- stored as an **attachment** asset with `meta: { recording: true, durationMs, audio, width, height }`. This avoids a
  new value in the `asset_kind` enum (a migration, and the next free numbers are spoken for) and means retention,
  data deletion, export and the hourly storage budget (`WIDGET_PROJECT_MB_PER_HOUR`) already apply. The dashboard
  tells recordings from files by that metadata. A recording does not count towards the three file attachments and is
  never served under a share link (share links serve only screenshots, thumbnails and replays);
- `MAX_REPORT_BODY` rises from 48 MiB to 72 MiB (a 16 MiB clip is 22.4 M characters of base64). The body is still
  refused by `Content-Length` before anything is read, and rate limits are unchanged. The cost is memory per large
  report on the server; a streamed multipart upload would remove it and is the first thing to build if recordings
  turn out to be heavily used.

**Serving needs byte ranges.** Safari will not play a video from a server that does not answer `Range`, and every
browser seeks with it. `respondWithAsset` now answers a single `bytes=a-b` range for video types (`206`,
`Content-Range`, `Accept-Ranges`; an unsatisfiable range is `416`), and serves `video/*` attachments `inline`. The
sandbox CSP and `nosniff` are unchanged.

**Dashboard.** The detail page gets a **Screen recording** section above the attachments with a player built from
design-system controls (no native controls, so every control is a labelled, keyboard-reachable button): play/pause,
a seek slider whose spoken value is the position ("0:12 of 0:42"), speed, mute (only when there is a voice),
full screen, a **Download recording** link, and the length and size. A browser-made WebM has no duration in its
header, so the widget's measured length stands in for it. The Capture tab gets the three project settings. English
and the ten other dashboard catalogues, and the eleven widget locales, carry real translations.

## Bundle and size budgets

| Artifact              | Before         | After        | Budget (gzip)                 |
| --------------------- | -------------- | ------------ | ----------------------------- |
| `widget.js` (core)    | 35 834 B       | **35 799 B** | 35 KiB = 35 840 B, unchanged  |
| `widget-record` (new) | n/a            | **8 816 B**  | **14 KiB**, `build.mjs` + e2e |
| `widget-report`       | about 14.4 KiB | 14 974 B     | 15 KiB (15 360 B), unchanged  |
| `widget-shots`        | 9 832 B        | 9 832 B      | 12 KiB, unchanged             |

The core carries the new project settings as an unchecked pass-through (`capture.recording`, validated inside the
chunk) and the default capture configuration is now `resolveCapture(undefined)` instead of a duplicated literal,
which more than pays for it: the core is 35 bytes smaller than before. The report chunk grows by the small glue that
loads the recording chunk (only when the project allows recordings and the report opens), mounts the button, and
packs the clip on send. `widget-record.js` is never requested on a page view, on a report for a project with
recordings off, or by an older server (Playwright checks this). Per-language strings live in `locales/<code>-record.ts`
and are merged into each language file by `build.mjs`, so adding a chunk's strings no longer touches every language
file.

## Consequences

- Recordings are bytes of the reporter's screen, voice included. They are personal data like any attachment, and are
  deleted with the report, by retention and by a reporter's data deletion. Admins who cannot accept that switch them
  off per project; privacy mode switches them off for them.
- Unverified here: behaviour in real Chrome, Safari and Firefox sessions (the prompts, Picture-in-Picture, MP4 on
  Safari, MediaRecorder timing). The automated tests use a canvas stream in headless Chromium with the real
  `MediaRecorder`, and a fake Picture-in-Picture window in unit tests.
- Mobile browsers cannot capture the screen from a page; the notice says so and **Add screenshot** remains.
- Follow-ups worth doing: Element Capture to exclude the widget natively; a streamed upload for large clips;
  trimming; transcripts.
