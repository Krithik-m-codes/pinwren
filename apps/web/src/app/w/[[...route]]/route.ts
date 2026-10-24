import { app } from "@pinwren/api";

// Public widget API (/w/*), served by the same Hono app as /api.
const handle = (request: Request) => app.fetch(request);

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
// The widget sidebar deletes a visitor's own feedback (reporter token).
export const DELETE = handle;
export const OPTIONS = handle;
