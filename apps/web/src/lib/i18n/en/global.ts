// App-wide helpers that came from the DocuSigner review (docs/superpowers/specs/2026-11-02-global-features.md):
// palette search and recents, the shortcuts overlay, and the start-page preference (ADR 0038).
export const global = {
  "shortcuts.description": "Keys that work on every screen, and the ones for the inbox. Press ? any time.",
  "shortcuts.groupGlobal": "Everywhere",
  "shortcuts.groupInbox": "Inbox",
  "shortcuts.goInbox": "Go to the inbox",
  "shortcuts.goDashboard": "Go to the dashboard",
  "shortcuts.goProjects": "Go to projects",
  "shortcuts.goNotifications": "Go to notifications",
  "shortcuts.goSettings": "Go to settings",
  "shortcuts.command": "Keyboard shortcuts",
  "shortcuts.copyLink": "Copy link to this page",
  "shortcuts.linkCopied": "Link copied",

  "palette.recent": "Recent",
  "palette.feedback": "Feedback",
  "palette.searching": "Searching feedback…",
  "palette.searchAll": "Search all feedback for “{q}”",

  "landing.label": "Start page",
  "landing.description": "Where Pinwren opens when you visit the site. Saved in your account.",
  "landing.inbox": "Inbox",
  "landing.dashboard": "Dashboard",
  "landing.myWork": "My work",
} as const;
