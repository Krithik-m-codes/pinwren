import { z } from "zod";
import { feedbackKind, feedbackStatus, priority } from "./schemas";

export const GUEST_PAGE_TOKENS_HEADER = "x-pinwren-page-tokens";
export const MAX_GUEST_ACCESS_TOKENS = 50;

export const guestPortalAccess = z
  .object({
    reporterTokens: z
      .array(z.string().regex(/^[A-Za-z0-9_-]{16,128}$/))
      .max(50)
      .default([]),
    pageTokens: z
      .array(
        z
          .string()
          .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
          .max(512),
      )
      .max(50)
      .default([]),
  })
  .strict()
  .refine(
    (a) => a.reporterTokens.length + a.pageTokens.length <= MAX_GUEST_ACCESS_TOKENS,
    "Too many access tokens",
  );
export type GuestPortalAccess = z.infer<typeof guestPortalAccess>;

export const guestFeedback = z.object({
  id: z.uuid(),
  number: z.number().int(),
  kind: feedbackKind,
  status: feedbackStatus,
  priority,
  title: z.string().nullable(),
  body: z.string(),
  createdAt: z.string(),
  pageUrl: z.string().nullable(),
  replyCount: z.number().int(),
});
export type GuestFeedback = z.infer<typeof guestFeedback>;

export const guestReply = z.object({
  id: z.uuid(),
  body: z.string(),
  createdAt: z.string(),
  authorName: z.string().nullable(),
  team: z.boolean(),
});
export type GuestReply = z.infer<typeof guestReply>;
export const guestReplyCreate = z.object({ body: z.string().trim().min(1).max(10_000) }).strict();
export type GuestReplyCreate = z.infer<typeof guestReplyCreate>;

export const guestPortalResponse = z.object({
  project: z.object({ name: z.string(), key: z.string(), canReply: z.boolean() }),
  branding: z.object({
    productName: z.string(),
    logoUrl: z.string().nullable(),
    accent: z.string().nullable(),
    hidePoweredBy: z.boolean(),
  }),
  items: z.array(guestFeedback),
});
export type GuestPortalResponse = z.infer<typeof guestPortalResponse>;
export const guestThreadResponse = z.object({ item: guestFeedback, replies: z.array(guestReply) });
export type GuestThreadResponse = z.infer<typeof guestThreadResponse>;
