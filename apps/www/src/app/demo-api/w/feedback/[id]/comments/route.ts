import { widgetCommentCreate } from "@pinwren/core";
import { json, problem, readJson, widgetGuard, writeAllowed } from "@/lib/demo/http";
import { addReply, findItem, visitor } from "@/lib/demo/store";

// GET/POST /w/feedback/:id/comments — the public thread (wave-1 contract §4).
export async function GET(req: Request, ctx: RouteContext<"/demo-api/w/feedback/[id]/comments">) {
  const g = widgetGuard(req);
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  const item = findItem(visitor(g.key), id);
  if (!item) return problem(404, "NOT_FOUND", "Feedback not found");
  return json({ items: item.replies });
}

export async function POST(req: Request, ctx: RouteContext<"/demo-api/w/feedback/[id]/comments">) {
  const g = widgetGuard(req);
  if (!g.ok) return g.res;
  const limited = writeAllowed(req, g.key, "reply");
  if (limited) return limited;
  const { id } = await ctx.params;
  const v = visitor(g.key);
  const item = findItem(v, id);
  if (!item) return problem(404, "NOT_FOUND", "Feedback not found");
  const parsed = widgetCommentCreate.safeParse(await readJson(req));
  if (!parsed.success) return problem(400, "VALIDATION_ERROR", "Invalid request");
  const result = addReply(v, item, parsed.data.body, parsed.data.author?.name ?? null);
  if (!result.ok) return problem(result.status, result.code, result.title);
  return json({ comment: result.reply }, 201);
}
