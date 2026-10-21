import type {
  AnchorBundle,
  API_TOKEN_SCOPES,
  CaptureConfig,
  EmailTemplateKey,
  FeedbackKind,
  FeedbackStatus,
  ISSUE_AUTO_CREATE,
  IssueProvider,
  NOTIFICATION_TYPES,
  PanelAction,
  Priority,
  WEBHOOK_EVENTS,
  WEBHOOK_KINDS,
  WidgetBranding,
  WidgetConfig,
} from "@pinwren/core";

/** Thrown for any non-2xx answer; carries the problem-details code (blueprint 04 §1). */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`/api${path}`, {
    ...rest,
    credentials: "same-origin",
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(res.status, data.code ?? "ERROR", data.title ?? res.statusText);
  }
  return data as T;
}

/** 403s for admin-only screens render as an explanation instead of an error. */
export const isForbidden = (e: unknown) => e instanceof ApiRequestError && e.status === 403;

export const assetUrl = (id: string) => `/api/assets/${id}`;

// --- Response shapes (mirror packages/api/src/routes/*) ----------------------------------------------

export type Project = {
  id: string;
  name: string;
  slug: string;
  publicKey: string;
  allowedOrigins: string[];
  publicRead: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  openCount?: number;
};

/** `GET /api/projects/:id` — the full row with complete configs (defaults filled by the API). */
export type ProjectDetail = Project & {
  widgetConfig: WidgetConfig;
  captureConfig: CaptureConfig;
  retentionDays: number | null;
  notifyReporter: boolean;
  widgetRateLimitPerMin: number | null;
  widgetBranding: WidgetBranding;
  hasActionSecret: boolean;
  archivedAt: string | null;
  updatedAt: string;
};

export type Guest = { name?: string; email?: string; externalId?: string } | null;

export type FeedbackRow = {
  id: string;
  number: number;
  kind: FeedbackKind;
  status: FeedbackStatus;
  priority: Priority;
  title: string | null;
  body: string;
  assigneeIds: string[];
  reporterGuest: Guest;
  createdAt: string;
  projectId: string;
  projectName: string;
  pageUrl: string | null;
  hasScreenshot: boolean;
  attachmentCount: number;
  commentCount: number;
};

export type FeedbackList = { items: FeedbackRow[]; nextCursor: string | null };

export type Member = { id: string; name: string; email: string; image: string | null; role: string };

export type Asset = {
  id: string;
  kind: "screenshot" | "screenshot_annotated" | "attachment" | (string & {});
  contentType: string;
  bytes: number;
  name: string | null;
};

export type Comment = {
  id: string;
  body: string;
  visibility: "public" | "internal";
  createdAt: string;
  editedAt: string | null;
  authorGuest: Guest;
  author: { id: string; name: string; image: string | null } | null;
};

export type ActivityEvent = {
  id: string;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
  actorKind: string;
  actorName: string | null;
};

export type FeedbackDetail = {
  feedback: Omit<FeedbackRow, "hasScreenshot" | "attachmentCount" | "commentCount"> & {
    environment: {
      userAgent?: string;
      browser?: string;
      os?: string;
      viewport?: { w: number; h: number };
      dpr?: number;
      locale?: string;
      timezone?: string;
      referrer?: string;
    } | null;
    metadata: Record<string, unknown> | null;
    anchor: AnchorBundle | null;
    pageTitle: string | null;
    projectSlug: string;
    resolvedAt: string | null;
    updatedAt: string;
  };
  /** Every panel action of the project, team-only ones included (wave-3 contract §1). */
  panelActions: PanelAction[];
  issues: IssueLink[];
  /** Trackers this item can be sent to. */
  integrations: { id: string; provider: IssueProvider; repo: string }[];
  assignees: { id: string; name: string; email: string; image: string | null }[];
  assets: Asset[];
  comments: Comment[];
  activity: ActivityEvent[];
  diagnostics: {
    console: { level: string; message: string; at: number }[] | null;
    network: { method: string; url: string; status: number; durationMs: number; at: number }[] | null;
  } | null;
};

export type Invitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  inviter: { id: string; name: string; email: string } | null;
};

export type NotificationItem = {
  id: string;
  type: (typeof NOTIFICATION_TYPES)[number];
  feedbackId: string | null;
  data: {
    projectId?: string;
    projectName?: string;
    number?: number;
    title?: string;
    actorName?: string;
    status?: FeedbackStatus;
    commentId?: string;
  };
  readAt: string | null;
  createdAt: string;
};

