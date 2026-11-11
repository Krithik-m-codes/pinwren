import { z } from "zod";
import { feedbackKind, feedbackStatus } from "./schemas";

// Interactive Slack (F-071): a Slack app the admin creates for their workspace. Pinwren posts feedback cards
// with buttons through the app's bot token and verifies every inbound request with its signing secret.
// The same schemas serve the API, the settings screen and the Slack modal.

/** Events a channel route may carry. A subset of the webhook events: the ones that read well in a channel. */
export const SLACK_ROUTE_EVENTS = [
  "feedback.created",
  "feedback.status_changed",
  "feedback.assigned",
  "feedback.priority_changed",
  "comment.created",
] as const;
export type SlackRouteEvent = (typeof SLACK_ROUTE_EVENTS)[number];

/** Routes per workspace: more than anyone needs, and it bounds the fan-out of one event. */
export const MAX_SLACK_ROUTES = 50;

/** Slack ids: channels `C…`/`G…`, users `U…`/`W…`, teams `T…`/`E…`. */
export const SLACK_CHANNEL_ID = /^[CG][A-Z0-9]{8,14}$/;
export const SLACK_USER_ID = /^[UW][A-Z0-9]{8,14}$/;
export const SLACK_TEAM_ID = /^[TE][A-Z0-9]{8,14}$/;

/** Slack shows the signing secret as 32 hex characters; bot tokens start `xoxb-`. */
export const SLACK_SIGNING_SECRET = /^[0-9a-f]{32}$/i;
export const SLACK_BOT_TOKEN = /^xoxb-[A-Za-z0-9-]{20,200}$/;

const signingSecret = z
  .string()
  .trim()
  .regex(
    SLACK_SIGNING_SECRET,
    "The signing secret is 32 letters and digits (Basic Information in your Slack app)",
  );
const botToken = z
  .string()
  .trim()
  .regex(SLACK_BOT_TOKEN, "A bot token starts with xoxb- (OAuth & Permissions in your Slack app)");

/** First connection needs both; later edits may change either. */
export const slackConnect = z.object({ signingSecret, botToken });
export type SlackConnect = z.infer<typeof slackConnect>;
export const slackConnectionUpdate = z
  .object({
    signingSecret: signingSecret.optional(),
    botToken: botToken.optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");
export type SlackConnectionUpdate = z.infer<typeof slackConnectionUpdate>;

const routeEvents = z.array(z.enum(SLACK_ROUTE_EVENTS)).min(1).max(SLACK_ROUTE_EVENTS.length);

export const slackRouteCreate = z.object({
  /** null = every project in the workspace. */
  projectId: z.uuid().nullable().default(null),
  channelId: z.string().trim().regex(SLACK_CHANNEL_ID, "Pick a channel or paste its id (C0123456789)"),
  channelName: z.string().trim().max(80).nullable().optional(),
  events: routeEvents.default(["feedback.created"]),
});
export type SlackRouteCreate = z.infer<typeof slackRouteCreate>;

export const slackRouteUpdate = z.object({
  projectId: z.uuid().nullable().optional(),
  channelId: z.string().trim().regex(SLACK_CHANNEL_ID).optional(),
  channelName: z.string().trim().max(80).nullable().optional(),
  events: routeEvents.optional(),
});
export type SlackRouteUpdate = z.infer<typeof slackRouteUpdate>;

/** Send a test card to a route (or, without one, to any channel the app can post to). */
export const slackTest = z.object({
  routeId: z.uuid().optional(),
  channelId: z.string().trim().regex(SLACK_CHANNEL_ID).optional(),
});
export type SlackTest = z.infer<typeof slackTest>;

/** A signed token from the "link your account" message. */
export const slackLinkClaim = z.object({ token: z.string().min(20).max(1000) });
export type SlackLinkClaim = z.infer<typeof slackLinkClaim>;

export const SLACK_LINK_SOURCES = ["email", "manual"] as const;
export type SlackLinkSource = (typeof SLACK_LINK_SOURCES)[number];

/** Callback ids of the Slack app's shortcut and modal, as configured in the app manifest. */
export const SLACK_CALLBACKS = {
  messageShortcut: "pinwren_create_feedback",
  globalShortcut: "pinwren_new_feedback",
  modal: "pinwren_feedback_modal",
} as const;

/** Block Kit action ids on the feedback card. */
export const SLACK_ACTIONS = {
  assignMe: "pw_assign_me",
  setStatus: "pw_set_status",
  addLabel: "pw_add_label",
  open: "pw_open",
} as const;

export const slackModalValues = z.object({
  title: z.string().trim().max(200),
  body: z.string().trim().max(10_000),
  projectId: z.uuid(),
  kind: feedbackKind,
});
export type SlackModalValues = z.infer<typeof slackModalValues>;

/** Statuses the card's "Set status" menu offers. */
export const SLACK_STATUS_CHOICES = feedbackStatus.options;
