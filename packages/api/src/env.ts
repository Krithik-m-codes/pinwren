import { z } from "zod";

const bool = (fallback: "true" | "false") =>
  z
    .enum(["0", "1", "true", "false"])
    .default(fallback)
    .transform((v) => v === "1" || v === "true");

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v?.trim() ? v.trim() : undefined));

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PINWREN_URL: z.url("PINWREN_URL must be the public URL, e.g. https://feedback.example.com"),
  PINWREN_SECRET: z.string().min(32, "PINWREN_SECRET must be at least 32 characters"),
  PINWREN_DATA_DIR: z.string().default("./data"),
  /**
   * Unset: anyone may create the first account; after that, sign-up is closed (invitations still
   * work). "false" keeps open sign-up on; "true" behaves like unset (first account and invitees only).
   */
  PINWREN_DISABLE_SIGNUP: z
    .enum(["true", "false", ""])
    .optional()
    .transform((v) => (v === undefined || v === "" ? undefined : v === "true")),
  /**
   * Reverse proxies in front of the app: how many X-Forwarded-For hops to trust (true = 1). 0/false:
   * forwarded headers are ignored and the socket address is used.
   */
  PINWREN_TRUST_PROXY: z
    .string()
    .trim()
    .regex(/^(true|false|\d{1,2})$/i, "use a number of proxy hops, true (= 1) or false")
    .default("false")
    .transform((v) => (/^true$/i.test(v) ? 1 : /^false$/i.test(v) ? 0 : Number(v))),
  /**
   * Hosts (`gitlab.internal`, `*.corp.example`) and CIDRs (`10.0.0.0/8`) that webhooks, panel actions
   * and tracker URLs may reach although they are private. Everything private is refused otherwise.
   */
  PINWREN_OUTBOUND_ALLOWLIST: optionalString,
  /** Development and tests only: let outbound requests reach any address. */
  PINWREN_OUTBOUND_ALLOW_PRIVATE: bool("false"),
  /** all = serve HTTP and run jobs; web = serve only (jobs are still enqueued); worker = jobs only. */
  PINWREN_ROLE: z.enum(["all", "web", "worker"]).default("all"),
  /**
   * Comma-separated emails of instance admins. Besides these, an admin can only be made with the
   * one-time setup token printed to the server log (ADR 0021).
   */
  PINWREN_ADMIN_EMAILS: optionalString,
  WIDGET_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),
  /** Per project, whatever the sender's address: reports per minute and stored bytes per hour. */
  WIDGET_PROJECT_REPORTS_PER_MIN: z.coerce.number().int().positive().default(120),
  WIDGET_PROJECT_MB_PER_HOUR: z.coerce.number().int().positive().default(500),
  /** Invitations an organisation may send per hour. */
  PINWREN_INVITES_PER_HOUR: z.coerce.number().int().positive().default(30),

  // Security. PINWREN_ENFORCE_HTTPS redirects/refuses plain-HTTP requests that don't come from
  // localhost (X-Forwarded-Proto/Host count only with PINWREN_TRUST_PROXY).
  PINWREN_ENFORCE_HTTPS: bool("false"),
  /** Session lifetime in days for new sign-ins; set here, it locks the admin-UI field. */
  PINWREN_SESSION_DAYS: z.coerce.number().int().min(1).max(90).optional(),
  /** Daily release check (instance admins see "Update available"). Set here, it locks the UI switch. */
  PINWREN_UPDATE_CHECK: z
    .enum(["0", "1", "true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "1" || v === "true")),
  /** GitHub repository whose latest release is compared with PINWREN_VERSION. */
  PINWREN_UPDATE_REPO: z
    .string()
    .regex(/^[\w.-]+\/[\w.-]+$/)
    .default("Krithik-m-codes/pinwren"),
  PINWREN_VERSION: z.string().default("0.2.0"), // x-release-please-version

  // Enterprise licence (F-098). A file path here overrides and locks the upload in Settings › Licence.
  PINWREN_LICENSE_FILE: optionalString,
  /** Optional: licences with an `instance` binding only verify on the instance with this id. */
  PINWREN_INSTANCE_ID: optionalString,

  // Sign-in with Google / GitHub (Settings › Security › Sign-in methods). A provider is offered only when
  // both its id and secret are set; the callback is PINWREN_URL/api/auth/callback/<google|github>.
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GITHUB_CLIENT_ID: optionalString,
  GITHUB_CLIENT_SECRET: optionalString,

  // Issue trackers (F-076/F-077). Per-integration base URLs override these (GHES, self-managed GitLab).
  GITHUB_API_URL: z.url().default("https://api.github.com"),
  GITLAB_URL: z.url().default("https://gitlab.com"),

  // Email. Each variable set here overrides and locks the matching admin-UI field.
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  SMTP_SECURE: z
    .enum(["0", "1", "true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "1" || v === "true")),
  /** Refuse to send unless the server upgrades with STARTTLS. */
  SMTP_REQUIRE_TLS: z
    .enum(["0", "1", "true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "1" || v === "true")),
  /** `false` accepts a self-signed server certificate (the admin UI's "Allow self-signed certificate"). */
  SMTP_TLS_REJECT_UNAUTHORIZED: z
    .enum(["0", "1", "true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "1" || v === "true")),
  EMAIL_FROM: optionalString,

  // Storage
  STORAGE_DRIVER: z.enum(["fs", "s3"]).default("fs"),
  S3_ENDPOINT: optionalString,
  S3_BUCKET: optionalString,
  S3_REGION: z.string().default("auto"),
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_FORCE_PATH_STYLE: bool("true"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated environment. Throws one readable message listing every problem. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid Pinwren configuration:\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  if (e.STORAGE_DRIVER === "s3") {
    const required = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;
    const missing = required.filter((k) => !e[k]);
    if (missing.length) {
      throw new Error(`Invalid Pinwren configuration:\n  - STORAGE_DRIVER=s3 needs ${missing.join(", ")}`);
    }
  }
  const halfSet = (
    [
      ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
      ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
    ] as const
  ).filter(([id, secret]) => !e[id] !== !e[secret]);
  if (halfSet.length) {
    const lines = halfSet.map(([id, secret]) => `  - set both ${id} and ${secret}, or neither`);
    throw new Error(`Invalid Pinwren configuration:\n${lines.join("\n")}`);
  }
  cached = e;
  return cached;
}