export type NotificationPreference = {
  projectId: string;
  projectName: string;
  newFeedback: boolean;
  assigned: boolean;
  replies: boolean;
  statusChanges: boolean;
  email: boolean;
};

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export type WebhookKind = (typeof WEBHOOK_KINDS)[number];

export type Webhook = {
  id: string;
  name: string | null;
  url: string;
  kind: WebhookKind;
  events: WebhookEvent[];
  projectId: string | null;
  active: boolean;
  failingSince: string | null;
  hasSecret: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WebhookDelivery = {
  id: string;
  eventId: string;
  event: string;
  attempt: number;
  status: "pending" | "success" | "retrying" | "failed";
  responseCode: number | null;
  responseBody: string | null;
  error: string | null;
  durationMs: number | null;
  nextRetryAt: string | null;
  createdAt: string;
};

export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

export type ApiToken = {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiTokenScope[];
  userId: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export type EmailField = "host" | "port" | "user" | "password" | "secure" | "from";

export type EmailSettings = {
  host: string | null;
  port: number | null;
  user: string | null;
  secure: boolean;
  from: string | null;
  passwordSet: boolean;
  locked: Record<EmailField, boolean>;
  configured: boolean;
};

export type EmailTestResult = { sent: true; to: string } | { sent: false; skipped: boolean; reason: string };

export type IssueLink = {
  id: string;
  integrationId: string;
  provider: IssueProvider;
  number: number;
  url: string;
  state: "open" | "closed";
};

export type IssueIntegration = {
  id: string;
  projectId: string;
  provider: IssueProvider;
  repo: string;
  apiUrl: string | null;
  labels: string[];
  autoCreate: (typeof ISSUE_AUTO_CREATE)[number];
  active: boolean;
  tokenHint: string;
  lastError: string | null;
  webhookUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type ActionResult = { ok: boolean; status: number; message: string | null; error: string | null };

export type OrgBranding = {
  productName: string | null;
  accent: string | null;
  logoAssetId: string | null;
  logoUrl: string | null;
};

export type EmailTemplate = {
  key: EmailTemplateKey;
  name: string;
  description: string;
  variables: { name: string; description: string; sample: string }[];
  defaultSubject: string;
  defaultBody: string;
  subject: string;
  body: string;
  customized: boolean;
  updatedAt: string | null;
};

export type RenderedEmail = { subject: string; html: string; text: string };

export type SecuritySettings = {
  sessionDays: number;
  updateCheck: boolean;
  enforceHttps: boolean;
  trustProxy: boolean;
  locked: { sessionDays: boolean; updateCheck: boolean };
  privacyModeProjects: number;
  version: string;
  update: {
    checkedAt: string;
    latest: string | null;
    url: string | null;
    available: boolean;
    error: string | null;
  } | null;
};

export type MeResponse = {
  user: { id: string; name: string; email: string; image: string | null };
  orgId: string;
  role: string;
  instanceAdmin: boolean;
  update: { latest: string | null; url: string | null } | null;
};

// --- Query keys -------------------------------------------------------------------------------------
// Lists and details live under ["feedback", …] so one invalidation refreshes both; thumbnails use their
// own key so a mutation doesn't refetch every card's detail.

export const qk = {
  projects: ["projects"] as const,
  project: (id: string) => ["project", id] as const,
  members: ["members"] as const,
  feedbackLists: ["feedback", "list"] as const,
  feedbackList: (params: Record<string, string | undefined>) => ["feedback", "list", params] as const,
  feedback: (id: string) => ["feedback", "detail", id] as const,
  thumb: (id: string) => ["feedback-thumb", id] as const,
  notifications: ["notifications"] as const,
  me: ["me"] as const,
  branding: ["branding"] as const,
  integrations: (projectId: string) => ["integrations", projectId] as const,
  emailTemplates: ["email-templates"] as const,
  security: ["admin", "security"] as const,
};

/** First screenshot of an item (annotated preferred), for thumbnails. */
export function screenshotOf(assets: Asset[]): Asset | undefined {
  return assets.find((a) => a.kind === "screenshot_annotated") ?? assets.find((a) => a.kind === "screenshot");
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const isAdminRole = (role: string | undefined | null) =>
  !!role && role.split(",").some((r) => r.trim() === "owner" || r.trim() === "admin");
