import { SLACK_CALLBACKS } from "@pinwren/core";
import { env } from "../env";

/** The two URLs Slack calls, derived from PINWREN_URL: shown in settings and used in the manifest. */
export function slackRequestUrls() {
  const base = env().PINWREN_URL.replace(/\/$/, "");
  return { interactivity: `${base}/api/slack/interactivity`, commands: `${base}/api/slack/commands` };
}

/** Bot scopes the app needs, with what each is for (the settings screen and docs list them). */
export const SLACK_SCOPES = [
  { scope: "chat:write", why: "post and update feedback cards" },
  { scope: "chat:write.public", why: "post to public channels without being invited" },
  { scope: "commands", why: "the /pinwren slash command" },
  { scope: "users:read", why: "look up who pressed a button" },
  { scope: "users:read.email", why: "match Slack people to Pinwren members by email" },
  { scope: "channels:read", why: "list public channels in the channel picker" },
  { scope: "groups:read", why: "list private channels the app is in" },
] as const;

/**
 * A Slack app manifest (api.slack.com/apps › Create New App › From a manifest) with the shortcuts, slash
 * command, scopes and request URLs already filled in for this server.
 */
export function slackManifest() {
  const urls = slackRequestUrls();
  return {
    display_information: {
      name: "Pinwren",
      description: "Triage Pinwren feedback without leaving Slack",
    },
    features: {
      bot_user: { display_name: "Pinwren", always_online: false },
      shortcuts: [
        {
          name: "Create feedback from message",
          type: "message",
          callback_id: SLACK_CALLBACKS.messageShortcut,
          description: "File this message as Pinwren feedback",
        },
        {
          name: "New Pinwren feedback",
          type: "global",
          callback_id: SLACK_CALLBACKS.globalShortcut,
          description: "File feedback in Pinwren",
        },
      ],
      slash_commands: [
        {
          command: "/pinwren",
          url: urls.commands,
          description: "File feedback and link your Pinwren account",
          usage_hint: "[new | link | help]",
          should_escape: false,
        },
      ],
    },
    oauth_config: { scopes: { bot: SLACK_SCOPES.map((s) => s.scope) } },
    settings: {
      interactivity: { is_enabled: true, request_url: urls.interactivity },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
}
