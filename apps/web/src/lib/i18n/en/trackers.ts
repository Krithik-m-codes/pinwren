// Strings for the board trackers (Trello, Asana, ClickUp, Notion) in projects/[id]/trackers-tab.tsx (ADR 0029).
export const trackers = {
  "trackers.descTrello":
    "Creates a card on your board for each feedback item. Moving the card to the done list (or archiving it) resolves the item, and resolving the item moves the card there.",
  "trackers.descAsana":
    "Creates a task in your project for each feedback item. Completing the task resolves the item, and resolving the item completes the task.",
  "trackers.descClickup":
    "Creates a task in your list for each feedback item. Moving the task to a closed status resolves the item, and resolving the item sets that status.",
  "trackers.descNotion":
    "Adds a page to your database for each feedback item. Setting its status to done resolves the item, and resolving the item sets that status.",

  "trackers.tokenTrello": "Token",
  "trackers.tokenAsana": "Personal access token",
  "trackers.tokenClickup": "API token",
  "trackers.tokenNotion": "Integration secret",
  "trackers.tokenHelpTrello":
    "Create a Power-Up at trello.com/power-ups/admin, generate its API key, then authorise a token for it with read and write access. Stored encrypted.",
  "trackers.tokenHelpAsana":
    "Create a personal access token in Asana › My settings › Apps › Developer apps. Stored encrypted; never shown again.",
  "trackers.tokenHelpClickup":
    "Create a personal API token in ClickUp › Settings › Apps. Stored encrypted; never shown again.",
  "trackers.tokenHelpNotion":
    "Create an internal integration at notion.so/profile/integrations and share the database with it (••• › Connections). Stored encrypted.",

  "trackers.apiKey": "API key",
  "trackers.apiKeyHelp": "The API key of the Power-Up the token was issued for.",

  "trackers.repoTrello": "Board id",
  "trackers.repoAsana": "Project id",
  "trackers.repoClickup": "List id",
  "trackers.repoNotion": "Database id",
  "trackers.repoHelpTrello":
    "Open the board and add .json to its address: the first id in the file is the board id. The 8-character short link in the address works too.",
  "trackers.repoHelpAsana": "The number after /project/ (or /0/) in the project's address.",
  "trackers.repoHelpClickup": "In the list's address, or via ••• › Copy link: the number after /v/li/.",
  "trackers.repoHelpNotion": "The 32-character id in the database's address, before the ?v= part.",

  "trackers.mappingTitle": "Mapping",
  "trackers.mappingHelpTrello":
    "Pick the list new cards go to; a done list is optional (without one, archiving closes the item). Priorities map to label names on the board.",
  "trackers.mappingHelpAsana":
    "All optional. Priority maps an item's priority to an option of a custom field in the project.",
  "trackers.mappingHelpClickup":
    "All optional. Statuses default to the list's closed and first open status; priorities default to ClickUp's 1 (urgent) to 4 (low).",
  "trackers.mappingHelpNotion":
    "All optional. The status property is a Status, Select or Checkbox; priorities map to options of a Select or Status property.",
  "trackers.mappingSaved": "Mapping saved",

  "trackers.field.listId": "New cards go to list",
  "trackers.field.doneListId": "Done list",
  "trackers.field.sectionGid": "Section",
  "trackers.field.priorityField": "Priority field",
  "trackers.field.teamId": "Workspace id",
  "trackers.field.openStatus": "Open status",
  "trackers.field.closedStatus": "Closed status",
  "trackers.field.statusProperty": "Status property",
  "trackers.field.openValue": "Open value",
  "trackers.field.closedValue": "Done value",
  "trackers.field.priorityProperty": "Priority property",
  "trackers.field.priorityLow": "Priority: low",
  "trackers.field.priorityMedium": "Priority: medium",
  "trackers.field.priorityHigh": "Priority: high",
  "trackers.field.priorityUrgent": "Priority: urgent",

  "trackers.hookTrello":
    "Paste the Power-Up's app secret (Power-Up admin › API key › Secret), then register the webhook. Trello signs every delivery with that secret.",
  "trackers.hookAsana":
    "Register the webhook: Asana calls Pinwren once to hand over the signing secret, then reports completed and reopened tasks.",
  "trackers.hookClickup":
    "Register the webhook: ClickUp returns the signing secret with it, then reports status changes of tasks in the list.",
  "trackers.hookNotion":
    "In the integration's Webhooks tab, create a subscription for page property updates with this URL. Notion posts a verification token to it, which Pinwren keeps to verify later deliveries. Reveal it below to type it into Notion's verification dialog.",
  "trackers.appSecret": "App secret from Trello",
  "trackers.registerWebhook": "Register webhook",
  "trackers.registerAgain": "Register again",
  "trackers.webhookRegistered": "Webhook registered",
  "trackers.registered": "Webhook registered in {name}",
  "trackers.waitingSecret": "Waiting for the signing secret",
  "trackers.waitingToken": "Waiting for Notion's verification token",
  "trackers.verified": "Verified",
  "trackers.restartHandshake": "Wait for a new token",
  "trackers.handshakeRestarted": "Waiting for a new verification token",
  "trackers.pasteSecretFirst": "Paste the app secret before registering the webhook.",
} as const;
