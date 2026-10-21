import { app } from "@pinwren/api";

// Public widget API (/w/*), served by the same Hono app as /api.
const handle = (request: Request) => app.fetch(request);

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const OPTIONS = handle;
