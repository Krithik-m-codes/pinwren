import { z } from "zod";

export const commandSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("request"),
    path: z.string(),
    method: z.enum(["GET", "POST"]).default("GET"),
    cookie: z.string().optional(),
    body: z.unknown().optional(),
  }),
  z.object({
    op: z.literal("open"),
    name: z.string(),
    path: z.string(),
    cookie: z.string(),
    lastEventId: z.string().optional(),
  }),
  z.object({ op: z.literal("events"), name: z.string() }),
  z.object({ op: z.literal("close"), name: z.string() }),
  z.object({
    op: z.literal("event"),
    orgId: z.string(),
    projectId: z.string(),
    feedbackId: z.string(),
    marker: z.string(),
  }),
  z.object({ op: z.literal("bell"), orgId: z.string(), userId: z.string(), marker: z.string() }),
  z.object({
    op: z.literal("rate"),
    kind: z.enum(["consume", "amount", "exhausted"]),
    key: z.string(),
    limit: z.number(),
    window: z.number().default(60),
    amount: z.number().default(1),
  }),
]);
export type InstanceCommand = z.input<typeof commandSchema>;
export const envelopeSchema = z.object({ id: z.string(), command: commandSchema });
export const replySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready"), pid: z.number() }),
  z.object({
    kind: z.literal("result"),
    id: z.string(),
    ok: z.boolean(),
    value: z.unknown().optional(),
    error: z.string().optional(),
  }),
]);
export const httpResultSchema = z.object({
  status: z.number(),
  body: z.unknown(),
  cookies: z.array(z.string()),
});
export const frameSchema = z.object({
  id: z.string().nullable(),
  event: z.string(),
  data: z.record(z.string(), z.unknown()),
});
export const framesSchema = z.array(frameSchema);
export type InstanceFrame = z.infer<typeof frameSchema>;
