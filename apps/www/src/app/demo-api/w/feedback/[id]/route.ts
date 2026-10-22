import { widgetFeedbackStatusUpdate } from "@pinwren/core";
import { json, problem, readJson, widgetGuard, writeAllowed } from "@/lib/demo/http";
import { findItem, setStatus, visitor } from "@/lib/demo/store";

// PATCH /w/feedback/:id — resolve or reopen from the page (wave-1 contract §5). The demo project has
// `visitorsCanResolve` on and `publicRead` on, so any visitor may change the status; the real server also
// accepts the reporter token (`x-pinwren-reporter-token`) when visitors may not.
export async function PATCH(req: Request, ctx: RouteContext<"/demo-api/w/feedback/[id]">) {
  const g = widgetGuard(req);
  if (!g.ok) return g.res;
  const limited = writeAllowed(req, g.key, "status");
  if (limited) return limited;
  const { id } = await ctx.params;
  const item = findItem(visitor(g.key), id);
  if (!item) return problem(404, "NOT_FOUND", "Feedback not found");
  const parsed = widgetFeedbackStatusUpdate.safeParse(await readJson(req));
  if (!parsed.success) return problem(400, "VALIDATION_ERROR", "Invalid request");
  return json({ feedback: setStatus(item, parsed.data.status) });
}
