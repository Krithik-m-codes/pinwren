import { app } from "@annota/api";

// The whole API (auth, dashboard, widget) is one Hono app; Next only hands it the request.
const handle = (request: Request) => app.fetch(request);

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;
