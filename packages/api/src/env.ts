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
  ANNOTA_URL: z.url("ANNOTA_URL must be the public URL, e.g. https://feedback.example.com"),
  ANNOTA_SECRET: z.string().min(32, "ANNOTA_SECRET must be at least 32 characters"),
  ANNOTA_DATA_DIR: z.string().default("./data"),
  ANNOTA_DISABLE_SIGNUP: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  ANNOTA_TRUST_PROXY: bool("false"),
  /** all = serve HTTP and run jobs; web = serve only (jobs are still enqueued); worker = jobs only. */
  ANNOTA_ROLE: z.enum(["all", "web", "worker"]).default("all"),
  /** Comma-separated emails of instance admins. Unset: the first user who signed up. */
  ANNOTA_ADMIN_EMAILS: optionalString,
  WIDGET_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),

  // Email. Each variable set here overrides and locks the matching admin-UI field.
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  SMTP_SECURE: z
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
    throw new Error(`Invalid Annota configuration:\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  if (e.STORAGE_DRIVER === "s3") {
    const required = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;
    const missing = required.filter((k) => !e[k]);
    if (missing.length) {
      throw new Error(`Invalid Annota configuration:\n  - STORAGE_DRIVER=s3 needs ${missing.join(", ")}`);
    }
  }
  cached = e;
  return cached;
}
