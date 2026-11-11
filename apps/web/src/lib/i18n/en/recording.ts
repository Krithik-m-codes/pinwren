// Strings for: components/recording-player.tsx, the "Screen recording" section of inbox/feedback-detail.tsx and
// the recording card of projects/[id]/capture-tab.tsx (ADR 0029).
export const recording = {
  "recording.heading": "Screen recording",
  "recording.playerLabel": "Screen recording: {name}",
  "recording.play": "Play",
  "recording.pause": "Pause",
  "recording.seek": "Seek",
  "recording.position": "{time} of {total}",
  "recording.speed": "Playback speed {rate}×",
  "recording.mute": "Mute",
  "recording.unmute": "Unmute",
  "recording.fullscreen": "Full screen",
  "recording.download": "Download recording",
  "recording.details": "{duration} · {size}",
  "recording.withVoice": "with voice",
  "recording.failed": "This recording couldn't be played in your browser. You can download it instead.",
  "recording.cardTitle": "Screen recording",
  "recording.cardDescription":
    "Let reporters record their browser tab, with optional voice narration, from the bug report. The clip is stored with the report and plays on its detail page.",
  "recording.allow": "Allow screen recordings",
  "recording.allowDescription":
    "On by default. A recording shows everything visible in the reporter's tab, including fields you mask elsewhere.",
  "recording.allowPrivacyDescription":
    "This project is in privacy mode, so recordings are off until you switch them on here. A recording shows everything visible in the reporter's tab, including fields you mask elsewhere.",
  "recording.maxLength": "Maximum length",
  "recording.maxLengthDescription":
    "A recording stops by itself at this length ({min} to {max} seconds). Files are also capped at 16 MB.",
  "recording.maxLengthAria": "Maximum recording length in seconds",
  "recording.microphone": "Offer voice narration",
  "recording.microphoneDescription":
    "Reporters can add their voice. The browser always asks them for permission first.",
  "recording.on": "Screen recording on",
  "recording.off": "Screen recording off",
  "recording.lengthSaved": "Recordings stop after {n} seconds",
  "recording.micOn": "Voice narration offered",
  "recording.micOff": "Voice narration not offered",
} as const;
