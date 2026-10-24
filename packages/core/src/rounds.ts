import { z } from "zod";
import { FEEDBACK_SORTS, feedbackKind, feedbackStatus, priority, SORT_ORDERS } from "./schemas";

// Review rounds (F-055) and saved views (wave-4 contract §2).

export const REVIEW_ROUND_STATUSES = ["active", "closed"] as const;
export type ReviewRoundStatus = (typeof REVIEW_ROUND_STATUSES)[number];

const dueAt = z.iso.datetime({ offset: true }).nullable();

export const reviewRoundCreate = z.object({
  name: z.string().trim().min(1).max(120),
  dueAt: dueAt.optional(),
});
export type ReviewRoundCreate = z.infer<typeof reviewRoundCreate>;

export const reviewRoundUpdate = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  dueAt: dueAt.optional(),
  status: z.enum(REVIEW_ROUND_STATUSES).optional(),
});
export type ReviewRoundUpdate = z.infer<typeof reviewRoundUpdate>;

export const ROUND_EXPORT_FORMATS = ["csv", "pdf"] as const;
export const roundExportQuery = z.object({ format: z.enum(ROUND_EXPORT_FORMATS).default("csv") });

// --- Saved views ---------------------------------------------------------------------------------------

export const VIEW_LAYOUTS = ["list", "board"] as const;

/**
 * The filters a view stores: the inbox list query without paging. No defaults here — a view keeps only
 * what the person chose, and the inbox fills the rest.
 */
export const viewFilters = z.object({
  projectId: z.uuid().optional(),
  status: z.union([feedbackStatus, z.literal("active"), z.literal("all")]).optional(),
  kind: feedbackKind.optional(),
  q: z.string().trim().max(200).optional(),
  priority: priority.optional(),
  roundId: z.uuid().optional(),
  assigneeId: z.string().max(100).optional(),
  page: z.string().trim().max(2000).optional(),
  since: z.iso.datetime({ offset: true }).optional(),
  /** Wave 5 (triage): label, reporter and the list order are part of a view too. */
  labelId: z.uuid().optional(),
  reporter: z.string().trim().max(254).optional(),
  /** Wave 5: items sent through one review link (F-012). */
  reviewLinkId: z.uuid().optional(),
  sort: z.enum(FEEDBACK_SORTS).optional(),
  order: z.enum(SORT_ORDERS).optional(),
});
export type ViewFilters = z.infer<typeof viewFilters>;

export const savedViewCreate = z.object({
  name: z.string().trim().min(1).max(80),
  filters: viewFilters.default({}),
  layout: z.enum(VIEW_LAYOUTS).default("list"),
  /** Shared views are visible to the whole organisation; personal ones only to their owner. */
  shared: z.boolean().default(false),
});
export type SavedViewCreate = z.infer<typeof savedViewCreate>;

export const savedViewUpdate = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  filters: viewFilters.optional(),
  layout: z.enum(VIEW_LAYOUTS).optional(),
  shared: z.boolean().optional(),
});
export type SavedViewUpdate = z.infer<typeof savedViewUpdate>;
