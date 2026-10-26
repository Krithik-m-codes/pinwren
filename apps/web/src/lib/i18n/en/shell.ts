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
} as const satisfies Record<string, string>;
