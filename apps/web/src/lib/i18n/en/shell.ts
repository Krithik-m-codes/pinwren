// Sidebar, user menu, workspace switcher, command palette, global shortcuts and banners.
export const shell = {
  "nav.search": "Search",
  "nav.inbox": "Inbox",
  "nav.projects": "Projects",
  "nav.settings": "Settings",
  "nav.myWork": "My work",

  "language.label": "Language",
  "language.description": "The language of this dashboard. Automatic follows your browser.",
  "language.auto": "Automatic (browser)",
  "language.saveFailed": "Couldn't save your language",

  "user.updateAvailable": "Update available",
  "user.readOnly": "Read-only access",
  "user.readOnlyHint": "Your role is Viewer: you can see everything but change nothing.",
  "user.accountMenu": "Account menu",
  "user.profileSettings": "Profile & settings",
  "user.theme": "Theme",
  "user.themeLight": "Light",
  "user.themeDark": "Dark",
  "user.themeSystem": "System",
  "user.signOut": "Sign out",

  "edition.community": "Community Edition",
  "edition.enterprise": "Enterprise Edition",
  "edition.updateWaiting": "An update is available",
  "edition.updateStrip": "Pinwren {latest} is out (you are on {current}).",
  "edition.updateHow": "To update, pull the new image and restart:",
  "edition.releaseNotes": "Release notes",
  "edition.dismiss": "Dismiss",
  "edition.supportText":
    "Enjoying Pinwren? It is free and open source. A star on GitHub or a sponsorship helps keep it going.",
  "edition.star": "Star on GitHub",
  "edition.sponsor": "Sponsor",
  "edition.dontAskAgain": "Don't ask again",
} as const satisfies Record<string, string>;
