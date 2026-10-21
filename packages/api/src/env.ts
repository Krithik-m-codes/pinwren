import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  ANNOTA_URL: z.url("ANNOTA_URL must be the public URL, e.g. https://feedback.example.com"),
  ANNOTA_SECRET: z.string().min(32, "ANNOTA_SECRET must be at least 32 characters"),
  ANNOTA_DATA_DIR: z.string().default("./data"),
  ANNOTA_DISABLE_SIGNUP: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  ANNOTA_TRUST_PROXY: z
    .enum(["0", "1", "true", "false"])
    .default("0")
    .transform((v) => v === "1" || v === "true"),
  WIDGET_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),
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
  cached = parsed.data;
  return cached;
}
