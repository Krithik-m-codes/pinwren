import { createFromSource } from "fumadocs-core/search/server";
import { cacheLife } from "next/cache";
import { source } from "@/lib/source";

// A static search index: built once at build time and searched in the browser (no server work per query).
const server = createFromSource(source, { language: "english" });

async function exportedIndex() {
  "use cache";
  cacheLife("max");
  return server.export();
}

export async function GET() {
  return Response.json(await exportedIndex());
}
