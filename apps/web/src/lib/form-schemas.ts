import {
  API_TOKEN_SCOPES,
  apiTokenCreate,
  emailSettingsUpdate,
  emailTemplateUpdate,
  issueIntegrationCreate,
  licenseUpload,
  projectCreate,
  reviewRoundCreate,
  savedViewCreate,
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

export const createProjectForm = z.object({
  name: required("Name the project", projectCreate.shape.name),
  site: hostInput,
});
export const onboardingForm = z.object({
  org: z.string().trim().min(1, "Name your workspace").max(80),
  project: projectCreate.shape.name.or(z.literal("")),
  site: hostInput,
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

export const webhookForm = z.object({
  name: z.string().trim().max(80),
  // The API's rule (webhookCreate.url: an http(s) URL, ≤ 2000 characters) with a message people can act on.
  url: required(
    "Enter the endpoint URL",
    z
      .url({ protocol: /^https?$/, error: "Use an http(s) URL" })
      .max(webhookCreate.shape.url.maxLength ?? 2000),
  ),
  kind: z.enum(WEBHOOK_KINDS),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Pick at least one event"),
  /** "all" or a project id. */
  projectId: z.string(),
});

export const trackerForm = z.object({
  token: required("Paste an access token", issueIntegrationCreate.shape.token),
  repo: required("Enter the repository", issueIntegrationCreate.shape.repo),
  apiUrl: z.union([
    z.literal(""),
    z.url({ protocol: /^https?$/, error: "Enter a full URL, like https://…" }),
  ]),
  labels: z.string().max(600),
  autoCreate: issueIntegrationCreate.shape.autoCreate,
});

export const emailSettingsForm = z.object({
  host: z.union([
    z.literal(""),
    z
      .string()
      .trim()
      .regex(/^[a-z0-9.-]+$/i, "A hostname like smtp.example.com"),
  ]),
  port: emailSettingsUpdate.shape.port,
  user: z.string(),
  secure: z.boolean(),
  from: z.union([
    z.literal(""),
    z
      .string()
      .trim()
      .regex(/\S+@\S+\.\S+/, "An address like Pinwren <noreply@example.com>"),
  ]),
  password: z.string(),
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
