import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** RFC 9457 problem details, the error shape for every endpoint (blueprint 04 §1). */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new ApiError(404, "NOT_FOUND", `${what} not found`);
export const unauthorized = () => new ApiError(401, "UNAUTHORIZED", "Sign in required");
export const forbidden = (msg = "Not allowed") => new ApiError(403, "FORBIDDEN", msg);

export function problem(c: Context, status: ContentfulStatusCode, code: string, title: string) {
  return c.json(
    {
      type: `https://pinwren.xride-labs.in/errors/${code.toLowerCase().replaceAll("_", "-")}`,
      title,
      status,
      code,
    },
    status,
    { "content-type": "application/problem+json" },
  );
}
