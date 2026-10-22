import { z } from "zod";
import { COMMENT_VISIBILITIES, feedbackKind, feedbackStatus, priority } from "./schemas";

// Real-time inbox (F-050, wave-4 contract §1): `GET /api/stream` (SSE) and the presence heartbeat.

export const STREAM_EVENTS = [
  "feedback.created",
  "feedback.updated",
  "feedback.deleted",
  "comment.created",
  "presence",
  "ping",
] as const;
export type StreamEventName = (typeof STREAM_EVENTS)[number];

/** Heartbeat every 20 s; a viewer disappears 45 s after their last one. */
export const PRESENCE_HEARTBEAT_MS = 20_000;
export const PRESENCE_TTL_MS = 45_000;
export const STREAM_PING_MS = 25_000;

export const presenceUpdate = z.object({
  /** The item the person has open, or null when they left it. */
  feedbackId: z.uuid().nullable(),
});
export type PresenceUpdate = z.infer<typeof presenceUpdate>;

export const streamQuery = z.object({
  /** Comma-separated project ids; omitted = every project of the active organisation. */
  projectIds: z
    .string()
    .max(4000)
    .optional()
    .transform((v) =>
      v
        ? v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    )
    .pipe(z.array(z.uuid()).max(100)),
});

const iso = z.string();

export const streamFeedbackCreated = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  number: z.number().int(),
  kind: feedbackKind,
  status: feedbackStatus,
  priority,
  title: z.string().nullable(),
  createdAt: iso,
});

export const streamFeedbackUpdated = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  /** field → `{ from, to }`. Large values are dropped (`truncated: true`); refetch the item. */
  changes: z.record(z.string(), z.unknown()),
  truncated: z.boolean().optional(),
});

export const streamFeedbackDeleted = z.object({ id: z.uuid(), projectId: z.uuid() });

export const streamCommentCreated = z.object({
  id: z.uuid(),
  feedbackId: z.uuid(),
  projectId: z.uuid(),
  visibility: z.enum(COMMENT_VISIBILITIES),
  authorName: z.string().nullable(),
});

export const presenceUser = z.object({ id: z.string(), name: z.string(), image: z.string().nullable() });
export type PresenceUser = z.infer<typeof presenceUser>;

export const streamPresence = z.object({
  feedbackId: z.uuid(),
  projectId: z.uuid(),
  users: z.array(presenceUser),
});

export type StreamEvent =
  | { event: "feedback.created"; data: z.infer<typeof streamFeedbackCreated> }
  | { event: "feedback.updated"; data: z.infer<typeof streamFeedbackUpdated> }
  | { event: "feedback.deleted"; data: z.infer<typeof streamFeedbackDeleted> }
  | { event: "comment.created"; data: z.infer<typeof streamCommentCreated> }
  | { event: "presence"; data: z.infer<typeof streamPresence> }
  | { event: "ping"; data: Record<string, never> };
