import type {
  AppRole,
  Entitlements,
  ViewFilters,
  AnchorBundle,
  AnnotationLayer,
  API_TOKEN_SCOPES,
  CaptureConfig,
  CaptureGeometry,
  EmailTemplateKey,
  FeedbackKind,
  FeedbackStatus,
  ISSUE_AUTO_CREATE,
  IssueProvider,
  NOTIFICATION_TYPES,
  PanelAction,
  Priority,
  RejectedOrigin,
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
  /** Origins the widget refused for this project's key, newest first (wave-5 §1); "Allow" adds them. */
  rejectedOrigins: RejectedOrigin[];
  /** PINWREN_URL: the address install snippets point at (may differ from the browser's). */
  publicUrl: string;
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
  /** The card thumbnail (annotated first), from the list itself. */
  screenshotAssetId: string | null;
  attachmentCount: number;
  commentCount: number;
  labels: ItemLabel[];
  dueAt: string | null;
  updatedAt: string;
  /** Set on items in the trash (`?trash=1`). */
  deletedAt: string | null;
};

/** `total`: every item matching the filters (all pages). */
export type FeedbackList = { items: FeedbackRow[]; nextCursor: string | null; total?: number };

/** A label as items carry it. */
export type ItemLabel = { id: string; name: string; color: string };
/** `GET /api/projects/:id/labels`: with the number of live items carrying it. */
export type Label = ItemLabel & { count: number };

/** Another item, by number and title (duplicates). */
export type ItemRef = { id: string; number: number; title: string };

/** `GET /api/members`: `id` is the user id (assignee pickers, mentions). */
export type Member = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
  /** Wave 5 (routes/members.ts). */
  userId?: string;
  memberId?: string;
  appRole?: AppRole;
  createdAt?: string;
};

export type Asset = {
  id: string;
  kind: "screenshot" | "screenshot_annotated" | "attachment" | (string & {});
  contentType: string;
  bytes: number;
  name: string | null;
  /** Replay: `{ durationMs, events }`. */
  meta: Record<string, unknown> | null;
  /** Screenshot: the reporter's vector annotations and the capture geometry (wave-5 contract §3.3). */
  annotations?: AnnotationLayer | null;
  capture?: CaptureGeometry | null;
};

export type Comment = {
  id: string;
  body: string;
  visibility: "public" | "internal";
  createdAt: string;
  editedAt: string | null;
  /** Member ids @mentioned in a team comment. */
  mentions?: string[];
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
  feedback: Omit<
    FeedbackRow,
    "hasScreenshot" | "hasReplay" | "attachmentCount" | "commentCount" | "screenshotAssetId"
  > & {
    /** The item this one duplicates (status `duplicate`). */
    duplicateOf: ItemRef | null;
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
    /** The review link a guest sent it through (F-012): its source in the Details tab. */
    reviewLink: { id: string; label: string } | null;
    projectSlug: string;
    resolvedAt: string | null;
    updatedAt: string;
  };
  /** Items marked as duplicates of this one. */
  duplicates: ItemRef[];
  /** Whether the signed-in member follows the item. */
  watching: boolean;
  /** Where a public reply goes: under the pin (`publicRead`), by email (`notifyReporter` + an address). */
  replyReach: { publicRead: boolean; notifyReporter: boolean; reporterHasEmail: boolean };
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
  ai?:
    | {
        feedbackId: string;
        suggestedTitle?: string | null | undefined;
        summary?: string | null | undefined;
        suggestedPriority?: Priority | null | undefined;
        suggestedKind?: FeedbackKind | null | undefined;
        duplicateCandidateId?: string | null | undefined;
        duplicateCandidate?: { id: string; number: number; title: string | null } | null | undefined;
        duplicateConfidence?: number | null | undefined;
        duplicateReason?: string | null | undefined;
        reproductionSteps?: string[] | undefined;
        status: "pending" | "completed" | "failed" | "skipped";
        model?: string | null | undefined;
        tokensUsed?: number | null | undefined;
        error?: string | null | undefined;
      }
    | null
    | undefined;
  translations?:
    | {
        id: string;
        targetLocale: string;
        title?: string | null | undefined;
        body: string;
        createdAt?: string | undefined;
      }[]
    | undefined;
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
    actorName?: string | null;
    status?: FeedbackStatus;
    commentId?: string;
    /** comment, bug, idea or question (wave 5). */
    kind?: string;
    priority?: string;
    previousPriority?: string;
    /** `webhook.disabled`: the webhook's name and last error. */
    webhookId?: string;
    name?: string;
    lastError?: string | null;
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
  mentioned: boolean;
  priorityChanges: boolean;
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
  /** Telegram: the chat it posts to. */
  chatId: string | null;
  events: WebhookEvent[];
  projectId: string | null;
  active: boolean;
  failingSince: string | null;
  /** generic: a signing secret exists; ntfy: an access token is set. */
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

export type EmailField =
  "host" | "port" | "user" | "password" | "secure" | "from" | "requireTls" | "allowSelfSigned";

export type EmailSettings = {
  host: string | null;
  port: number | null;
  user: string | null;
  secure: boolean;
  from: string | null;
  requireTls: boolean;
  allowSelfSigned: boolean;
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
  /** Jira: the Atlassian account email. */
  email: string | null;
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
  faviconAssetId: string | null;
  faviconUrl: string | null;
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
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
    /** Wave 5: whether the address was confirmed (verification is offered, never required). */
    emailVerified?: boolean;
    twoFactorEnabled?: boolean;
  };
  orgId: string;
  role: string;
  /** Wave-5 §3.1: Admin / Editor / Viewer, for `roleCan` from @pinwren/core. */
  appRole: AppRole;
  instanceAdmin: boolean;
  /** Nobody administers the instance yet (only before the first account exists). */
  setupNeeded: boolean;
  /** SMTP is set up, so emails (invitations, resets, notifications) really go out. */
  emailConfigured: boolean;
  /** Someone without an invitation could create an account now. */
  signupOpen: boolean;
  update: { latest: string | null; url: string | null } | null;
};

/** `GET /api/setup`: public first-run state for the sign-in screens. */
export type SetupStatus = {
  /** No account exists yet: the first one becomes the administrator. */
  needed: boolean;
  signupOpen: boolean;
  emailConfigured: boolean;
  /** PINWREN_URL's origin. */
  appUrl: string;
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

export type {
  AiProviderType,
  AiProviderConfig,
  ProjectAiConfig,
  AiEnrichmentResponse,
  AiTranslationRequest,
  AiTranslationResponse,
} from "@pinwren/core";

export type OrgAiSettings = {
  provider: "anthropic" | "openai" | "ollama";
  model: string;
  baseUrl?: string | undefined;
  enabled: boolean;
  hasKey: boolean;
};

export type TestAiResult = {
  ok: boolean;
  latencyMs?: number | undefined;
  error?: string | undefined;
};
