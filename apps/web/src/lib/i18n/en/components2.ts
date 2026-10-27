// Strings for: avatar-upload, copy-button, date-picker, not-installed-empty, notifications-bell, number-input,
// secret-dialog, shell/command-palette, shell/license-banner, shell/sidebar-lists, shell/workspace-from-link,
// shell/workspace-switcher, views/view-dialogs.
export const components2 = {
  // avatar-upload
  "components2.avatarBadType": "Use a PNG, JPEG or WebP image",
  "components2.avatarTooBig": "The picture must be 512 KB or smaller",
  "components2.avatarUpdated": "Profile picture updated",
  "components2.avatarUploadFailed": "Upload failed",
  "components2.avatarReplaceLabel": "Replace profile picture",
  "components2.avatarUploadLabel": "Upload a profile picture",
  "components2.uploading": "Uploading…",
  "components2.replace": "Replace",
  "components2.uploadPicture": "Upload picture",
  "components2.avatarRemoved": "Profile picture removed",
  "components2.remove": "Remove",
  "components2.avatarHint": "PNG, JPEG or WebP, up to 512 KB.",

  // copy-button
  "components2.copied": "Copied",
  "components2.copy": "Copy",
  "components2.copyFailed": "Couldn't copy — select the text and copy it manually",

  // date-picker
  "components2.pickDate": "Pick a date",
  "components2.clearDate": "Clear date",

  // not-installed-empty
  "components2.installWidgetOn": "Install the widget on {name}",
  "components2.installWidgetOnSite": "Install the widget on your site",
  "components2.installWidgetHint":
    "Nothing can arrive until the widget is on your site. Paste one snippet, then send a test report from the page.",
  "components2.openInstallTab": "Open the Install tab",

  // notifications-bell
  "components2.notifications": "Notifications",
  "components2.notificationsUnread": "Notifications, {count} unread",
  "components2.markAllRead": "Mark all read",
  "components2.notificationsLoadFailed": "Couldn't load notifications.",
  "components2.retry": "Retry",
  "components2.allCaughtUp": "You're all caught up",
  "components2.allCaughtUpHint": "New reports, assignments, replies and mentions show up here.",
  "components2.unread": "Unread",
  "components2.viewAllNotifications": "View all notifications",

  // number-input
  "components2.numberRequired": "Required",
  "components2.numberWholeOnly": "Whole numbers only",
  "components2.numberBetween": "Between {min} and {max}",

  // secret-dialog
  "components2.secretOnce": "This is the only time it's shown. Store it somewhere safe now.",
  "components2.secretSaved": "I've saved it",

  // shell/command-palette
  "components2.inbox": "Inbox",
  "components2.projects": "Projects",
  "components2.commandPalette": "Command palette",
  "components2.commandPaletteHint": "Go to a screen, a project or a saved view.",
  "components2.goToPlaceholder": "Go to…",
  "components2.noResults": "No results.",
  "components2.goTo": "Go to",
  "components2.settings": "Settings",
  "components2.views": "Views",
  "components2.actions": "Actions",
  "components2.newProject": "New project",
  "components2.lightTheme": "Light theme",
  "components2.darkTheme": "Dark theme",
  "components2.systemTheme": "System theme",

  // shell/license-banner
  "components2.licenceExpired":
    "Your Enterprise licence has expired. Enterprise settings keep working but are read-only until it's renewed.",
  "components2.licenceGrace": "Your Enterprise licence has expired — everything keeps working until {date}.",
  "components2.licenceGraceEnds": "the grace period ends",
  "components2.manageLicence": "Manage licence",

  // shell/sidebar-lists
  "components2.savedViews": "Saved views",
  "components2.viewsEmpty": "Save inbox filters as a view to see them here.",
  "components2.viewActions": "Actions for view {name}",
  "components2.edit": "Edit",
  "components2.delete": "Delete",
  "components2.deleteViewTitle": "Delete “{name}”?",
  "components2.deleteViewShared": "It disappears for everyone in the workspace.",
  "components2.deleteViewPersonal": "Only the view goes; no feedback is deleted.",
  "components2.viewDeleted": "View “{name}” deleted",
  "components2.noProjectsYet": "No projects yet.",

  // shell/workspace-from-link
  "components2.openingWorkspace": "Opening the item's workspace…",
  "components2.workspaceDenied":
    "You don't have access to this item's workspace. Ask one of its Admins to add you.",
  "components2.dismiss": "Dismiss",

  // shell/workspace-switcher
  "components2.switchWorkspace": "Switch workspace",
  "components2.workspaces": "Workspaces",
  "components2.workspacesLoadFailed": "Couldn't load. Try again",
  "components2.currentWorkspace": "Current workspace",
  "components2.opening": "Opening…",
  "components2.createWorkspace": "Create workspace",
  "components2.workspaceSettings": "Workspace settings",
  "components2.workspaceCreateFailed": "Couldn't create the workspace",
  "components2.createAWorkspace": "Create a workspace",
  "components2.createWorkspaceHint":
    "A separate team with its own projects, users and settings. You'll be its owner.",
  "components2.workspaceName": "Workspace name",
  "components2.workspaceNamePlaceholder": "Acme Studio",
  "components2.cancel": "Cancel",
  "components2.creating": "Creating…",

  // views/view-dialogs
  "components2.viewSavedNamed": "“{name}” saved",
  "components2.viewSaved": "View “{name}” saved",
  "components2.editView": "Edit view",
  "components2.saveView": "Save view",
  "components2.viewFormEditHint": "Rename it, or change who can see it.",
  "components2.viewFormNewHint": "Keeps these filters and the layout one click away in the sidebar.",
  "components2.name": "Name",
  "components2.viewNamePlaceholder": "Urgent bugs",
  "components2.shareWithTeam": "Share with the team",
  "components2.shareHintCan": "Everyone in the workspace sees it in their sidebar.",
  "components2.shareHintCannot": "Viewers keep personal views only.",
  "components2.saving": "Saving…",
  "components2.save": "Save",
} as const satisfies Record<string, string>;
