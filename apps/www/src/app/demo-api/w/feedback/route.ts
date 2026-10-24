import { widgetFeedbackCreate } from "@pinwren/core";
import { json, problem, readJson, widgetGuard, writeAllowed } from "@/lib/demo/http";
import { createFeedback, listPins, visitor } from "@/lib/demo/store";

// GET /w/feedback?url=… — the pins of a page (wave-1 contract §3).
export function GET(req: Request) {
  const g = widgetGuard(req);
  if (!g.ok) return g.res;
  const params = new URL(req.url).searchParams;
  const origin = new URL(req.url).origin;
  return json({
    items: listPins(visitor(g.key), params.get("url"), params.get("include") === "closed", origin),
  });
}

// POST /w/feedback — a comment or bug report (wave-1 contract §2), validated with the real schema.
export async function POST(req: Request) {
  const g = widgetGuard(req);
  if (!g.ok) return g.res;
  const limited = writeAllowed(req, g.key, "report");
  if (limited) return limited;
  const body = await readJson(req);
  if (body === null) return problem(413, "PAYLOAD_TOO_LARGE", "This report is too large for the demo");
  const parsed = widgetFeedbackCreate.safeParse(body);
  if (!parsed.success) return problem(400, "VALIDATION_ERROR", "Invalid request");
  const result = createFeedback(visitor(g.key), parsed.data);
  if (!result.ok) return problem(result.status, result.code, result.title);
  return json({ feedback: result.feedback }, result.replay ? 200 : 201);
}
