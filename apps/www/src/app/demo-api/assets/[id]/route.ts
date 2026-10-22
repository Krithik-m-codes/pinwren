import { cookieKey, problem } from "@/lib/demo/http";
import { peekVisitor } from "@/lib/demo/store";

// A screenshot or attachment from the visitor's own sandbox, for the demo inbox. Served like the real
// /api/assets/:id: never sniffed, sandboxed, images inline and everything else as a download.
export async function GET(req: Request, ctx: RouteContext<"/demo-api/assets/[id]">) {
  const key = cookieKey(req);
  const { id } = await ctx.params;
  const asset = key
    ? peekVisitor(key)
        ?.items.flatMap((i) => i.assets)
        .find((a) => a.id === id)
    : undefined;
  if (!asset) return problem(404, "NOT_FOUND", "Asset not found");
  const bytes = Buffer.from(asset.dataUrl.slice(asset.dataUrl.indexOf(",") + 1), "base64");
  const inline = asset.contentType.startsWith("image/");
  return new Response(bytes, {
    headers: {
      "content-type": asset.contentType,
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${(asset.name ?? "screenshot").replace(/[^\w.-]/g, "_")}"`,
      "content-security-policy": "sandbox",
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=3600",
    },
  });
}
