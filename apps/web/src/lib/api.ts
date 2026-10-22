import type {
  Entitlements,
  ViewFilters,
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

export { isForbidden } from "@/lib/store/api/base";

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
  hasIdentitySecret: boolean;
  archivedAt: string | null;
  updatedAt: string;
};

/** A reporter who isn't a member. `verified`: a signed identity checked by the server (wave-4 §4). */
export type Guest = { name?: string; email?: string; externalId?: string; verified?: boolean } | null;

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
  roundId: string | null;
  hasScreenshot: boolean;
  hasReplay: boolean;
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
  /** Replay: `{ durationMs, events }`. */
  meta: Record<string, unknown> | null;
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
  feedback: Omit<FeedbackRow, "hasScreenshot" | "hasReplay" | "attachmentCount" | "commentCount"> & {
    /** What the reporter accepted in the consent notice (F-019). */
    consent: { version: string; acceptedAt: string } | null;
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
  trustProxyHops: number;
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

const roles = (role: string | undefined | null) =>
  (role ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);

/** Viewers read everything and change nothing (wave-4 contract §4); the API answers 403 READ_ONLY_ROLE. */
export const isViewerRole = (role: string | undefined | null) => {
  const r = roles(role);
  return r.length > 0 && r.every((x) => x === "viewer");
};

// --- Wave 4 ------------------------------------------------------------------------------------------

export type ReviewRound = {
  id: string;
  projectId: string;
  name: string;
  dueAt: string | null;
  status: "active" | "closed";
  closedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  counts: { total: number; open: number; closed: number };
};

export type SavedView = {
  id: string;
  name: string;
  filters: ViewFilters;
  layout: "list" | "board";
  shared: boolean;
  ownerId: string;
  owner: { id: string; name: string | null };
  mine: boolean;
  createdAt: string;
  updatedAt: string;
};

/** `GET /api/admin/license`: entitlements plus where the licence comes from and what it says. */
export type LicenseInfo = Entitlements & {
  source: "file" | "upload" | null;
  details: {
    lid: string;
    customer: string;
    email: string | null;
    features: string[];
    limits: { seats?: number };
    issuedAt: string;
    expiresAt: string;
    graceDays: number;
    instance: string | null;
  } | null;
};

export type PresenceUser = { id: string; name: string; image: string | null };
