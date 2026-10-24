import {
  API_TOKEN_SCOPES,
  apiTokenCreate,
  emailSettingsUpdate,
  emailTemplateUpdate,
  ISSUE_PROVIDERS,
  issueIntegrationCreate,
  licenseUpload,
  projectCreate,
  reviewRoundCreate,
  savedViewCreate,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  trackerRepoError,
  WEBHOOK_EVENTS,
  WEBHOOK_KINDS,
  webhookCreate,
} from "@pinwren/core";
import { z } from "zod";

// Form schemas. Wherever the API has a request schema in @pinwren/core, the form uses it (or a pick /
// extension of it), so the dashboard refuses exactly what the server would. Fields that exist only in a
// form (a password confirmation, a domain typed as a URL) are added here.

const email = z.email("Enter a valid email address").max(254);
const password = z.string().min(8, "Use at least 8 characters").max(128);

export const signInForm = z.object({ email, password: z.string().min(1, "Enter your password") });
export const signUpForm = z.object({
  name: z.string().trim().min(1, "Enter your name").max(120),
  email,
  password,
});
export const changePasswordForm = z
  .object({ current: z.string().min(1, "Enter your current password"), next: password, confirm: z.string() })
  .refine((v) => v.next === v.confirm, { path: ["confirm"], message: "The new passwords don't match" });
export const profileForm = z.object({ name: z.string().trim().min(1, "Your name can't be empty").max(120) });

/** A site typed as `www.example.com`, `https://…/path` or `*.example.com` → the host the API stores. */
export const hostInput = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => v.replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
  .refine((v) => v === "" || /^(\*\.)?[a-z0-9.-]+(:\d{1,5})?$/.test(v), {
    message: "Enter a domain like www.example.com, *.example.com or localhost:3000",
  });

/** A required text field with a friendly message, then the API's own rules for it. */
const required = <T extends z.ZodType<string, string>>(message: string, rules: T) =>
  z.string().trim().min(1, message).pipe(rules);

/** "What is this site for?" (`POST /api/projects { preset }`, wave-5 §3.5). */
const projectPreset = z.enum(["public-site", "review"]);

export const createProjectForm = z.object({
  name: required("Name the project", projectCreate.shape.name),
  site: hostInput,
  preset: projectPreset,
});
export const onboardingForm = z.object({
  org: z.string().trim().min(1, "Name your workspace").max(80),
  project: projectCreate.shape.name.or(z.literal("")),
  site: hostInput,
  preset: projectPreset,
});
export const originForm = z.object({
  host: hostInput.refine((v) => v !== "", { message: "Enter a domain" }),
});

export const inviteForm = z.object({
  email,
  role: z.enum(["admin", "member", "viewer"]),
});

export const createTokenForm = z.object({
  name: required("Give the token a name", apiTokenCreate.shape.name),
  scopes: z.array(z.enum(API_TOKEN_SCOPES)).min(1, "Pick at least one scope"),
  expiry: z.enum(["30", "90", "365", "never"]),
});

const httpUrl = z
  .url({ protocol: /^https?$/, error: "Use an http(s) URL" })
  .max(webhookCreate.shape.url.unwrap().maxLength ?? 2000);

/**
 * Add a webhook. Telegram takes a bot token + chat id instead of a URL; ntfy a topic URL and an optional
 * access token (core's webhookCreate rules, with messages people can act on).
 */
export const webhookForm = z
  .object({
    name: z.string().trim().max(80),
    url: z.string().trim(),
    kind: z.enum(WEBHOOK_KINDS),
    events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Pick at least one event"),
    /** "all" or a project id. */
    projectId: z.string(),
    botToken: z.string().trim(),
    chatId: z.string().trim(),
    accessToken: z.string().trim().max(200),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "telegram") {
      if (!TELEGRAM_BOT_TOKEN.test(v.botToken)) {
        ctx.addIssue({
          code: "custom",
          path: ["botToken"],
          message: v.botToken
            ? "A bot token looks like 123456789:AA…"
            : "Paste the bot token from @BotFather",
        });
      }
      if (!TELEGRAM_CHAT_ID.test(v.chatId)) {
        ctx.addIssue({
          code: "custom",
          path: ["chatId"],
          message: "A numeric chat id (e.g. -1001234567890) or @channelname",
        });
      }
      return;
    }
    if (!v.url) {
      ctx.addIssue({ code: "custom", path: ["url"], message: "Enter the URL" });
      return;
    }
    const url = httpUrl.safeParse(v.url);
    if (!url.success) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: url.error.issues[0]?.message ?? "Use an http(s) URL",
      });
    } else if (v.kind === "ntfy" && !/\/[-_A-Za-z0-9]{1,64}$/.test(new URL(v.url).pathname)) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: "Use the topic URL, like https://ntfy.sh/my-topic",
      });
    }
    if (v.kind === "ntfy" && v.accessToken && v.accessToken.length < 4) {
      ctx.addIssue({ code: "custom", path: ["accessToken"], message: "That token looks too short" });
    }
  });

/**
 * An optional text field: empty (not set) or valid by `rule`. A union of `""` and the rule would fail with
 * zod's generic "Invalid input" instead of the rule's message, so it's one string with a refinement.
 */
const blankOr = (rule: z.ZodType<string>, message: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || rule.safeParse(v).success, message);

/** Connect a tracker; the repository / key rule depends on the provider (core's trackerRepoError). */
export const trackerForm = z
  .object({
    provider: z.enum(ISSUE_PROVIDERS),
    token: required("Paste the token", issueIntegrationCreate.shape.token),
    repo: z.string().trim(),
    apiUrl: blankOr(z.url({ protocol: /^https?$/ }), "Enter a full URL, like https://…"),
    email: blankOr(z.email(), "Enter an email address"),
    labels: z.string().max(600),
    autoCreate: issueIntegrationCreate.shape.autoCreate,
    webhookSecret: blankOr(z.string().min(16).max(200), "Paste the whole signing secret"),
  })
  .superRefine((v, ctx) => {
    const repoError = v.repo ? trackerRepoError(v.provider, v.repo) : "Fill this in";
    if (repoError) ctx.addIssue({ code: "custom", path: ["repo"], message: repoError });
    if (v.provider === "jira") {
      if (!v.apiUrl) ctx.addIssue({ code: "custom", path: ["apiUrl"], message: "Enter your Jira site URL" });
      if (!v.email)
        ctx.addIssue({ code: "custom", path: ["email"], message: "Enter the Atlassian account email" });
    }
  });

export const emailSettingsForm = z.object({
  host: blankOr(z.string().regex(/^[a-z0-9.-]+$/i), "A hostname like smtp.example.com"),
  port: emailSettingsUpdate.shape.port,
  user: z.string(),
  secure: z.boolean(),
  // The server checks the same shape (email/config.ts isValidFrom): one address, optionally named.
  from: blankOr(
    z
      .string()
      .regex(
        /^(?:[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+|(?:"[^"]*"|[^<>",;]+?)\s*<[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+>)$/,
      ),
    "An address like noreply@example.com or Pinwren <noreply@example.com>",
  ),
  password: z.string(),
  requireTls: z.boolean(),
  allowSelfSigned: z.boolean(),
});

export const emailTemplateForm = emailTemplateUpdate;

export const roundForm = z.object({
  name: required("Name the round", reviewRoundCreate.shape.name),
  dueAt: z.date().nullable(),
});

export const saveViewForm = z.object({
  name: required("Name the view", savedViewCreate.shape.name),
  shared: z.boolean(),
});

export const licenseForm = z.object({
  license: required("Paste the licence or drop the .lic file", licenseUpload.shape.license),
});
