# Interactive Slack (F-071)

Design: `docs/adr/0029-interactive-slack.md`. User docs: `apps/www/content/docs/integrations/slack.mdx`.

## Routes

Inbound (no session, `capability` boundary, signed by the Slack app):

| Route                           | Body                                    | Handles                                                                                               |
| ------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `POST /api/slack/interactivity` | form: `payload=<json>`                  | `block_actions` (card buttons and menus), `message_action`, `shortcut`, `view_submission` (the modal) |
| `POST /api/slack/commands`      | form: `team_id`, `user_id`, `text`, ... | `/pinwren [help \| new [title] \| link]`                                                              |

Settings (workspace Admins unless noted; all `tenant`):

| Route                                         | Does                                                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `GET /api/slack`                              | Connection (token hint only), routes, member mapping, request URLs, scopes, manifest                                   |
| `PUT /api/slack`                              | Connect or change credentials / pause; proves the token with `auth.test`; 409 if the team belongs to another workspace |
| `DELETE /api/slack`                           | Disconnect (routes, links and message records cascade)                                                                 |
| `GET /api/slack/channels`                     | Channels for the picker; a failure is `{ channels: [], error }`, not an HTTP error                                     |
| `POST/PATCH/DELETE /api/slack/routes[/:id]`   | Channel routes: project (or all), channel id, events (`SLACK_ROUTE_EVENTS`), max 50                                    |
| `POST /api/slack/test`                        | Always 200 `{ ok, message }`; posts a test message to a route's channel                                                |
| `POST /api/slack/sync-members`                | Map Slack users to members by confirmed email (first 1,000 Slack users)                                                |
| `DELETE /api/slack/links/:id`                 | Unlink one Slack user                                                                                                  |
| `POST /api/slack/link` (any signed-in member) | Accept a `/slack/link?token=` link: maps the token's Slack user to the caller                                          |

## Action ids

Card: block id `pw:<feedbackId>` with `pw_assign_me` (button, `value` = item id), `pw_set_status` (select, option value =
status), `pw_add_label` (select, option value = label id) and `pw_open` (link button). Modal `pinwren_feedback_modal`
with blocks `title`, `body`, `project`, `kind` (input action id `v`); `private_metadata` is `{ c: channel, ts: message ts }`.
Shortcuts: `pinwren_create_feedback` (message), `pinwren_new_feedback` (global).

## Manual check against a real Slack workspace

Not covered by CI (the Web API is a test double).

1. Create the app from the manifest in Settings › Integrations › Slack, install it, paste the signing secret and bot token.
2. Add a route to a test channel with `feedback.created` and `feedback.status_changed`; press **Send test message**.
3. File a report from the widget: a card appears. Press **Assign to me**, **Set status**, **Add label**; the card updates and
   the item's timeline says "via Slack".
4. Change the status in the dashboard: the card refreshes and a thread reply appears.
5. From a user whose Slack email differs from their Pinwren email: press a button, follow **Link my Pinwren account**, confirm.
6. On a message choose **Create feedback from message**; submit; the item has the permalink and source Slack.
7. Run `/pinwren help`, `/pinwren new Something broke` and `/pinwren link`.
8. Disconnect: the buttons stop working and the routes are gone.
